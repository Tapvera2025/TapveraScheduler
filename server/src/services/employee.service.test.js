const test = require('node:test');
const assert = require('node:assert/strict');
const dns = require('node:dns').promises;
const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const User = require('../models/User');
const Company = require('../models/Company');
const employeeService = require('./employee.service');
const emailService = require('./email.service');

// Exercise the service and real email validator with database and email I/O
// replaced. No database connection, DNS request or outgoing email is needed.
function fixture(t, { linked = true } = {}) {
  const context = {
    companyId: new mongoose.Types.ObjectId().toString(),
    userId: new mongoose.Types.ObjectId().toString(),
  };
  const user = User.hydrate({
    _id: new mongoose.Types.ObjectId(),
    companyId: context.companyId,
    email: 'alex@example.com',
    name: 'Alex Smith',
    password: 'existing-password',
  });
  const employee = new Employee({
    companyId: context.companyId,
    userId: linked ? user._id : undefined,
    firstName: 'Alex',
    lastName: 'Smith',
    email: user.email,
    position: 'Cleaner',
  });
  const users = linked ? [user] : [];
  const employees = [employee];

  const findOne = (records) => (filter) => {
    const record = records.find((candidate) => Object.entries(filter).every(([key, value]) => {
      if (value && typeof value === 'object' && '$ne' in value) {
        return String(candidate[key]) !== String(value.$ne);
      }
      return String(candidate[key]) === String(value);
    })) || null;
    const query = Promise.resolve(record);
    query.select = () => query;
    query.lean = () => query;
    return query;
  };

  t.mock.method(Employee, 'findOne', findOne(employees));
  t.mock.method(User, 'findOne', findOne(users));
  t.mock.method(Company, 'findById', async () => ({ name: 'Test Company' }));
  t.mock.method(dns, 'resolveMx', async () => [{ exchange: 'mail.example.com', priority: 10 }]);
  const saveEmployee = t.mock.method(employee, 'save', async () => employee);
  const saveUser = t.mock.method(user, 'save', async () => user);
  const sendWelcome = t.mock.method(emailService, 'sendWelcomeEmail', async () => ({ success: true }));

  const update = (data) => employeeService.updateEmployee(context, employee.id, data);
  return { context, employee, user, users, employees, saveEmployee, saveUser, sendWelcome, update };
}

for (const email of ['alex@example.com', '  Alex@Example.com  ']) {
  test(`editing an employee with their existing email (${email.trim()}) succeeds`, async (t) => {
    const f = fixture(t);
    // The edit form sends email again but does not send the linked user ID.
    const result = await f.update({ email, position: 'Supervisor' });

    assert.equal(result.position, 'Supervisor');
    assert.equal(result.email, 'alex@example.com');
    assert.equal(String(result.userId), f.user.id);
    assert.equal(f.saveEmployee.mock.callCount(), 1);
    assert.equal(f.saveUser.mock.callCount(), 0);
    assert.equal(f.sendWelcome.mock.callCount(), 0);
    assert.equal(f.user.password, 'existing-password');
  });
}

test('an employee without a login can keep their existing email', async (t) => {
  const f = fixture(t, { linked: false });
  const result = await f.update({ email: 'alex@example.com', department: 'Operations' });

  assert.equal(result.department, 'Operations');
  assert.equal(f.saveEmployee.mock.callCount(), 1);
  assert.equal(f.sendWelcome.mock.callCount(), 0);
});

for (const collision of ['account', 'employee without login', 'employee with another login']) {
  test(`an email belonging to another ${collision} is rejected before saving`, async (t) => {
    const f = fixture(t);
    const other = {
      _id: new mongoose.Types.ObjectId(),
      companyId: f.context.companyId,
      email: 'other@example.com',
    };
    if (collision === 'account') {
      f.users.push(other);
    } else {
      if (collision === 'employee with another login') other.userId = new mongoose.Types.ObjectId();
      f.employees.push(other);
    }

    await assert.rejects(f.update({ email: other.email, position: 'Supervisor' }), {
      statusCode: 409,
      code: 'EMAIL_IN_USE',
    });
    assert.equal(f.employee.email, 'alex@example.com');
    assert.equal(f.employee.position, 'Cleaner');
    assert.equal(f.saveEmployee.mock.callCount(), 0);
    assert.equal(f.saveUser.mock.callCount(), 0);
    assert.equal(f.sendWelcome.mock.callCount(), 0);
  });
}

test('changing to an available email still updates the linked login', async (t) => {
  const f = fixture(t);
  const result = await f.update({ email: 'new@example.com' });

  assert.equal(result.email, 'new@example.com');
  assert.equal(f.user.email, 'new@example.com');
  assert.equal(f.saveEmployee.mock.callCount(), 1);
  assert.equal(f.saveUser.mock.callCount(), 1);
  assert.equal(f.sendWelcome.mock.callCount(), 1);
  assert.equal(f.sendWelcome.mock.calls[0].arguments[0].to, 'new@example.com');
});

test('linking an employee to a validated account permits that account email', async (t) => {
  const f = fixture(t, { linked: false });
  f.users.push(f.user);
  const result = await f.update({ email: f.user.email, userId: f.user.id });

  assert.equal(String(result.userId), f.user.id);
  assert.equal(f.saveEmployee.mock.callCount(), 1);
});

test('email uniqueness remains scoped to the employee organisation', async (t) => {
  const f = fixture(t);
  const other = {
    _id: new mongoose.Types.ObjectId(),
    companyId: new mongoose.Types.ObjectId(),
    email: f.employee.email,
  };
  f.users.push(other);
  f.employees.push({ ...other, _id: new mongoose.Types.ObjectId() });

  const result = await f.update({ email: f.employee.email, position: 'Supervisor' });
  assert.equal(result.position, 'Supervisor');
  assert.equal(f.saveEmployee.mock.callCount(), 1);
});

test('saving a new password persists a hash that login accepts and rejects the old password', async (t) => {
  const f = fixture(t);
  // Use the real User.save middleware and comparePassword implementation;
  // intercept only the database write so this verifies hashing as well.
  f.saveUser.mock.restore();
  let storedUser = f.user.toObject();
  t.mock.method(User.collection, 'updateOne', async (filter, update) => {
    assert.equal(String(filter._id), f.user.id);
    storedUser = { ...storedUser, ...update.$set };
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  });

  const result = await f.update({
    email: f.employee.email,
    password: 'Updated-password-42',
    sendInvitation: false,
  });

  assert.notEqual(storedUser.password, 'Updated-password-42');
  assert.match(storedUser.password, /^\$2[aby]\$/);
  const loginUser = User.hydrate(storedUser);
  assert.equal(await loginUser.comparePassword('Updated-password-42'), true);
  assert.equal(await loginUser.comparePassword('existing-password'), false);
  assert.ok(loginUser.passwordChangedAt instanceof Date);
  assert.equal(result.password, undefined);
  assert.equal(f.employee.password, undefined);
  assert.equal(f.sendWelcome.mock.callCount(), 0);
});

test('a blank password on the edit form keeps the existing login unchanged', async (t) => {
  const f = fixture(t);
  await f.update({ email: f.employee.email, password: '', position: 'Supervisor' });

  assert.equal(f.user.password, 'existing-password');
  assert.equal(f.saveUser.mock.callCount(), 0);
  assert.equal(f.sendWelcome.mock.callCount(), 0);
  assert.equal(f.employee.password, undefined);
});

for (const changeEmail of [false, true]) {
  test(`a supplied password is used and emailed when invitations are enabled (email changed: ${changeEmail})`, async (t) => {
    const f = fixture(t);
    const email = changeEmail ? 'new@example.com' : f.employee.email;
    await f.update({ email, password: 'Chosen-password-42', sendInvitation: true });

    assert.equal(f.user.password, 'Chosen-password-42');
    assert.equal(f.user.email, email);
    assert.equal(f.saveUser.mock.callCount(), 1);
    assert.equal(f.sendWelcome.mock.callCount(), 1);
    const message = f.sendWelcome.mock.calls[0].arguments[0];
    assert.equal(message.to, email);
    assert.equal(message.password, 'Chosen-password-42');
  });
}

test('a failed account save fails the employee update without sending credentials', async (t) => {
  const f = fixture(t);
  f.saveUser.mock.mockImplementation(async () => { throw new Error('Account save failed'); });

  await assert.rejects(f.update({ email: 'new@example.com', password: 'Updated-password-42' }), {
    message: 'Account save failed',
  });
  assert.equal(f.saveEmployee.mock.callCount(), 0);
  assert.equal(f.sendWelcome.mock.callCount(), 0);
});

for (const missing of [true, false]) {
  test(`a password update cannot use a linked account that is ${missing ? 'missing' : 'in another organisation'}`, async (t) => {
    const f = fixture(t);
    if (missing) f.users.length = 0;
    else f.user.companyId = new mongoose.Types.ObjectId().toString();

    await assert.rejects(f.update({ password: 'Updated-password-42' }), { statusCode: 404 });
    assert.equal(f.saveEmployee.mock.callCount(), 0);
    assert.equal(f.saveUser.mock.callCount(), 0);
  });
}

test('setting a password creates a hashed portal login for an employee without one', async (t) => {
  const f = fixture(t, { linked: false });
  let storedUser;
  t.mock.method(User.collection, 'insertOne', async (document) => {
    storedUser = { ...document };
    return { acknowledged: true, insertedId: document._id };
  });

  const result = await f.update({ password: 'First-password-42', sendInvitation: false });

  assert.ok(storedUser, 'a login account should be persisted');
  assert.equal(String(result.userId), String(storedUser._id));
  assert.equal(storedUser.email, f.employee.email);
  assert.equal(storedUser.companyId, String(f.context.companyId));
  assert.equal(storedUser.role, 'USER');
  assert.match(storedUser.password, /^\$2[aby]\$/);
  assert.equal(await User.hydrate(storedUser).comparePassword('First-password-42'), true);
  assert.equal(result.password, undefined);
  assert.equal(f.sendWelcome.mock.callCount(), 0);
});

test('creating a login through a password-only edit cannot take another account email', async (t) => {
  const f = fixture(t, { linked: false });
  f.users.push(f.user);
  const createUser = t.mock.method(User, 'create', async () => assert.fail('must not create an account'));

  await assert.rejects(f.update({ password: 'First-password-42' }), { statusCode: 409, code: 'EMAIL_IN_USE' });
  assert.equal(createUser.mock.callCount(), 0);
  assert.equal(f.saveUser.mock.callCount(), 0);
  assert.equal(f.saveEmployee.mock.callCount(), 0);
});

test('invalid employee details are rejected before changing the login password', async (t) => {
  const f = fixture(t);
  await assert.rejects(f.update({ position: '', password: 'Updated-password-42' }), { name: 'ValidationError' });
  assert.equal(f.saveUser.mock.callCount(), 0);
  assert.equal(f.saveEmployee.mock.callCount(), 0);
});

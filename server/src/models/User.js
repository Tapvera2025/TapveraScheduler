/**
 * User Model (Authentication)
 *
 * Represents system users (admins, managers, employees with login access)
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('../config');
const softDeletePlugin = require('./plugins/softDelete');
const auditLogPlugin = require('./plugins/auditLog');
const multiTenantPlugin = require('./plugins/multiTenant');
const logger = require('../utils/logger');

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
    },

    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false, // Don't return password in queries by default
    },

    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },

    role: {
      type: String,
      enum: {
        // MASTER sits above organisations and has no companyId
        values: ['MASTER', 'ADMIN', 'MANAGER', 'USER'],
        message: '{VALUE} is not a valid role',
      },
      default: 'USER',
      index: true,
    },

    refreshToken: {
      type: String,
      select: false,
    },

    lastLoginAt: {
      type: Date,
    },

    passwordChangedAt: {
      type: Date,
    },

    passwordResetToken: {
      type: String,
      select: false,
    },

    passwordResetExpires: {
      type: Date,
      select: false,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Apply plugins
userSchema.plugin(softDeletePlugin);
userSchema.plugin(auditLogPlugin);
// A MASTER user belongs to no organisation, so companyId is required for
// everyone else only
userSchema.plugin(multiTenantPlugin, {
  required: function () {
    return this.role !== 'MASTER';
  },
});

// Hash password before saving
userSchema.pre('save', async function () {
  // Only hash if password is modified
  if (!this.isModified('password')) return;

  // Hash password
  const salt = await bcrypt.genSalt(config.auth.bcryptSaltRounds);
  this.password = await bcrypt.hash(this.password, salt);

  // Set passwordChangedAt (1s in the past so any token issued right after is valid)
  if (!this.isNew) {
    this.passwordChangedAt = Date.now() - 1000;
  }
});

// bcrypt hashes start with $2a$ / $2b$ / $2y$ and are 60 characters long
const BCRYPT_PATTERN = /^\$2[aby]\$\d{2}\$.{53}$/;

/**
 * Compare a candidate password against the stored value.
 *
 * Normally this is a straight bcrypt comparison. Passwords created before
 * hashing was enabled are still stored as plain text, so in non-production
 * environments a matching plain-text password is accepted once and then
 * re-saved, which hashes it via the pre-save hook. Production never accepts a
 * plain-text password — run `npm run migrate:hash-passwords` there instead.
 */
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!candidatePassword || !this.password) return false;

  const stored = this.password;

  // Normal path: the stored value is already a bcrypt hash
  if (BCRYPT_PATTERN.test(stored)) {
    return await bcrypt.compare(candidatePassword, stored);
  }

  // Transitional path: legacy plain-text password
  if (config.isProduction()) {
    logger.error('Refused login: password is not hashed', {
      userId: this._id,
      hint: 'Run the hashExistingPasswords migration',
    });
    return false;
  }

  if (candidatePassword !== stored) {
    return false;
  }

  // Upgrade in place so this only happens once for this user
  try {
    this.password = candidatePassword;
    await this.save();
    logger.warn('Upgraded a legacy plain-text password to a bcrypt hash', {
      userId: this._id,
    });
  } catch (error) {
    logger.error('Could not upgrade legacy password to a hash', {
      userId: this._id,
      error: error.message,
    });
  }

  return true;
};

// Check if password was changed after JWT was issued
userSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(this.passwordChangedAt.getTime() / 1000, 10);
    return JWTTimestamp < changedTimestamp;
  }
  return false;
};

// Indexes
userSchema.index({ email: 1, companyId: 1 }, { unique: true });
userSchema.index({ role: 1, companyId: 1 });
userSchema.index({ isActive: 1, deletedAt: 1 });

module.exports = mongoose.model('User', userSchema);

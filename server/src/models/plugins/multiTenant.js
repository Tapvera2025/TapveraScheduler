/**
 * Multi-Tenant Plugin
 *
 * Adds companyId to all documents for tenant isolation
 * Critical for Australian SaaS clients who expect data segregation
 *
 * Adds:
 * - companyId field (required, indexed)
 * - findByCompany() / countByCompany() static helpers
 * - compound indexes prefixed with companyId
 *
 * IMPORTANT: this plugin does NOT scope queries automatically. There is no
 * query middleware here — a bare Model.find({}) returns every tenant's rows.
 * Every read, write, aggregate and populate must pass companyId explicitly,
 * taken from the authenticated actor and never from client input.
 */

module.exports = function multiTenantPlugin(schema, options = {}) {
  const { required = true } = options;

  // Add companyId field
  schema.add({
    companyId: {
      type: String,
      required,
      index: true,
      ref: 'Company',
    },
  });

  // Static method to find by company
  schema.statics.findByCompany = function (companyId, conditions = {}) {
    return this.find({ ...conditions, companyId });
  };

  // Static method to count by company
  schema.statics.countByCompany = function (companyId, conditions = {}) {
    return this.countDocuments({ ...conditions, companyId });
  };

  // Add compound indexes with companyId
  if (schema.options.indexes) {
    schema.options.indexes.forEach((index) => {
      const fields = index[0];
      if (!fields.companyId) {
        schema.index({ companyId: 1, ...fields }, index[1]);
      }
    });
  }
};

const { z, id, qty, money, text } = require('./common');

const createMaterialSchema = z.object({
  yarnType: text,
  colour: text,
  unit: text.default('kg'),
  reorderLevel: money.default(0),
});

const updateMaterialSchema = z.object({
  unit: text.optional(),
  reorderLevel: money.optional(),
});

const inwardSchema = z.object({
  materialId: id,
  supplierId: id,
  orderId: id.optional(),
  qty,
  rate: money,
});

const issueSchema = z.object({ materialId: id, orderId: id, qty });

module.exports = { createMaterialSchema, updateMaterialSchema, inwardSchema, issueSchema };

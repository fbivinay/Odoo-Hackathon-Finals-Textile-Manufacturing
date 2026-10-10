const { z, id, qty, money, text } = require('./common');

const CATEGORIES = ['YARN', 'DYE', 'CHEMICAL', 'PACKAGING', 'OTHER'];

const createMaterialSchema = z.object({
  category: z.enum(CATEGORIES).default('YARN'),
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

const issueSchema = z.object({ materialId: id, orderId: id.optional(), qty });

const purchaseOrderSchema = z.object({
  lines: z.array(z.object({ materialId: id, supplierId: id, qty, rate: money })).min(1),
});

// What actually arrived; defaults to what was ordered.
const receiveSchema = z.object({ qty: qty.optional(), rate: money.optional() });

module.exports = { CATEGORIES, createMaterialSchema, updateMaterialSchema, inwardSchema, issueSchema, purchaseOrderSchema, receiveSchema };

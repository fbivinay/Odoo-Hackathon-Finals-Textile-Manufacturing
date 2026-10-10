const { z, id, qty, money, text } = require('./common');

const CATEGORIES = ['YARN', 'WEAVING', 'DYEING', 'FINISHING', 'QC', 'PACKAGING', 'MAINTENANCE'];
const { RULES } = require('../lib/tax');
const taxCode = z.enum(Object.keys(RULES));

const createMaterialSchema = z.object({
  category: z.enum(CATEGORIES).default('YARN'),
  yarnType: text,
  colour: text,
  unit: text.default('kg'),
  reorderLevel: money.default(0),
  sku: text.optional(),
  subcategory: text.optional(),
  department: text.optional(),
  taxCode: taxCode.optional(),
  isSpare: z.boolean().optional(),
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
  batchNo: text.optional(),
  billNo: text.optional(), // the supplier's bill number, if given; otherwise a PB- number
});

const issueSchema = z.object({ materialId: id, orderId: id.optional(), jobId: id.optional(), department: text.optional(), qty });

const purchaseOrderSchema = z.object({
  lines: z.array(z.object({ materialId: id, supplierId: id, qty, rate: money })).min(1),
});

// What actually arrived; defaults to what was ordered.
const receiveSchema = z.object({ qty: qty.optional(), rate: money.optional() });

module.exports = { CATEGORIES, createMaterialSchema, updateMaterialSchema, inwardSchema, issueSchema, purchaseOrderSchema, receiveSchema };

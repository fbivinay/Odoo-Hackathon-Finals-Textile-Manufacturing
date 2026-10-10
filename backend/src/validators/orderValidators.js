const { z, id, qty, money, text } = require('./common');

const ORDER_STATUSES = ['PENDING', 'SPINNING', 'WEAVING', 'DYEING', 'QC', 'READY', 'DISPATCHED', 'CANCELLED'];

const createOrderSchema = z.object({
  buyerId: id,
  materialId: id.optional(),
  fabricType: text,
  colour: text,
  qty,
  yarnRequired: money.default(0),
  pricePerUnit: money.default(0),
  deadline: z.coerce.date(),
});

const orderStatusSchema = z.object({ status: z.enum(ORDER_STATUSES) });

module.exports = { ORDER_STATUSES, createOrderSchema, orderStatusSchema };

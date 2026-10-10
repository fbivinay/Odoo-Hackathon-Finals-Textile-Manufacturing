const { z, id, qty, money, text } = require('./common');

const ORDER_STATUSES = ['PENDING', 'SPINNING', 'WEAVING', 'DYEING', 'QC', 'READY', 'DISPATCHED', 'CANCELLED'];

const createOrderSchema = z.object({
  buyerId: id,
  materialId: id.optional(),
  fabricType: text,
  colour: z.string().trim().default(''), // optional: not every order names a colour
  qty,
  yarnRequired: money.default(0),
  pricePerUnit: money.default(0),
  deadline: z.coerce.date(),
});

const orderStatusSchema = z.object({ status: z.enum(ORDER_STATUSES) });
const cancelOrderSchema = z.object({ reason: text.max(200) }).strict();

module.exports = { ORDER_STATUSES, createOrderSchema, orderStatusSchema, cancelOrderSchema };

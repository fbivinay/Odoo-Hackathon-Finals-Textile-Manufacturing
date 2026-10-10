const { z, id, qty, optionalText } = require('./common');

const dispatchSchema = z.object({
  orderId: id,
  rollIds: z.array(id).min(1),
  vehicleNo: optionalText,
});

const paymentSchema = z.object({ amount: qty, method: optionalText });

module.exports = { dispatchSchema, paymentSchema };

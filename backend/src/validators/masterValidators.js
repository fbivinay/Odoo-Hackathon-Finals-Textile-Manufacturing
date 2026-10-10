const { z, text, optionalText } = require('./common');

const supplierSchema = z.object({ name: text, phone: optionalText });

const buyerSchema = z.object({
  name: text,
  phone: optionalText,
  email: z.string().email().optional(),
});

module.exports = { supplierSchema, buyerSchema };

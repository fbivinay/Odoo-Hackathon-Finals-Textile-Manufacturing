const { z, text, optionalText } = require('./common');

const supplierSchema = z.object({ name: text, phone: optionalText });

const buyerSchema = z.object({
  name: text,
  phone: optionalText,
  email: z.string().email().optional(),
  address: z.string().trim().max(300).optional(), // delivery address, one line
});

// What can be changed on a client afterwards.
const buyerUpdateSchema = z.object({ address: z.string().trim().max(300).nullable(), phone: optionalText.nullable() }).partial();

module.exports = { supplierSchema, buyerSchema, buyerUpdateSchema };

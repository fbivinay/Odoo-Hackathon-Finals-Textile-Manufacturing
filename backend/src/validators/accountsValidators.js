const { z, id, qty, money, text, optionalText } = require('./common');
const { RULES } = require('../lib/tax');

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Use YYYY-MM-DD');

const billPaymentSchema = z.object({ amount: qty, method: optionalText, reference: optionalText, paidAt: isoDay.optional() });

const expenseSchema = z
  .object({
    category: z.enum(['LOGISTICS', 'UTILITIES']),
    subcategory: text,
    description: text,
    payee: text,
    partyState: optionalText, // place of supply for CGST+SGST vs IGST; default Gujarat
    incurredAt: isoDay,
    dueDate: isoDay.optional(),
    amount: z.coerce.number().positive(),
    taxCode: z.enum(Object.keys(RULES)),
    status: z.enum(['PAID', 'UNPAID', 'ACCRUED']).default('UNPAID'),
    paidAt: isoDay.optional(),
    method: optionalText,
    reference: optionalText,
    costCentre: text,
    orderId: id.optional(),
    dispatchId: id.optional(),
    recurring: z.boolean().default(false),
  })
  .refine((e) => e.status !== 'PAID' || e.method, { message: 'A paid expense needs a payment method', path: ['method'] });

const payExpenseSchema = z.object({ method: text, reference: optionalText, paidAt: isoDay.optional() });

module.exports = { billPaymentSchema, expenseSchema, payExpenseSchema, money };

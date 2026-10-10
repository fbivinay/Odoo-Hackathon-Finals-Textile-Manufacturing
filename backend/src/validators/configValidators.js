const { z, id, money } = require('./common');

const pct = z.coerce.number().min(-50).max(100);

const fabricSchema = z.object({
  materialId: id.nullable().optional(),
  yarnPerMetre: z.coerce.number().positive().max(5),
  wastagePct: z.coerce.number().min(0).max(50),
  pricePerMetre: z.coerce.number().positive(),
});

const ruleSchema = z.object({
  kind: z.enum(['QUANTITY', 'DEADLINE']),
  below: z.coerce.number().int().positive(),
  pricePct: pct.default(0),
  wastagePct: pct.default(0),
});

const ruleUpdateSchema = ruleSchema.omit({ kind: true }).partial();

const settingsSchema = z.record(z.string(), z.coerce.number());

const materialConfigSchema = z.object({
  reorderLevel: money.optional(),
  supplierId: id.nullable().optional(),
  leadDays: z.coerce.number().int().min(0).max(120).optional(),
});

module.exports = { fabricSchema, ruleSchema, ruleUpdateSchema, settingsSchema, materialConfigSchema };

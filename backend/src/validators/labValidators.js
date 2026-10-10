const { z, id, text, optionalText } = require('./common');

// Everest Lab what-if inputs. Every limit here is checked again against the data in labService
// (machine exists, material is a yarn, fabric is known).
const stage = z.enum(['SPINNING', 'WEAVING', 'DYEING']);
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const int = (min, max, label) => z.coerce.number().int(`${label} must be a whole number`).min(min, `${label} must be ${min} to ${max}`).max(max, `${label} must be ${min} to ${max}`);
const num = (min, max, label) => z.coerce.number().min(min, `${label} must be ${min} to ${max}`).max(max, `${label} must be ${min} to ${max}`);

const changesSchema = z
  .object({
    addMachines: z
      .array(
        z.object({
          stage,
          count: int(1, 3, 'Machines to add'),
          perShift: num(1, 100000, 'Output per shift').optional(), // default: the stage's average machine
          fromDay: int(0, 180, 'Start day').default(0),
          rampDays: int(0, 60, 'Ramp-up days').default(0),
        }),
      )
      .max(3)
      .optional(),
    breakdowns: z.array(z.object({ machineId: id, days: int(1, 90, 'Breakdown days') })).max(10).optional(),
    sundays: z.boolean().optional(),
    materials: z
      .array(z.object({ materialId: id, stockChange: num(-1e7, 1e7, 'Stock change').default(0), extraLeadDays: int(0, 90, 'Extra delivery days').default(0) }))
      .max(10)
      .optional(),
    rushOrder: z
      .object({
        fabricType: text,
        colour: optionalText,
        qty: num(1, 200000, 'Rush order metres'),
        deadline: isoDay,
        pricePerUnit: num(1, 100000, 'Price per metre').optional(), // default: the Mill Setup price
      })
      .optional(),
    qc: z.object({ rejectPct: num(0, 50, 'Reject rate') }).optional(),
    logistics: z.object({ costPerMetreChangePct: num(-50, 200, 'Logistics cost change') }).optional(),
  })
  .strict();

// Owner's money assumptions. Nothing is defaulted that the data cannot back, except the clearly
// labelled maintenance percentage and Sunday pay multiplier.
const optionalMoney = (label) => num(0, 1e10, label).optional();
const costsSchema = z
  .object({
    machineCost: optionalMoney('Machine price'), // ₹ each, installed
    powerKw: num(0, 1000, 'Power per machine (kW)').optional(),
    tariff: num(0, 100, 'Electricity rate (₹/kWh)').optional(),
    staffPerShift: num(0, 20, 'Staff per machine per shift').optional(),
    maintenancePctYear: num(0, 50, 'Maintenance per year (%)').default(5),
    repairCost: optionalMoney('Repair cost'),
    sundayPayMultiplier: num(1, 3, 'Sunday pay multiplier').default(1),
  })
  .strict()
  .default({});

const simulateSchema = z.object({
  changes: changesSchema,
  costs: costsSchema,
  days: z.coerce.number().int().refine((d) => [30, 90, 180, 365].includes(d), 'days must be 30, 90, 180 or 365').default(90),
});

const scenarioSchema = simulateSchema.extend({ name: z.string().trim().min(1, 'Give the scenario a name').max(120) });
const scenarioPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    changes: changesSchema.optional(),
    costs: costsSchema.optional(),
    days: simulateSchema.shape.days.optional(),
    decision: z.enum(['NEEDS_REVIEW', 'APPROVED', 'REJECTED']).optional(),
    note: z.string().max(2000).nullable().optional(),
  })
  .strict();

module.exports = { simulateSchema, scenarioSchema, scenarioPatchSchema };

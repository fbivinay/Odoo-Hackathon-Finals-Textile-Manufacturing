const { z, id, money, text, SHIFTS } = require('./common');

const workerSchema = z.object({
  code: text,
  name: text,
  shift: z.enum(SHIFTS),
  dailyWage: money,
});

const updateWorkerSchema = z.object({
  name: text.optional(),
  shift: z.enum(SHIFTS).optional(),
  dailyWage: money.optional(),
  isActive: z.boolean().optional(),
});

const attendanceSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  entries: z
    .array(z.object({ workerId: id, status: z.enum(['PRESENT', 'ABSENT', 'HALF_DAY']) }))
    .min(1),
});

const payWagesSchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() });

module.exports = { workerSchema, updateWorkerSchema, attendanceSchema, payWagesSchema };

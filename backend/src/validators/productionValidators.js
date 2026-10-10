const { z, id, qty, text, SHIFTS, STAGES } = require('./common');

const dailyCapacity = z.coerce.number().positive().max(1000000);
const machineSchema = z.object({ code: text, name: text, type: z.enum(STAGES), dailyCapacity: dailyCapacity.optional() });
// The stage is fixed once a machine has run; code, name and capacity can change.
const machineUpdateSchema = z.object({ code: text, name: text, dailyCapacity: dailyCapacity.nullable() }).partial();

// RUNNING is set only by starting a job.
const machineStatusSchema = z.object({ status: z.enum(['IDLE', 'BREAKDOWN', 'MAINTENANCE']) });

const startJobSchema = z.object({
  orderId: id,
  machineId: id,
  workerId: id.optional(),
  shift: z.enum(SHIFTS),
  qtyPlanned: qty,
});

const progressSchema = z.object({ qty });

const rollSchema = z.object({ jobId: id, qty });

module.exports = { machineSchema, machineUpdateSchema, machineStatusSchema, startJobSchema, progressSchema, rollSchema };

const { z, id, qty, text, SHIFTS, STAGES } = require('./common');

const machineSchema = z.object({ code: text, name: text, type: z.enum(STAGES) });

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

module.exports = { machineSchema, machineStatusSchema, startJobSchema, progressSchema, rollSchema };

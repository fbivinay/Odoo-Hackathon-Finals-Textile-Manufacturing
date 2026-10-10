const { z, optionalText } = require('./common');

const inspectSchema = z
  .object({
    result: z.enum(['PASS', 'REWORK', 'REJECT']),
    defectType: optionalText,
    notes: optionalText,
    reworkStage: z.enum(['WEAVING', 'DYEING']).optional(), // where rework goes back to; yarn can't be redone
  })
  .refine((v) => v.result === 'PASS' || v.defectType, {
    message: 'defectType is required for rework or reject',
    path: ['defectType'],
  })
  .refine((v) => v.result !== 'REWORK' || v.reworkStage, { message: 'reworkStage is required for rework', path: ['reworkStage'] });

module.exports = { inspectSchema };

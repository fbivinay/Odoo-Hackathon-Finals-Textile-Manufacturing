const { z, optionalText } = require('./common');

const inspectSchema = z
  .object({
    result: z.enum(['PASS', 'REWORK', 'REJECT']),
    defectType: optionalText,
    notes: optionalText,
  })
  .refine((v) => v.result === 'PASS' || v.defectType, {
    message: 'defectType is required for rework or reject',
    path: ['defectType'],
  });

module.exports = { inspectSchema };

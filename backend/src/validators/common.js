const { z } = require('zod');

const id = z.string().min(1);
const qty = z.coerce.number().positive();
const money = z.coerce.number().min(0);
const text = z.string().trim().min(1);
const optionalText = z.string().trim().min(1).optional();

const SHIFTS = ['MORNING', 'EVENING', 'NIGHT'];
const STAGES = ['SPINNING', 'WEAVING', 'DYEING'];

module.exports = { z, id, qty, money, text, optionalText, SHIFTS, STAGES };

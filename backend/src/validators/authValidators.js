const { z } = require('zod');

const ROLES = ['OWNER', 'STORE', 'PRODUCTION', 'QC', 'DISPATCH'];

const passwordRule = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[0-9]/, 'Password must contain a number');

const signinSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const createUserSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().email(),
  password: passwordRule,
  role: z.enum(ROLES),
});

module.exports = { ROLES, passwordRule, signinSchema, createUserSchema };

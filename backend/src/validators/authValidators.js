const { z } = require('zod');
const { EXTRA_TABS } = require('../lib/tabs');

const ROLES = ['OWNER', 'STORE', 'PRODUCTION', 'QC', 'DISPATCH'];

// Six or more letters or digits.
const passwordRule = z.string().regex(/^[A-Za-z0-9]{6,}$/, 'Password must be at least 6 letters or digits');

// Optional; null clears it.
const shiftRule = z.enum(['MORNING', 'EVENING', 'NIGHT']).nullable();

const extraTabsRule = z.array(z.enum(Object.keys(EXTRA_TABS)));

const signinSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const createUserSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().email(),
  password: passwordRule,
  role: z.enum(ROLES),
  extraTabs: extraTabsRule.optional(),
  shift: shiftRule.optional(),
});

const updateUserSchema = z
  .object({
    name: z.string().trim().min(1),
    role: z.enum(ROLES),
    isActive: z.boolean(),
    extraTabs: extraTabsRule,
    shift: shiftRule,
    password: passwordRule, // owner reset: the employee must change it at next sign-in
  })
  .partial();

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).optional(),
  newPassword: passwordRule,
});

module.exports = { ROLES, passwordRule, signinSchema, createUserSchema, updateUserSchema, changePasswordSchema };

const { z } = require('zod');

const MAX_IMAGE_BASE64 = 5_500_000; // about 4 MB of image once decoded

const imageSchema = z.object({
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  data: z.string().min(1).max(MAX_IMAGE_BASE64, 'Image is too large').regex(/^[A-Za-z0-9+/]+=*$/, 'Image must be base64'),
});

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().max(4000).default(''),
  images: z.array(imageSchema).max(3).optional(),
});

const chatSchema = z.object({
  messages: z
    .array(messageSchema)
    .min(1)
    .max(40)
    .refine((m) => m[m.length - 1].role === 'user', 'The last message must be from the user')
    .refine((m) => m.every((x) => x.role === 'user' || (x.text && !x.images?.length)), 'Assistant messages are text only')
    .refine((m) => m.every((x) => x.text.trim() || x.images?.length), 'A message needs text or an image'),
});

module.exports = { chatSchema };

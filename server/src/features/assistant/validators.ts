import { z } from 'zod';

/** Limits agreed in plan §6. */
export const MAX_USER_MESSAGE_CHARS = 1000;
export const MAX_HISTORY_TURNS = 12;
const MAX_MODEL_MESSAGE_CHARS = 6000;
const MAX_TURNS_ACCEPTED = 40; // clients should send ≤ 12; we trim instead of rejecting a slightly long history

const turnSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('user'), text: z.string().trim().min(1).max(MAX_USER_MESSAGE_CHARS) }),
  z.object({ role: z.literal('model'), text: z.string().max(MAX_MODEL_MESSAGE_CHARS) }),
]);

export const chatBodySchema = z.object({
  messages: z.array(turnSchema).min(1).max(MAX_TURNS_ACCEPTED)
    .refine((m) => m[m.length - 1]?.role === 'user', { message: 'The last message must be from the student.' }),
});

export type ChatBody = z.infer<typeof chatBodySchema>;

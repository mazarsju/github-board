// Validation (zod) of the personal state received by the backend.
import { z } from 'zod';

export const appStateSchema = z.object({
  settings: z.object({
    refresh: z.number().int().min(0),
    theme: z.enum(['auto', 'light', 'dark']),
    collapsed: z.array(z.string().max(200)).max(100),
  }),
});

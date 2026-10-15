// Validation (zod) de l'état personnel reçu par le backend (sauvegarde, import JSON).
import { z } from 'zod';

const column = z.object({
  id: z.string().min(1),
  name: z.string().max(100),
  query: z.string().max(1000),
  color: z.string().max(32),
  sort: z.enum(['updated', 'created', 'comments']),
  limit: z.number().int().min(1).max(100),
  notify: z.boolean(),
});

const board = z.object({
  id: z.string().min(1),
  name: z.string().max(100),
  columns: z.array(column),
});

const prMeta = z.object({
  pinned: z.boolean().optional(),
  hidden: z.boolean().optional(),
  snoozeUntil: z.string().optional(),
  note: z.string().max(10_000).optional(),
  tags: z.array(z.string().max(100)).optional(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
});

export const appStateSchema = z.object({
  boards: z.array(board).min(1),
  activeBoard: z.string(),
  settings: z.object({
    refresh: z.number().int().min(0),
    theme: z.enum(['auto', 'light', 'dark']),
    details: z.boolean(),
    compact: z.boolean(),
  }),
  prs: z.record(z.string(), prMeta),
  seen: z.record(z.string(), z.array(z.string())),
  reposSeeded: z.boolean(),
});

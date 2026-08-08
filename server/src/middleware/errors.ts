/**
 * Central error handling. Two layers:
 *  - AppError: errors we throw deliberately in services (known status + message)
 *  - DB errors: triggers/constraints raise with rule tags; we surface them safely
 *
 * The DB is the final gate. When a trigger rejects (e.g. 'AUTH-13: ...'), the
 * message already names the rule — we pass a cleaned version to the client and
 * log the full detail server-side.
 */
import type { ErrorRequestHandler, Request, Response, NextFunction } from 'express';
import { isPgError, PG_ERRORS } from '../db/index.js';
import { isProd } from '../config/index.js';

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// Common shorthands
export const badRequest = (m: string, code?: string) => new AppError(400, m, code);
export const unauthorized = (m = 'Not authenticated') => new AppError(401, m);
export const forbidden = (m = 'Not allowed') => new AppError(403, m);
export const notFound = (m = 'Not found') => new AppError(404, m);
export const conflict = (m: string, code?: string) => new AppError(409, m, code);

/** Extract a human-facing message from a Postgres trigger RAISE like 'AUTH-13: ...'. */
function triggerMessage(raw: string): string {
  // messages are 'RULE-NN: human text' — keep as-is; they're written for humans.
  return raw.replace(/^ERROR:\s*/i, '').trim();
}

export const errorHandler: ErrorRequestHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) => {
  // Deliberate application errors
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }

  // Database-level rejections (the final gate)
  if (isPgError(err)) {
    switch (err.code) {
      case PG_ERRORS.EXCLUSION_VIOLATION:
        // conflict detection (CONF-*) — slot already taken
        return res.status(409).json({
          error: 'That slot is no longer available.',
          code: 'CONFLICT',
        });
      case PG_ERRORS.UNIQUE_VIOLATION:
        return res.status(409).json({
          error: 'That already exists.',
          code: 'DUPLICATE',
          constraint: err.constraint,
        });
      case PG_ERRORS.RAISE_EXCEPTION:
        // trigger RAISE — message carries the rule tag, written for humans
        return res.status(422).json({ error: triggerMessage(err.message), code: 'RULE' });
      case PG_ERRORS.CHECK_VIOLATION:
        return res.status(422).json({
          error: 'That change breaks a data rule.',
          code: 'CHECK',
          constraint: err.constraint,
        });
      case PG_ERRORS.FOREIGN_KEY_VIOLATION:
        return res.status(422).json({ error: 'Referenced item does not exist.', code: 'FK' });
    }
  }

  // Unknown — log, and don't leak internals in production
  console.error('Unhandled error:', err);
  return res.status(500).json({
    error: isProd ? 'Something went wrong.' : String((err as Error)?.message ?? err),
    code: 'INTERNAL',
  });
};

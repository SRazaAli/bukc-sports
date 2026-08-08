/**
 * Wraps an async route handler so a thrown/rejected error is passed to Express's
 * error middleware. Express 4 does not await handlers, so without this an async
 * throw becomes an unhandled rejection and the request hangs. Explicit and
 * dependency-free (vs. monkey-patching Router).
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

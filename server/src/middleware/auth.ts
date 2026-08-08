/**
 * Authentication & role authorization middleware.
 *
 * This enforces at the API layer what the DB triggers enforce at the data layer
 * (AUTH-12, APPR-07, VENUE-19, etc.) — defense in depth. A request should never
 * even reach a query it isn't allowed to make; but if a route forgets, the DB
 * still refuses. Both layers agree by design.
 */
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { unauthorized, forbidden } from './errors.js';
import type { UserRole } from '../db/index.js';

export interface AuthUser {
  userId: string;
  role: UserRole;
}

// augment Express Request with the authenticated user
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export interface AccessTokenPayload {
  sub: string; // user_id
  role: UserRole;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, config.JWT_ACCESS_SECRET, {
    expiresIn: `${config.ACCESS_TOKEN_TTL_MIN}m`,
  });
}

/** Populates req.user from the Bearer access token. 401 if missing/invalid. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw unauthorized();
  }
  const token = header.slice('Bearer '.length);
  try {
    const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET) as AccessTokenPayload;
    req.user = { userId: decoded.sub, role: decoded.role };
    next();
  } catch {
    throw unauthorized('Session expired or invalid');
  }
}

/**
 * SSE variant of requireAuth. Browsers' native EventSource cannot set custom
 * request headers, so the access token travels as a query param on this one
 * route only. Same short-lived JWT, same verification — just a different
 * transport. Never used for any other endpoint.
 */
export function requireAuthSSE(req: Request, _res: Response, next: NextFunction): void {
  const token = typeof req.query.token === 'string' ? req.query.token : undefined;
  if (!token) throw unauthorized();
  try {
    const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET) as AccessTokenPayload;
    req.user = { userId: decoded.sub, role: decoded.role };
    next();
  } catch {
    throw unauthorized('Session expired or invalid');
  }
}

/** Restrict a route to one or more roles. Use after requireAuth. */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) {
      // AUTH-12: don't reveal whether the route exists — a plain 403.
      throw forbidden();
    }
    next();
  };
}

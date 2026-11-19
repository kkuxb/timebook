import crypto from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

export const SESSION_COOKIE_NAME = 'tb_session';
export const SESSION_MAX_AGE_SEC = 180 * 24 * 60 * 60; // 180 天

export interface AuthConfig {
  password: string;
  secret: string;
  cookieSecure: 'auto' | 'true' | 'false';
}

export function resolveAuthConfig(overrides?: Partial<AuthConfig>): AuthConfig {
  const password = overrides?.password ?? process.env.TIMEBOOK_PASSWORD ?? '';
  const secret =
    overrides?.secret ??
    process.env.TIMEBOOK_SECRET ??
    (password ? crypto.createHash('sha256').update(`tb:${password}`).digest('hex') : 'dev-fallback-secret');
  const rawSecure = (overrides?.cookieSecure ?? process.env.COOKIE_SECURE ?? 'auto').toLowerCase();
  const cookieSecure: 'auto' | 'true' | 'false' =
    rawSecure === 'true' ? 'true' : rawSecure === 'false' ? 'false' : 'auto';
  return { password, secret, cookieSecure };
}

function sha256Buf(text: string): Buffer {
  return crypto.createHash('sha256').update(text, 'utf8').digest();
}

export function verifyPassword(input: string, expected: string): boolean {
  if (!expected) return false;
  return crypto.timingSafeEqual(sha256Buf(input), sha256Buf(expected));
}

function signToken(issuedAt: number, expiresAt: number, secret: string): string {
  const payload = `${issuedAt}.${expiresAt}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifySessionToken(token: string | undefined, secret: string): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [issuedStr, expiresStr, sigHex] = parts;
  const issuedAt = Number(issuedStr);
  const expiresAt = Number(expiresStr);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) return false;
  if (Date.now() > expiresAt) return false;

  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(`${issuedStr}.${expiresStr}`)
    .digest('hex');
  if (sigHex.length !== expectedSig.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sigHex, 'utf8'), Buffer.from(expectedSig, 'utf8'));
}

export function shouldUseSecureCookie(c: Context, mode: 'auto' | 'true' | 'false'): boolean {
  if (mode === 'true') return true;
  if (mode === 'false') return false;
  const fwdProto = c.req.header('x-forwarded-proto');
  if (fwdProto && fwdProto.split(',')[0].trim().toLowerCase() === 'https') {
    return true;
  }
  return c.req.url.startsWith('https://');
}

export function getClientIp(c: Context): string {
  const fwd = c.req.header('x-forwarded-for');
  if (fwd) {
    return fwd.split(',')[0].trim();
  }
  const realIp = c.req.header('x-real-ip');
  if (realIp) return realIp.trim();
  return '127.0.0.1';
}

export class IpRateLimiter {
  private readonly failures = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly maxAttempts: number;

  constructor(maxAttempts = 5, windowMs = 60_000) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
  }

  private prune(ip: string, now: number): number[] {
    const arr = this.failures.get(ip) ?? [];
    const active = arr.filter((ts) => now - ts < this.windowMs);
    if (active.length > 0) {
      this.failures.set(ip, active);
    } else {
      this.failures.delete(ip);
    }
    return active;
  }

  isBlocked(ip: string, now = Date.now()): { blocked: boolean; retryAfterSec: number } {
    const active = this.prune(ip, now);
    if (active.length < this.maxAttempts) {
      return { blocked: false, retryAfterSec: 0 };
    }
    const oldest = active[0];
    const retryAfterSec = Math.max(1, Math.ceil((this.windowMs - (now - oldest)) / 1000));
    return { blocked: true, retryAfterSec };
  }

  recordFailure(ip: string, now = Date.now()): void {
    const active = this.prune(ip, now);
    active.push(now);
    this.failures.set(ip, active);
  }

  reset(ip: string): void {
    this.failures.delete(ip);
  }
}

export function issueSessionCookie(c: Context, config: AuthConfig): string {
  const now = Date.now();
  const expiresAt = now + SESSION_MAX_AGE_SEC * 1000;
  const token = signToken(now, expiresAt, config.secret);
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: shouldUseSecureCookie(c, config.cookieSecure),
    path: '/',
    maxAge: SESSION_MAX_AGE_SEC,
  });
  return token;
}

export function extractSessionToken(c: Context): string | undefined {
  const cookieToken = getCookie(c, SESSION_COOKIE_NAME);
  if (cookieToken) return cookieToken;
  const authHeader = c.req.header('authorization');
  if (!authHeader) return undefined;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : undefined;
}

export function clearSessionCookie(c: Context, config: AuthConfig): void {
  deleteCookie(c, SESSION_COOKIE_NAME, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: shouldUseSecureCookie(c, config.cookieSecure),
  });
}

export function requireAuthMiddleware(config: AuthConfig): MiddlewareHandler {
  return async (c, next) => {
    const token = extractSessionToken(c);
    if (!verifySessionToken(token, config.secret)) {
      return c.json({ ok: false, error: '未登录或会话已过期' }, 401);
    }
    await next();
  };
}

// lib/printAuth.ts
// Short-lived HMAC tokens that guard /reports/rm/print so the URL
// isn't usable indefinitely. Puppeteer signs a token before navigating;
// the print route verifies it before rendering. 60-second window.
import crypto from 'crypto';

const TTL_SECONDS = 60;

function secret(): string {
  const s = process.env.RM_PRINT_SECRET;
  if (!s) throw new Error('RM_PRINT_SECRET env var is not set');
  return s;
}

interface TokenPayload {
  dateFrom:  string;
  dateTo:    string;
  territory?: string;
  siteCode?:  string;
}

/** Sign a token whose `expires` is now + TTL. Returns a `t=<token>` value. */
export function signPrintToken(payload: TokenPayload): string {
  const expires = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const body = JSON.stringify({ ...payload, expires });
  const b64 = Buffer.from(body, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

/** Verify and parse a token; throws on invalid/expired. */
export function verifyPrintToken(token: string | null): TokenPayload {
  if (!token || !token.includes('.')) throw new Error('Missing token');
  const [b64, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', secret()).update(b64).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error('Invalid token signature');
  }
  const decoded = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
  const now = Math.floor(Date.now() / 1000);
  if (typeof decoded.expires !== 'number' || decoded.expires < now) {
    throw new Error('Token expired');
  }
  return {
    dateFrom:  decoded.dateFrom,
    dateTo:    decoded.dateTo,
    territory: decoded.territory,
    siteCode:  decoded.siteCode,
  };
}

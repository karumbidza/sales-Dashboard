// app/api/auth/route.ts — DB-backed login / logout
import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

const COOKIE  = 'fsi_session';
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days in seconds

// ── Login ─────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();

  if (!username || !password) {
    return NextResponse.json({ error: 'Username and password required' }, { status: 400 });
  }

  // Look up user
  const user = await queryOne<any>(
    `SELECT id, username, display_name, password_hash, role, is_active
     FROM users WHERE LOWER(username) = LOWER($1)`,
    [username]
  );

  // Small delay regardless — prevents username enumeration
  await new Promise(r => setTimeout(r, 300));

  if (!user || !user.is_active) {
    return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
  }

  // Create session token
  const sessionId  = randomBytes(32).toString('hex');
  const expiresAt  = new Date(Date.now() + MAX_AGE * 1000);

  await query(
    `INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)`,
    [sessionId, user.id, expiresAt]
  );

  // Update last_login
  await query(`UPDATE users SET last_login = NOW() WHERE id = $1`, [user.id]);

  // Clean up expired sessions (housekeeping)
  query(`DELETE FROM sessions WHERE expires_at < NOW()`).catch(() => {});

  const res = NextResponse.json({
    ok:          true,
    displayName: user.display_name || user.username,
    role:        user.role,
  });

  res.cookies.set(COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    path:     '/',
    maxAge:   MAX_AGE,
    secure:   process.env.NODE_ENV === 'production',
  });

  return res;
}

// ── Logout ────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const sessionId = req.cookies.get(COOKIE)?.value;
  if (sessionId) {
    await query(`DELETE FROM sessions WHERE id = $1`, [sessionId]).catch(() => {});
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(COOKIE);
  return res;
}

// ── Verify (used by middleware helper) ───────────────────────────────────

export async function GET(req: NextRequest) {
  const sessionId = req.cookies.get(COOKIE)?.value;
  if (!sessionId) return NextResponse.json({ authed: false }, { status: 401 });

  const session = await queryOne<any>(
    `SELECT s.id, u.username, u.display_name, u.role
     FROM sessions s JOIN users u ON s.user_id = u.id
     WHERE s.id = $1 AND s.expires_at > NOW()`,
    [sessionId]
  );

  if (!session) return NextResponse.json({ authed: false }, { status: 401 });
  return NextResponse.json({ authed: true, username: session.username,
                              displayName: session.display_name, role: session.role });
}

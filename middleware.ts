import { NextRequest, NextResponse } from 'next/server';

const COOKIE = 'fsi_session';
const LOGIN  = '/login';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow login page and all API routes.
  // Pages are auth-gated by the middleware below; API routes are only
  // called from those authenticated pages (or server-to-server).
  if (pathname.startsWith(LOGIN) || pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  const sessionId = req.cookies.get(COOKIE)?.value;

  if (!sessionId) {
    return redirect(req, pathname);
  }

  // Validate session against DB via internal API call
  const verifyUrl = new URL('/api/auth', req.url);
  const verifyRes = await fetch(verifyUrl, {
    headers: { cookie: `${COOKIE}=${sessionId}` },
  });

  if (!verifyRes.ok) {
    return redirect(req, pathname);
  }

  return NextResponse.next();
}

function redirect(req: NextRequest, from: string) {
  // API calls → 401
  if (from.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Browser → redirect to login
  const url = req.nextUrl.clone();
  url.pathname = LOGIN;
  url.searchParams.set('next', from);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

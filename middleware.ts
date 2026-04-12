import { NextRequest, NextResponse } from 'next/server';

const COOKIE = 'fsi_session';
const LOGIN  = '/login';

// Shared secret for internal server-to-server calls (e.g. report route → kpis)
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || '__internal_dashboard_bypass__';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow login page and auth API
  if (pathname.startsWith(LOGIN) || pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  // Allow internal server-to-server API calls (e.g. report aggregation)
  if (pathname.startsWith('/api/') && req.nextUrl.searchParams.get('_ik') === INTERNAL_SECRET) {
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

// middleware.ts — API key authentication for all /api/* routes
import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only protect API routes
  if (!pathname.startsWith('/api/')) return NextResponse.next();

  const apiKey = req.headers.get('x-api-key');
  const cookieKey = req.cookies.get('api_key')?.value;
  const secret = process.env.API_SECRET_KEY;

  if (!secret) {
    // Fail closed — if the secret isn't configured, deny all API access
    console.error('API_SECRET_KEY environment variable is not set');
    return NextResponse.json({ error: 'Service misconfigured' }, { status: 503 });
  }

  if (apiKey !== secret && cookieKey !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};

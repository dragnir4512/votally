import { NextResponse, type NextRequest } from 'next/server';

// slug.votally.com  ->  /slug   (le navigateur garde l'adresse du sous-domaine)
const RESERVED = new Set(['www', 'app', 'api', 'admin', 'mail', 'cdn', 'static', 'assets', 'docs', 'help', 'status']);

export function middleware(req: NextRequest) {
  const host = (req.headers.get('host') ?? '').toLowerCase();
  const root = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost:3001').toLowerCase();
  if (!host.endsWith('.' + root)) return NextResponse.next();
  const sub = host.slice(0, -(root.length + 1));
  if (RESERVED.has(sub) || !/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/.test(sub)) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = `/${sub}${req.nextUrl.pathname === '/' ? '' : req.nextUrl.pathname}`;
  return NextResponse.rewrite(url);
}

export const config = { matcher: ['/((?!_next/|api/|favicon.ico).*)'] };

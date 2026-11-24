const PRIVATE_IPV4_RE =
  /^(127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})$/;

export const DEFAULT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'"
].join('; ');

export function isAllowedOrigin(
  originHeader: string | null,
  extraAllowedOrigins?: string,
  requestOrigin?: string
): boolean {
  if (!originHeader) return false;

  let parsed: URL;
  try {
    parsed = new URL(originHeader);
  } catch {
    return false;
  }

  const normalizedOrigin = parsed.origin.toLowerCase();
  if (extraAllowedOrigins) {
    const extras = extraAllowedOrigins
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (extras.includes(normalizedOrigin)) {
      return true;
    }
  }

  const host = parsed.hostname.toLowerCase();
  const proto = parsed.protocol.toLowerCase();

  if (requestOrigin && proto === 'https:') {
    try {
      const parsedRequest = new URL(requestOrigin);
      if (normalizedOrigin === parsedRequest.origin.toLowerCase()) {
        return true;
      }
    } catch {
      // Ignora requestOrigin non valido
    }
  }

  if (proto === 'https:') {
    if (host === 'sagitta-cartographer.pages.dev' || host === 'em-sagitta-cartografo.pages.dev') {
      return true;
    }
    if (/^[a-z0-9-]+\.(?:sagitta-cartographer|em-sagitta-cartografo)\.pages\.dev$/.test(host)) {
      return true;
    }
    if (
      /^(?:[a-z0-9-]+-)?(?:sagitta-cartographer|em-sagitta-cartografo)(?:-[a-z0-9-]+)?\.[a-z0-9-]+\.workers\.dev$/.test(
        host
      )
    ) {
      return true;
    }
  }

  if (proto === 'http:' || proto === 'https:') {
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
    if (host.endsWith('.local')) return true;
    if (PRIVATE_IPV4_RE.test(host)) return true;
  }

  return false;
}

export function applySecurityHeaders(headers: Headers): Headers {
  headers.set('Content-Security-Policy', DEFAULT_CSP);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set(
    'Permissions-Policy',
    'camera=(self), microphone=(), geolocation=(), payment=(), usb=()'
  );
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return headers;
}

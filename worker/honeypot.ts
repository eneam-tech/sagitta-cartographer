const TRAP_PATHS = new Set([
  '/.env',
  '/.env.local',
  '/.env.production',
  '/.env.development',
  '/.env.backup',
  '/.git/config',
  '/.git/HEAD',
  '/X-API-KEY.json',
  '/password.txt',
  '/secrets-config.json',
  '/api-keys.json',
  '/config.secrets.json',
  '/wp-login.php',
  '/wp-admin',
  '/wp-admin/',
  '/phpmyadmin',
  '/api/admin/keys',
  '/api/v1/secrets'
]);

export function normalizeTrapPath(pathname: string): string {
  const trimmed = pathname.trim();
  if (!trimmed.startsWith('/')) return `/${trimmed}`;
  return trimmed;
}

export function isHoneypotPath(pathname: string): boolean {
  const normalized = normalizeTrapPath(pathname);
  if (TRAP_PATHS.has(normalized)) return true;
  if (normalized.startsWith('/wp-admin/')) return true;
  if (normalized.startsWith('/.git/')) return true;
  if (normalized.startsWith('/.env')) return true;
  return false;
}

function randomHex(byteCount: number): string {
  const buf = new Uint8Array(byteCount);
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(buf);
  } else {
    for (let i = 0; i < buf.length; i += 1) {
      buf[i] = (i * 73 + 41) & 0xff;
    }
  }
  let out = '';
  for (let i = 0; i < buf.length; i += 1) {
    out += buf[i].toString(16).padStart(2, '0');
  }
  return out;
}

export function createHoneypotResponse(pathname: string): Response {
  const normalized = normalizeTrapPath(pathname);
  const headers = new Headers({
    'Cache-Control': 'no-store, max-age=0',
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  });

  if (normalized === '/password.txt' || normalized.startsWith('/.env')) {
    headers.set('Content-Type', 'text/plain; charset=utf-8');
    const body = [
      '# synthetic canary credential decoy (non-functional)',
      'ADMIN_USER=honeypot_warden',
      `ADMIN_PASS=sagitta-canary-pass-${randomHex(8)}`,
      `API_SIGNING_TOKEN=SAGITTA-CANARY-${randomHex(10).toUpperCase()}`,
      `DB_REPLICA_URI=postgres://decoy:canary_${randomHex(6)}@invalid.localhost:5432/decoy_db`
    ].join('\n');
    return new Response(body, { status: 200, headers });
  }

  if (normalized === '/wp-login.php' || normalized.startsWith('/wp-admin')) {
    headers.set('Content-Type', 'text/html; charset=utf-8');
    return new Response(
      '<!doctype html><html lang="en"><title>Sign In</title><body><form method="post"><input name="log" /><input type="password" name="pwd" /></form></body></html>',
      { status: 404, headers }
    );
  }

  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(
    JSON.stringify(
      {
        service: 'sagitta-edge-honeypot-decoy',
        warning: 'synthetic-canary-token-monitored',
        'x-api-key': `SAGITTA-CANARY-${randomHex(10).toUpperCase()}`,
        hmac_seed: `canary-seed-${randomHex(12)}`,
        timestamp: new Date().toISOString()
      },
      null,
      2
    ),
    { status: 200, headers }
  );
}

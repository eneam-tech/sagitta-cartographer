import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const SW_EXCLUDED_FILES = new Set([
  'sw.js',
  '_headers',
  'robots.txt',
  'X-API-KEY.json',
  'password.txt',
  'secrets-config.json'
]);

function sagittaPwaPlugin(): Plugin {
  return {
    name: 'sagitta-pwa-sw',
    apply: 'build',
    writeBundle(outputOptions, bundle) {
      const outDir = resolve(process.cwd(), outputOptions.dir ?? 'dist');
      const urlSet = new Set<string>(['/', '/index.html', '/manifest.webmanifest']);

      const staticPublicIcons = [
        'icons/icon-180.png',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/icon-maskable-512.png'
      ];
      for (const rel of staticPublicIcons) {
        if (existsSync(join(outDir, rel))) {
          urlSet.add(`/${rel}`);
        }
      }

      const hash = createHash('sha256');
      for (const [fileName, output] of Object.entries(bundle)) {
        const normalized = fileName.replace(/^\/+/, '');
        if (normalized.endsWith('.map') || SW_EXCLUDED_FILES.has(normalized)) {
          continue;
        }
        urlSet.add(`/${normalized}`);
        hash.update(normalized);
        if (output.type === 'chunk') {
          hash.update(output.code);
        } else if (typeof output.source === 'string' || output.source instanceof Uint8Array) {
          hash.update(output.source);
        }
      }

      for (const rel of staticPublicIcons) {
        const abs = join(outDir, rel);
        if (existsSync(abs)) {
          hash.update(readFileSync(abs));
        }
      }

      const versionHash = hash.digest('hex').slice(0, 10);
      const precacheUrls = Array.from(urlSet).sort();

      const swSource = `/* Sagitta - Cartografo Service Worker offline */
const CACHE_PREFIX = 'sagitta-cartografo-';
const CACHE_NAME = CACHE_PREFIX + '${versionHash}';
const PRECACHE_URLS = ${JSON.stringify(precacheUrls, null, 2)};
const IGNORED_PREFIXES = ['/api/'];
const IGNORED_EXACT = new Set([
  '/sw.js',
  '/_headers',
  '/robots.txt',
  '/X-API-KEY.json',
  '/password.txt',
  '/secrets-config.json',
  '/.env'
]);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (
    IGNORED_EXACT.has(url.pathname) ||
    IGNORED_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
  ) {
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((response) => {
          if (response && response.ok && url.pathname === '/') {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          }
          return response;
        })
        .catch(async () => {
          const cached =
            (await caches.match('/index.html', { ignoreSearch: true })) ||
            (await caches.match('/', { ignoreSearch: true }));
          return cached || Response.error();
        })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((response) => {
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return response;
      });
    })
  );
});
`;
      writeFileSync(join(outDir, 'sw.js'), swSource, 'utf8');
    }
  };
}

export default defineConfig({
  plugins: [react(), sagittaPwaPlugin()],
  server: {
    allowedHosts: true
  },
  preview: {
    allowedHosts: true
  },
  build: {
    target: 'es2022',
    sourcemap: true
  }
});

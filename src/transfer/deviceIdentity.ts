import { DeviceKindHint, sanitizeDeviceName } from './protocol';

const DEVICE_NAME_STORAGE_KEY = 'sagitta:deviceName';
const SIGNAL_URL_STORAGE_KEY = 'sagitta:signalUrl';

export function detectDeviceKind(): DeviceKindHint {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent || '';
  const platform = (navigator as { platform?: string }).platform || '';
  const maxTouchPoints = navigator.maxTouchPoints || 0;

  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1)) {
    return 'ipad';
  }
  if (/Macintosh|MacIntel|Mac OS X/i.test(ua) || /Mac/i.test(platform)) {
    return 'mac';
  }
  return 'desktop';
}

export function getDefaultDeviceName(kind: DeviceKindHint = detectDeviceKind()): string {
  if (kind === 'ipad') return 'iPad';
  if (kind === 'mac') return 'Mac';
  return 'Computer';
}

export function readStoredDeviceName(): string {
  const kind = detectDeviceKind();
  const fallback = getDefaultDeviceName(kind);
  try {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
      return fallback;
    }
    const stored = window.localStorage.getItem(DEVICE_NAME_STORAGE_KEY);
    if (!stored) return fallback;
    return sanitizeDeviceName(stored, fallback);
  } catch {
    return fallback;
  }
}

export function writeStoredDeviceName(name: string): string {
  const sanitized = sanitizeDeviceName(name, getDefaultDeviceName());
  try {
    if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
      window.localStorage.setItem(DEVICE_NAME_STORAGE_KEY, sanitized);
    }
  } catch {
    // Modalità privata o storage disabilitato
  }
  return sanitized;
}

export function readStoredSignalUrl(): string {
  try {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
      return '';
    }
    return (window.localStorage.getItem(SIGNAL_URL_STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function writeStoredSignalUrl(url: string): string {
  const trimmed = url.trim();
  try {
    if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
      if (trimmed) {
        window.localStorage.setItem(SIGNAL_URL_STORAGE_KEY, trimmed);
      } else {
        window.localStorage.removeItem(SIGNAL_URL_STORAGE_KEY);
      }
    }
  } catch {
    // Modalità privata o storage disabilitato
  }
  return trimmed;
}

export function normalizeSignalWebSocketUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return resolveDefaultSignalUrl();
  if (/^wss?:\/\//i.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    const parsed = new URL(trimmed);
    const proto = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    const path = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '/api/signal';
    return `${proto}//${parsed.host}${path}`;
  }
  return resolveDefaultSignalUrl();
}

export function resolveDefaultSignalUrl(): string {
  const stored = readStoredSignalUrl();
  if (stored) {
    return /^wss?:\/\//i.test(stored) ? stored : normalizeSignalWebSocketUrl(stored);
  }

  const envUrl = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_SIGNAL_URL;
  if (envUrl && envUrl.trim()) {
    return envUrl.trim();
  }

  if (typeof window !== 'undefined' && window.location) {
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProto}//${window.location.host}/api/signal`;
  }

  return 'wss://sagitta-cartographer.workers.dev/api/signal';
}

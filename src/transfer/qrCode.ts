import { encode } from 'uqr';
import { formatPairingCode } from './protocol';

export interface QrMatrix {
  size: number;
  data: boolean[][];
}

export function buildPairingQrPayload(code: string, origin?: string): string {
  const formatted = formatPairingCode(code);
  if (origin && /^https?:\/\//i.test(origin)) {
    const cleanOrigin = origin.replace(/\/+$/, '');
    return `${cleanOrigin}/?pair=${encodeURIComponent(formatted)}`;
  }
  return `sagitta-pair://${formatted}`;
}

export function encodePairingQrMatrix(payload: string): QrMatrix {
  const result = encode(payload, {
    ecc: 'M',
    border: 2
  });
  return {
    size: result.size,
    data: result.data
  };
}

import { unzlibSync, zlibSync } from 'fflate';

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function writeU32BE(buf: Uint8Array, offset: number, val: number): void {
  buf[offset] = (val >>> 24) & 0xff;
  buf[offset + 1] = (val >>> 16) & 0xff;
  buf[offset + 2] = (val >>> 8) & 0xff;
  buf[offset + 3] = val & 0xff;
}

function readU32BE(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset] << 24) |
      (buf[offset + 1] << 16) |
      (buf[offset + 2] << 8) |
      buf[offset + 3]) >>>
    0
  );
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  writeU32BE(chunk, 0, data.length);
  for (let i = 0; i < 4; i += 1) {
    chunk[4 + i] = type.charCodeAt(i);
  }
  chunk.set(data, 8);
  const crc = crc32(chunk.subarray(4, 8 + data.length));
  writeU32BE(chunk, 8 + data.length, crc);
  return chunk;
}

/**
 * Encodes an 8-bit land mask losslessly as an RGBA PNG (RGB=255, A=mask[i])
 * using pure TypeScript + fflate so encoding works identically in browser & Node
 * with zero Canvas premultiplication artifacts.
 */
export function encodeMaskPng(mask: Uint8Array, width: number, height: number): Uint8Array {
  if (mask.length !== width * height) {
    throw new Error(`Lunghezza maschera (${mask.length}) non coerente con ${width}×${height}.`);
  }
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOut = y * (stride + 1);
    raw[rowOut] = 0; // Filter type 0 (None)
    const rowIn = y * width;
    for (let x = 0; x < width; x += 1) {
      const p = rowOut + 1 + x * 4;
      raw[p] = 255;
      raw[p + 1] = 255;
      raw[p + 2] = 255;
      raw[p + 3] = mask[rowIn + x];
    }
  }

  const ihdr = new Uint8Array(13);
  writeU32BE(ihdr, 0, width);
  writeU32BE(ihdr, 4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const compressed = zlibSync(raw, { level: 6 });
  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', new Uint8Array(0));

  const out = new Uint8Array(PNG_SIGNATURE.length + ihdrChunk.length + idatChunk.length + iendChunk.length);
  let pos = 0;
  out.set(PNG_SIGNATURE, pos);
  pos += PNG_SIGNATURE.length;
  out.set(ihdrChunk, pos);
  pos += ihdrChunk.length;
  out.set(idatChunk, pos);
  pos += idatChunk.length;
  out.set(iendChunk, pos);
  return out;
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function bytesPerPixelForColorType(colorType: number, bitDepth: number): number {
  if (bitDepth !== 8) {
    throw new Error(`Profondità di bit PNG non supportata: ${bitDepth}.`);
  }
  switch (colorType) {
    case 0:
      return 1; // Grayscale
    case 2:
      return 3; // RGB
    case 3:
      return 1; // Indexed
    case 4:
      return 2; // Grayscale + Alpha
    case 6:
      return 4; // RGBA
    default:
      throw new Error(`Tipo di colore PNG non supportato: ${colorType}.`);
  }
}

export function decodeMaskPng(bytes: Uint8Array): { width: number; height: number; mask: Uint8Array } {
  if (bytes.length < 33) {
    throw new Error('File PNG della maschera troncato o troppo corto.');
  }
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      throw new Error('Intestazione PNG della maschera non valida.');
    }
  }

  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let sawIhdr = false;
  let sawIend = false;
  let trnsAlpha: Uint8Array | null = null;
  const idatParts: Uint8Array[] = [];

  while (pos + 12 <= bytes.length) {
    const length = readU32BE(bytes, pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const dataStart = pos + 8;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;
    if (crcEnd > bytes.length) {
      throw new Error(`Chunk PNG "${type}" troncato.`);
    }
    const expectedCrc = readU32BE(bytes, dataEnd);
    const actualCrc = crc32(bytes.subarray(pos + 4, dataEnd));
    if (expectedCrc !== actualCrc) {
      throw new Error(`Checksum CRC non valido nel chunk PNG "${type}".`);
    }

    const data = bytes.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      if (data.length !== 13) throw new Error('Chunk IHDR PNG non valido.');
      width = readU32BE(data, 0);
      height = readU32BE(data, 4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) {
        throw new Error('PNG interlacciato non supportato.');
      }
      sawIhdr = true;
    } else if (type === 'IDAT') {
      idatParts.push(data);
    } else if (type === 'tRNS') {
      trnsAlpha = data;
    } else if (type === 'IEND') {
      sawIend = true;
      break;
    }

    pos = crcEnd;
  }

  if (!sawIhdr || !sawIend || idatParts.length === 0 || width <= 0 || height <= 0) {
    throw new Error('Struttura PNG della maschera incompleta (IHDR/IDAT/IEND).');
  }

  const totalIdatLen = idatParts.reduce((acc, part) => acc + part.length, 0);
  const compressed = new Uint8Array(totalIdatLen);
  let idatOffset = 0;
  for (const part of idatParts) {
    compressed.set(part, idatOffset);
    idatOffset += part.length;
  }

  let raw: Uint8Array;
  try {
    raw = unzlibSync(compressed);
  } catch {
    throw new Error('Dati compressi della maschera PNG corrotti.');
  }

  const bpp = bytesPerPixelForColorType(colorType, bitDepth);
  const stride = width * bpp;
  const expectedRawLen = (stride + 1) * height;
  if (raw.length !== expectedRawLen) {
    throw new Error('Dimensione dei dati immagine PNG non coerente con IHDR.');
  }

  const reconstructed = new Uint8Array(width * height * bpp);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const rowIn = y * (stride + 1) + 1;
    const rowOut = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const rawVal = raw[rowIn + x];
      const left = x >= bpp ? reconstructed[rowOut + x - bpp] : 0;
      const up = y > 0 ? reconstructed[rowOut - stride + x] : 0;
      const upLeft = x >= bpp && y > 0 ? reconstructed[rowOut - stride + x - bpp] : 0;

      let recon = rawVal;
      if (filter === 1) recon = (rawVal + left) & 0xff;
      else if (filter === 2) recon = (rawVal + up) & 0xff;
      else if (filter === 3) recon = (rawVal + ((left + up) >> 1)) & 0xff;
      else if (filter === 4) recon = (rawVal + paethPredictor(left, up, upLeft)) & 0xff;
      else if (filter !== 0) {
        throw new Error(`Filtro scanline PNG non valido: ${filter}.`);
      }
      reconstructed[rowOut + x] = recon;
    }
  }

  const mask = new Uint8Array(width * height);
  const total = width * height;
  if (colorType === 6) {
    for (let i = 0; i < total; i += 1) {
      mask[i] = reconstructed[i * 4 + 3];
    }
  } else if (colorType === 4) {
    for (let i = 0; i < total; i += 1) {
      mask[i] = reconstructed[i * 2 + 1];
    }
  } else if (colorType === 0) {
    mask.set(reconstructed);
  } else if (colorType === 2) {
    for (let i = 0; i < total; i += 1) {
      mask[i] = reconstructed[i * 3] > 127 ? 255 : 0;
    }
  } else if (colorType === 3) {
    for (let i = 0; i < total; i += 1) {
      const idx = reconstructed[i];
      mask[i] = trnsAlpha && idx < trnsAlpha.length ? trnsAlpha[idx] : 255;
    }
  }

  return { width, height, mask };
}

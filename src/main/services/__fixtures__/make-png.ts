import { deflateSync } from 'node:zlib'

/**
 * A PNG built out of its parts, rather than pasted in as base64.
 *
 * The base64 blob this replaces was subtly corrupt — a truncated `IDAT` and a
 * mangled `IEND` — which nothing noticed, because a browser renders a damaged
 * PNG cheerfully and only a stricter decoder complains. That cost an hour of
 * hunting a bug in the code that reads images, when the fault was in the fixture
 * being read. Built here, it is correct by construction and its dimensions and
 * colour are visible in the test that asks for them.
 */

/** A chunk: length, type, data, and the CRC-32 of type and data. */
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

const TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(data: Buffer): number {
  let c = 0xffffffff
  for (const byte of data) c = TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** A solid rectangle of one colour, eight bits a channel, no alpha. */
export function makePng(
  width: number,
  height: number,
  colour: { r: number; g: number; b: number } = { r: 220, g: 40, b: 40 }
): Buffer {
  // Each row is preceded by its filter byte, which is zero: no filtering.
  const row = Buffer.alloc(1 + width * 3)
  for (let x = 0; x < width; x++) {
    row[1 + x * 3] = colour.r
    row[2 + x * 3] = colour.g
    row[3 + x * 3] = colour.b
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row))

  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // truecolour
  header[10] = 0 // deflate
  header[11] = 0 // adaptive filtering
  header[12] = 0 // no interlacing

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

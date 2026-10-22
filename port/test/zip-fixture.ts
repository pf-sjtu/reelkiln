// PORT-NEW test helper (docs/40 M23): a tiny ZIP writer able to produce well-formed AND hostile archives
// (zip-slip names, symlink / device mode bits, encryption flag, odd compression methods, bad CRC, overlapping
// local headers) to drive the ORIGINAL extractArchive / inspectZipContainer.
import { deflateRawSync, crc32 } from "node:zlib";

export interface ZipEntry { name: string; data?: Buffer | string; method?: number; flags?: number; mode?: number; crc?: number; uncompressed?: number; dir?: boolean; offsetOverride?: number }
export function makeZip(entries: ZipEntry[]): Buffer {
  const out: Buffer[] = []; const cd: Buffer[] = []; let offset = 0; const offsets: number[] = [];
  for (const e of entries) {
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data ?? "", "utf8");
    const method = e.method ?? 0;
    const packed = method === 8 ? deflateRawSync(raw) : raw;
    // traditional PKWARE encryption: a 12-byte encryption header precedes the (here: unencrypted) payload
    const body = (e.flags ?? 0) & 1 ? Buffer.concat([Buffer.alloc(12, 0xa5), packed]) : packed;
    const name = Buffer.from(e.name, "utf8");
    const crc = e.crc ?? crc32(raw);
    const usize = e.uncompressed ?? raw.length;
    const flags = (e.flags ?? 0) | 0x800;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc >>> 0, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(usize, 22); local.writeUInt16LE(name.length, 26);
    offsets.push(offset);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE((3 << 8) | 20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(flags, 8); c.writeUInt16LE(method, 10);
    c.writeUInt32LE(crc >>> 0, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(usize, 24); c.writeUInt16LE(name.length, 28);
    const mode = e.mode ?? (e.dir ? 0o040755 : 0o100644);
    c.writeUInt32LE(((mode & 0xffff) << 16) >>> 0, 38);
    c.writeUInt32LE(e.offsetOverride ?? offset, 42);
    out.push(local, name, body); cd.push(c, name);
    offset += 30 + name.length + body.length;
  }
  const cdb = Buffer.concat(cd);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cdb.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...out, cdb, end]);
}

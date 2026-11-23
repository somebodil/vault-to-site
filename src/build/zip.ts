/**
 * Writes a zip archive, piece by piece.
 *
 * A site is some hundred files. Written as one archive it is one file to move
 * off a phone, to send, or to keep. The archive is made here and not by a
 * library: the format needs little for what a site holds, and the plugin
 * stays small.
 *
 * Every file is added with `add`, and the pieces of the archive are handed to
 * `sink` in order as they are ready, so that an archive larger than the
 * memory of a phone can be written. `finish` adds the list of files that ends
 * an archive.
 */

/** Takes the next piece of the archive */
export type ZipSink = (piece: Uint8Array) => Promise<void>;

/** Makes data smaller (raw deflate), or returns null where the browser cannot */
export type Deflate = (data: Uint8Array) => Promise<Uint8Array | null>;

/** A file that is ready to be added to an archive */
export interface Packed {
  name: Uint8Array;
  crc: number;
  size: number;
  method: number;
  /** The content as it goes into the archive */
  body: Uint8Array;
}

interface Entry {
  name: Uint8Array;
  crc: number;
  packed: number;
  size: number;
  method: number;
  offset: number;
}

/** The archive cannot be larger, or hold more files, without the 64-bit form of the format, which is not written here */
const MOST_BYTES = 0xffffffff;
const MOST_FILES = 0xffff;

const STORED = 0;
const DEFLATED = 8;
/** Names are UTF-8 */
const FLAGS = 0x0800;

let table: Uint32Array | null = null;

/** The CRC-32 checksum a zip archive keeps of every file */
export function crc32(data: Uint8Array): number {
  if (table === null) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
  }
  const t = table;
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = t[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Raw deflate with what the browser has. Null where it has none: files are then stored as they are. */
export const browserDeflate: Deflate = async (data) => {
  if (typeof CompressionStream === "undefined") {
    return null;
  }
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

/** Endings of files that are compressed already: making them smaller again costs time and gains nothing */
const PACKED_ALREADY = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "avif", "heic", "woff", "woff2", "mp3", "m4a", "ogg", "flac", "mp4", "webm", "mov", "mkv", "zip", "gz", "7z", "pdf", "docx", "xlsx", "pptx",
]);

export function isPackedAlready(name: string): boolean {
  return PACKED_ALREADY.has(name.slice(name.lastIndexOf(".") + 1).toLowerCase());
}

/** The date and time as a zip archive keeps them: local time, in steps of two seconds, from 1980 on */
function dosDateTime(date: Date): { time: number; day: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export class ZipWriter {
  private readonly entries: Entry[] = [];
  private readonly sink: ZipSink;
  private readonly deflate: Deflate;
  private readonly stamp: { time: number; day: number };
  private offset = 0;

  constructor(sink: ZipSink, deflate: Deflate = browserDeflate, date: Date = new Date()) {
    this.sink = sink;
    this.deflate = deflate;
    this.stamp = dosDateTime(date);
  }

  /** Adds a file. The name is a path with `/` between its parts. */
  async add(name: string, data: Uint8Array): Promise<void> {
    await this.put(await this.pack(name, data));
  }

  /**
   * Makes a file ready to be added: smaller, where that helps. Several files
   * can be made ready at the same time; they are added one after the other
   * with `put`.
   */
  async pack(name: string, data: Uint8Array): Promise<Packed> {
    const packed = isPackedAlready(name) || data.length === 0 ? null : await this.deflate(data);
    const body = packed !== null && packed.length < data.length ? packed : data;
    return { name: new TextEncoder().encode(name), crc: crc32(data), size: data.length, method: body === data ? STORED : DEFLATED, body };
  }

  /** Adds a file that `pack` made ready. One at a time: the next only when this one has resolved. */
  async put(file: Packed): Promise<void> {
    if (this.entries.length >= MOST_FILES) {
      throw new Error("The site has too many files for one zip archive. Build it as a folder.");
    }
    const body = file.body;
    const entry: Entry = { name: file.name, crc: file.crc, packed: body.length, size: file.size, method: file.method, offset: this.offset };
    if (this.offset + 30 + entry.name.length + body.length > MOST_BYTES) {
      throw new Error("The site is too large for one zip archive (4 GB). Build it as a folder.");
    }
    const header = new Uint8Array(30 + entry.name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    this.common(view, 4, entry);
    header.set(entry.name, 30);
    await this.emit(header);
    await this.emit(body);
    this.entries.push(entry);
  }

  /** Ends the archive with the list of its files. Nothing can be added after it. */
  async finish(): Promise<void> {
    const start = this.offset;
    for (const entry of this.entries) {
      const record = new Uint8Array(46 + entry.name.length);
      const view = new DataView(record.buffer);
      view.setUint32(0, 0x02014b50, true);
      // Made by: version 2.0 of the format, on a system with paths like those of UNIX
      view.setUint16(4, (3 << 8) | 20, true);
      this.common(view, 6, entry);
      // No comment, first disk, no attributes inside; outside: a plain file that all may read
      view.setUint32(38, (0o100644 << 16) >>> 0, true);
      view.setUint32(42, entry.offset, true);
      record.set(entry.name, 46);
      await this.emit(record);
    }
    const end = new Uint8Array(22);
    const view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(8, this.entries.length, true);
    view.setUint16(10, this.entries.length, true);
    view.setUint32(12, this.offset - start, true);
    view.setUint32(16, start, true);
    await this.emit(end);
  }

  /** The fields that the header before a file and its line in the list share, from the version needed on */
  private common(view: DataView, at: number, entry: Entry): void {
    view.setUint16(at, 20, true);
    view.setUint16(at + 2, FLAGS, true);
    view.setUint16(at + 4, entry.method, true);
    view.setUint16(at + 6, this.stamp.time, true);
    view.setUint16(at + 8, this.stamp.day, true);
    view.setUint32(at + 10, entry.crc, true);
    view.setUint32(at + 14, entry.packed, true);
    view.setUint32(at + 18, entry.size, true);
    view.setUint16(at + 22, entry.name.length, true);
  }

  private async emit(piece: Uint8Array): Promise<void> {
    this.offset += piece.length;
    if (piece.length > 0) {
      await this.sink(piece);
    }
  }
}

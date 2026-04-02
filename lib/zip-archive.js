import { readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';

const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_VERSION = 20;
const ZIP_STORE_METHOD = 0;
const ZIP_UTF8_FLAG = 1 << 11;

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function normalizeEntryName(name) {
  return String(name || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function toDosDateTime(date = new Date()) {
  const year = Math.min(Math.max(date.getUTCFullYear(), 1980), 2107);
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = Math.floor(date.getUTCSeconds() / 2);

  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  return { dosDate, dosTime };
}

export async function createZipArchive(outputPath, entries = []) {
  const normalizedEntries = entries.map((entry) => ({
    name: normalizeEntryName(entry.name),
    data: Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || ''),
    date: entry.date instanceof Date ? entry.date : new Date(),
  }));

  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of normalizedEntries) {
    const nameBuffer = Buffer.from(entry.name, 'utf8');
    const dataBuffer = entry.data;
    const checksum = crc32(dataBuffer);
    const { dosDate, dosTime } = toDosDateTime(entry.date);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(ZIP_LOCAL_FILE_HEADER, 0);
    localHeader.writeUInt16LE(ZIP_VERSION, 4);
    localHeader.writeUInt16LE(ZIP_UTF8_FLAG, 6);
    localHeader.writeUInt16LE(ZIP_STORE_METHOD, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(dataBuffer.length, 18);
    localHeader.writeUInt32LE(dataBuffer.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuffer, dataBuffer);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(ZIP_CENTRAL_DIRECTORY_HEADER, 0);
    centralHeader.writeUInt16LE(ZIP_VERSION, 4);
    centralHeader.writeUInt16LE(ZIP_VERSION, 6);
    centralHeader.writeUInt16LE(ZIP_UTF8_FLAG, 8);
    centralHeader.writeUInt16LE(ZIP_STORE_METHOD, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(dataBuffer.length, 20);
    centralHeader.writeUInt32LE(dataBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + dataBuffer.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(ZIP_END_OF_CENTRAL_DIRECTORY, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(normalizedEntries.length, 8);
  endRecord.writeUInt16LE(normalizedEntries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(offset, 16);
  endRecord.writeUInt16LE(0, 20);

  const archiveBuffer = Buffer.concat([...localParts, centralDirectory, endRecord]);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, archiveBuffer);
  return outputPath;
}

function findEndOfCentralDirectory(buffer) {
  const signature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const start = Math.max(0, buffer.length - 65_557);
  for (let index = buffer.length - 22; index >= start; index -= 1) {
    if (buffer[index] === signature[0]
      && buffer[index + 1] === signature[1]
      && buffer[index + 2] === signature[2]
      && buffer[index + 3] === signature[3]) {
      return index;
    }
  }
  return -1;
}

export async function listZipEntries(filePath) {
  const buffer = await readFile(filePath);
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) {
    throw new Error(`Invalid ZIP archive: could not find end-of-central-directory in ${filePath}`);
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== ZIP_CENTRAL_DIRECTORY_HEADER) {
      throw new Error(`Invalid ZIP archive: bad central directory header at offset ${offset}`);
    }

    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const crc = buffer.readUInt32LE(offset + 16);
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    entries.push({
      name,
      general_purpose_bit_flag: flags,
      utf8: Boolean(flags & ZIP_UTF8_FLAG),
      compression_method: method,
      compressed_size: compressedSize,
      uncompressed_size: uncompressedSize,
      crc32: crc.toString(16).padStart(8, '0'),
    });

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

export async function readZipEntry(filePath, entryName) {
  const normalizedEntryName = normalizeEntryName(entryName);
  const buffer = await readFile(filePath);
  const eocdOffset = findEndOfCentralDirectory(buffer);
  if (eocdOffset < 0) {
    throw new Error(`Invalid ZIP archive: could not find end-of-central-directory in ${filePath}`);
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== ZIP_CENTRAL_DIRECTORY_HEADER) {
      throw new Error(`Invalid ZIP archive: bad central directory header at offset ${offset}`);
    }

    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    if (name === normalizedEntryName) {
      if (method !== ZIP_STORE_METHOD) {
        throw new Error(`ZIP entry ${normalizedEntryName} in ${filePath} uses unsupported compression method ${method}`);
      }

      const localSignature = buffer.readUInt32LE(localHeaderOffset);
      if (localSignature !== ZIP_LOCAL_FILE_HEADER) {
        throw new Error(`Invalid ZIP archive: bad local file header for ${normalizedEntryName} at offset ${localHeaderOffset}`);
      }

      const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const data = buffer.subarray(dataOffset, dataOffset + compressedSize);

      return {
        name,
        data,
        general_purpose_bit_flag: flags,
        utf8: Boolean(flags & ZIP_UTF8_FLAG),
        compression_method: method,
        compressed_size: compressedSize,
        uncompressed_size: uncompressedSize,
      };
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  throw new Error(`ZIP entry not found in ${filePath}: ${normalizedEntryName}`);
}

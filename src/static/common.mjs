import { createHash } from 'node:crypto';
import path from 'node:path';

export function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

export function toBytes(value, label = 'file') {
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  if (value instanceof Uint8Array) return Buffer.from(value);
  throw new Error(label + ' must be text or bytes');
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function safeRelativePath(value, label = 'file path') {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\') ||
      value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.includes('\0')) {
    throw new Error(label + ' is not a safe relative path');
  }
  const segments = value.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error(label + ' is not a safe relative path');
  }
  if (path.posix.normalize(value) !== value) throw new Error(label + ' is not normalized');
  return value;
}

export function hashNamedFiles(files) {
  if (!(files instanceof Map)) throw new Error('files must be a Map');
  const hash = createHash('sha256');
  const names = [...files.keys()].sort(compareUtf8);
  for (const name of names) {
    safeRelativePath(name);
    const nameBytes = Buffer.from(name, 'utf8');
    const bytes = toBytes(files.get(name), name);
    const nameLength = Buffer.alloc(4);
    nameLength.writeUInt32BE(nameBytes.byteLength);
    const contentLength = Buffer.alloc(8);
    contentLength.writeBigUInt64BE(BigInt(bytes.byteLength));
    hash.update(nameLength);
    hash.update(nameBytes);
    hash.update(contentLength);
    hash.update(bytes);
  }
  return hash.digest('hex');
}

export function isPathInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative !== '' && relative !== '..' &&
    !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

export function assertChildPath(parent, candidate, label = 'path') {
  if (!isPathInside(parent, candidate)) throw new Error(label + ' escapes its parent directory');
  return path.resolve(candidate);
}

export function parseJson(bytes, label) {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch (error) {
    throw new Error(label + ' is not valid JSON', { cause: error });
  }
}

export function jsonBytes(value) {
  return Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error(label + ' must be an object');
  }
  return value;
}

export function assertExactKeys(value, expected, label) {
  assertPlainObject(value, label);
  const actual = Object.keys(value).sort(compareUtf8);
  const wanted = [...expected].sort(compareUtf8);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(label + ' has missing or unsupported fields');
  }
}


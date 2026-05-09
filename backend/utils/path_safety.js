// backend/utils/path_safety.js
// Validate untrusted strings that will be joined into a filesystem path.
// Throws an Error with .statusCode = 400 so route handlers using
// fastify reply.send() can surface a clean 400 to clients.

function assertSafePathSegment(value, name) {
  if (typeof value !== 'string') {
    const err = new Error(`${name} must be a string`);
    err.statusCode = 400;
    throw err;
  }
  if (value.length === 0 || value.length > 255) {
    const err = new Error(`${name} length out of range`);
    err.statusCode = 400;
    throw err;
  }
  if (/[\/\\]|\.\.|\x00|[\x01-\x1f]/.test(value)) {
    const err = new Error(`${name} contains illegal characters`);
    err.statusCode = 400;
    throw err;
  }
}

// For inputs that are allowed to contain path separators (e.g. a nested folder
// path within a known root), validate each segment independently. Empty
// segments and segments that consist only of dots are rejected.
function assertSafeRelativePath(value, name) {
  if (typeof value !== 'string') {
    const err = new Error(`${name} must be a string`);
    err.statusCode = 400;
    throw err;
  }
  if (value.length === 0 || value.length > 4096) {
    const err = new Error(`${name} length out of range`);
    err.statusCode = 400;
    throw err;
  }
  const segments = value.split(/[\/\\]/);
  for (const seg of segments) {
    if (seg === '') continue; // tolerate leading/trailing or doubled separators
    if (seg === '.' || seg === '..') {
      const err = new Error(`${name} contains illegal segment`);
      err.statusCode = 400;
      throw err;
    }
    assertSafePathSegment(seg, name);
  }
}

module.exports = {
  assertSafePathSegment,
  assertSafeRelativePath
};

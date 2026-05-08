'use strict';

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SERVER = path.join(REPO_ROOT, 'server.js');

function makeDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kasmgt-jwt-test-'));
}

function makeDbConfig(dataDir) {
  const file = path.join(dataDir, 'db-config.json');
  fs.writeFileSync(file, JSON.stringify({
    database: { type: 'mongodb', connectionString: 'mongodb://localhost:27017/asmgt-test' },
    read: { source: 'excel' },
    write: { targets: ['excel'] }
  }), 'utf8');
  return file;
}

function spawnServer({ env = {}, port } = {}) {
  const dataDir = makeDataDir();
  const dbConfig = makeDbConfig(dataDir);
  const merged = {
    ...process.env,
    KASMGT_DATA_DIR: dataDir,
    KASMGT_DB_CONFIG: dbConfig,
    PORT: String(port || 0),
    ...env
  };
  // Remove the JWT_SECRET inherited from the parent unless caller set one
  if (!('JWT_SECRET' in env)) delete merged.JWT_SECRET;
  const child = spawn(process.execPath, [SERVER], { env: merged, stdio: ['ignore', 'pipe', 'pipe'] });
  return { child, dataDir };
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch (_) {}
      resolve({ exited: false, code: null, signal: null });
    }, timeoutMs);
    child.on('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve({ exited: true, code, signal });
    });
  });
}

function waitForRunning(child, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      // Did NOT exit, which means it is running.
      resolve({ running: true });
    }, timeoutMs);
    child.on('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve({ running: false, code, signal });
    });
  });
}

function cleanup(child) {
  try { child.kill('SIGKILL'); } catch (_) {}
}

describe('JWT_SECRET startup validation', () => {
  test('exits non-zero when JWT_SECRET is unset', async () => {
    const { child } = spawnServer();
    const result = await waitForExit(child, 5000);
    cleanup(child);
    expect(result.exited).toBe(true);
    expect(result.code).not.toBe(0);
  }, 10000);

  test('exits non-zero when JWT_SECRET is too short', async () => {
    const { child } = spawnServer({ env: { JWT_SECRET: 'short' } });
    const result = await waitForExit(child, 5000);
    cleanup(child);
    expect(result.exited).toBe(true);
    expect(result.code).not.toBe(0);
  }, 10000);

  test('exits non-zero when JWT_SECRET is the literal placeholder', async () => {
    const { child } = spawnServer({ env: { JWT_SECRET: 'change-me-to-a-real-secret' } });
    const result = await waitForExit(child, 5000);
    cleanup(child);
    expect(result.exited).toBe(true);
    expect(result.code).not.toBe(0);
  }, 10000);

  test('keeps running with a valid 64-byte hex secret', async () => {
    const secret = crypto.randomBytes(64).toString('hex');
    const { child } = spawnServer({ env: { JWT_SECRET: secret } });
    const result = await waitForRunning(child, 3000);
    cleanup(child);
    expect(result.running).toBe(true);
  }, 10000);
});

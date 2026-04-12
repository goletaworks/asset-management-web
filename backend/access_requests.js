// backend/access_requests.js
// Stores access requests + verification codes and handles validation.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sendAccessRequestEmail } = require('./mailer');

const DATA_DIR = process.env.KASMGT_DATA_DIR || path.join(__dirname, '..', 'data');
const LOGIN_DIR = path.join(DATA_DIR, 'login');
const REQUESTS_FILE = path.join(LOGIN_DIR, 'access_requests.json');
const APPROVERS = [
  { name: 'Khodayar Ahktarhavari', email: 'khodayar.ahktarhavari@ec.gc.ca' },
  { name: 'Hiroki Haji', email: 'hiroki.haji@ec.gc.ca' }
];

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(LOGIN_DIR)) {
    fs.mkdirSync(LOGIN_DIR, { recursive: true });
  }
  if (!fs.existsSync(REQUESTS_FILE)) {
    fs.writeFileSync(REQUESTS_FILE, '[]', 'utf8');
  }
}

function readRequests() {
  try {
    ensureDataFile();
    const raw = fs.readFileSync(REQUESTS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[access_requests] Failed to read requests file:', err);
    return [];
  }
}

function writeRequests(requests) {
  try {
    ensureDataFile();
    fs.writeFileSync(REQUESTS_FILE, JSON.stringify(requests, null, 2), 'utf8');
  } catch (err) {
    console.error('[access_requests] Failed to write requests file:', err);
  }
}

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6-digit numeric
}

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code || '').trim()).digest('hex');
}

function findApprover(selectedName) {
  const normalized = String(selectedName || '').trim().toLowerCase();
  return APPROVERS.find(a => a.name.toLowerCase() === normalized);
}

const LEGACY_PERMISSION_LEVEL = 'Read and Edit General Info and Delete Functionalities';
const UPDATED_PERMISSION_LEVEL = 'Read and Edit, including General Info, and Add Infrastructure';

function sanitizePermissionLevel(level) {
  const normalized = level === LEGACY_PERMISSION_LEVEL ? UPDATED_PERMISSION_LEVEL : level;
  const allowed = ['Read Only', 'Read and Edit', UPDATED_PERMISSION_LEVEL, 'Full Admin'];
  if (allowed.includes(normalized)) return normalized;
  return 'Read Only';
}

async function createRequest({ name, email, passwordHash, reason, approverName, permissionLevel }) {
  if (!name || !email || !passwordHash || !reason || !approverName || !permissionLevel) {
    return { success: false, message: 'All fields are required' };
  }

  const approver = findApprover(approverName);
  if (!approver) {
    return { success: false, message: 'Invalid approver selected' };
  }

  const code = generateCode();
  const codeHash = hashCode(code);
  const requests = readRequests();
  const now = new Date().toISOString();

  const record = {
    id: crypto.randomUUID(),
    name: name.trim(),
    email: String(email || '').trim().toLowerCase(),
    passwordHash,
    reason,
    approver: approver.name,
    approverEmail: approver.email,
    permissionLevel: sanitizePermissionLevel(permissionLevel),
    codeHash,
    status: 'pending',
    createdAt: now
  };

  requests.push(record);
  writeRequests(requests);

  // Fire-and-forget email (with console fallback if SMTP is not configured).
  const emailResult = await sendAccessRequestEmail({
    to: approver.email,
    requesterName: record.name,
    requesterEmail: record.email,
    reason: record.reason,
    permissionLevel: record.permissionLevel,
    code,
    approverName: approver.name
  });

  return {
    success: true,
    simulated: emailResult.simulated,
    message: emailResult.message || 'Request sent'
  };
}

function findMatchingRequest(nameOrEmail, code) {
  const needle = String(nameOrEmail || '').trim().toLowerCase();
  const requests = readRequests();
  const codeHash = hashCode(code);

  const idx = requests.findIndex(r => {
    const matchesIdentity =
      r.name.toLowerCase() === needle || (r.email || '').toLowerCase() === needle;
    return matchesIdentity && r.codeHash === codeHash && r.status === 'pending';
  });

  if (idx === -1) return { match: null, requests };
  return { match: requests[idx], requests, index: idx };
}

async function consumeRequest(nameOrEmail, code) {
  const { match, requests, index } = findMatchingRequest(nameOrEmail, code);
  if (!match) {
    return { success: false, message: 'Invalid access code or request not found' };
  }
  // Remove the request to prevent reuse
  requests.splice(index, 1);
  writeRequests(requests);
  return { success: true, request: match };
}

module.exports = {
  createRequest,
  consumeRequest,
  APPROVERS
};

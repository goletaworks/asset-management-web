#!/usr/bin/env node
'use strict';

require('dotenv').config();

const crypto = require('crypto');
const path = require('path');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--email' || a === '-e') {
      out.email = argv[++i];
    } else if (a.startsWith('--email=')) {
      out.email = a.slice('--email='.length);
    } else if (a === '--name' || a === '-n') {
      out.name = argv[++i];
    } else if (a.startsWith('--name=')) {
      out.name = a.slice('--name='.length);
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    }
  }
  return out;
}

function usage() {
  process.stdout.write([
    'Usage: node scripts/seed-admin.js --email <email> [--name <name>]',
    '',
    'Creates a Full Admin user with a randomly generated password.',
    'The generated password is printed to stdout and is NOT stored anywhere',
    'except hashed in the configured persistence layer. Save it immediately.',
    ''
  ].join('\n'));
}

function generatePassword(length = 16) {
  // Avoid characters that are easy to confuse on copy/paste
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*';
  const buf = crypto.randomBytes(length * 2);
  let out = '';
  for (let i = 0; i < buf.length && out.length < length; i++) {
    const idx = buf[i] % alphabet.length;
    out += alphabet[idx];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.email) {
    usage();
    process.exit(args.email ? 0 : 1);
  }

  const email = String(args.email).trim().toLowerCase();
  const name = args.name ? String(args.name).trim() : email.split('@')[0];

  // Best-effort sanity check on JWT_SECRET so this script can run without
  // requiring a fully-configured server environment, but warn if missing.
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = crypto.randomBytes(64).toString('hex');
  }

  const password = generatePassword(16);

  const auth = require(path.join(__dirname, '..', 'backend', 'auth'));
  const result = await auth.adminCreateUser(
    {
      name,
      email,
      password,
      permissionLevel: 'Full Admin'
    },
    // synthetic acting user to satisfy the Full Admin gate
    { name: 'seed-script', email: 'seed-script@local', admin: 'Yes', permissions: 'Full Admin' }
  );

  if (!result || !result.success) {
    process.stderr.write(`[seed-admin] Failed to create user: ${result && result.message ? result.message : 'unknown error'}\n`);
    process.exit(1);
  }

  process.stdout.write(`[seed-admin] Created Full Admin user.\n`);
  process.stdout.write(`  email:    ${email}\n`);
  process.stdout.write(`  name:     ${name}\n`);
  process.stdout.write(`  password: ${password}\n`);
  process.stdout.write(`Save the password now -- it cannot be recovered.\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`[seed-admin] Error: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});

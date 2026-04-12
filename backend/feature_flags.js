// backend/feature_flags.js
// Central feature flags loader backed by backend/feature-flags.json
const fs = require('fs');
const path = require('path');

const FEATURE_FLAGS_PATH = path.join(__dirname, 'feature-flags.json');

// Defaults mirror current behaviour; chatbot defaults to env if provided
const DEFAULT_FLAGS = {
  authEnabled: false,
  testTabEnabled: true,
  chatbotDisabled: String(process.env.CHATBOT_DISABLED || '').toLowerCase() === 'true'
};

function readFlagsFile() {
  try {
    if (!fs.existsSync(FEATURE_FLAGS_PATH)) {
      return { ...DEFAULT_FLAGS };
    }
    const raw = fs.readFileSync(FEATURE_FLAGS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      authEnabled: typeof parsed.authEnabled === 'boolean'
        ? parsed.authEnabled
        : DEFAULT_FLAGS.authEnabled,
      testTabEnabled: typeof parsed.testTabEnabled === 'boolean'
        ? parsed.testTabEnabled
        : DEFAULT_FLAGS.testTabEnabled,
      chatbotDisabled: typeof parsed.chatbotDisabled === 'boolean'
        ? parsed.chatbotDisabled
        : DEFAULT_FLAGS.chatbotDisabled
    };
  } catch (err) {
    console.warn('[feature_flags] Error reading feature-flags.json. Using defaults.', err.message);
    return { ...DEFAULT_FLAGS };
  }
}

let cachedFlags = null;

function getFeatureFlags() {
  if (!cachedFlags) {
    cachedFlags = readFlagsFile();
  }
  return cachedFlags;
}

module.exports = {
  getFeatureFlags,
  FEATURE_FLAGS_PATH
};

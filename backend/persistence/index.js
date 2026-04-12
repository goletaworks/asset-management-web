// backend/persistence/index.js
// Main entry point for persistence layer

require('dotenv').config();
const PersistenceFactory = require('./PersistenceFactory');
const path = require('path');

// Singleton instance
let persistenceInstance = null;

/**
 * Get or create the persistence layer instance
 * @param {boolean} forceRecreate - Force recreation of instance
 * @returns {Promise<Object>} - Persistence layer instance
 */
async function getPersistence(forceRecreate = false) {
  if (persistenceInstance && !forceRecreate) {
    return persistenceInstance;
  }

  try {
    const configPath = path.join(__dirname, '..', 'db-config.json');
    persistenceInstance = await PersistenceFactory.createFromFile(configPath);
    return persistenceInstance;
  } catch (error) {
    console.error('[Persistence] Failed to create persistence layer:', error.message);
    throw error;
  }
}

/**
 * Close the persistence layer
 */
async function closePersistence() {
  if (persistenceInstance) {
    await persistenceInstance.close();
    persistenceInstance = null;
  }
}

/**
 * Reload configuration and recreate persistence layer
 * @returns {Promise<Object>} - New persistence layer instance
 */
async function reloadPersistence() {
  await closePersistence();
  return await getPersistence(true);
}

module.exports = {
  getPersistence,
  closePersistence,
  reloadPersistence,
  PersistenceFactory
};

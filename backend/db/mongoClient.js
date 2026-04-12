// backend/db/mongoClient.js
// MongoDB connection management (singleton pattern)

const { MongoClient } = require('mongodb');

class MongoDBClient {
  constructor() {
    this.client = null;
    this.db = null;
    this.isConnected = false;
  }

  /**
   * Connect to MongoDB using the provided connection string
   * @param {string} connectionString - MongoDB connection string
   * @returns {Promise<boolean>} - Success status
   */
  async connect(connectionString) {
    if (this.isConnected && this.client) {
      console.log('[MongoDB] Already connected');
      return true;
    }

    try {
      console.log('[MongoDB] Connecting to MongoDB...');

      this.client = new MongoClient(connectionString, {
        maxPoolSize: 10,
        minPoolSize: 2,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        family: 4, // Force IPv4 to avoid Node.js internal assertion errors
      });

      await this.client.connect();

      // Extract database name from connection string or use default
      const dbName = this._extractDbName(connectionString) || 'asmgt';
      this.db = this.client.db(dbName);

      // Verify connection
      await this.db.admin().ping();

      this.isConnected = true;
      console.log(`[MongoDB] Connected successfully to database: ${dbName}`);
      return true;
    } catch (error) {
      console.error('[MongoDB] Connection failed:', error.message);
      this.isConnected = false;
      this.client = null;
      this.db = null;
      return false;
    }
  }

  /**
   * Extract database name from connection string
   * @private
   */
  _extractDbName(connectionString) {
    try {
      const match = connectionString.match(/\/([^/?]+)(\?|$)/);
      return match ? match[1] : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Get a collection by name
   * @param {string} collectionName - Name of the collection
   * @returns {Collection} - MongoDB collection
   */
  getCollection(collectionName) {
    if (!this.isConnected || !this.db) {
      throw new Error('[MongoDB] Not connected to database');
    }
    return this.db.collection(collectionName);
  }

  /**
   * Get the database instance
   * @returns {Db} - MongoDB database
   */
  getDatabase() {
    if (!this.isConnected || !this.db) {
      throw new Error('[MongoDB] Not connected to database');
    }
    return this.db;
  }

  /**
   * Check if connected to MongoDB
   * @returns {boolean}
   */
  connected() {
    return this.isConnected && this.client !== null;
  }

  /**
   * Disconnect from MongoDB
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (this.client) {
      try {
        await this.client.close();
        console.log('[MongoDB] Disconnected successfully');
      } catch (error) {
        console.error('[MongoDB] Error disconnecting:', error.message);
      } finally {
        this.client = null;
        this.db = null;
        this.isConnected = false;
      }
    }
  }

  /**
   * Generate collection name for station data
   * @param {string} company - Company name
   * @param {string} location - Location name
   * @param {string} assetType - Asset type
   * @returns {string} - Collection name
   */
  getStationCollectionName(company, location, assetType) {
    const normalize = (str) => String(str || '')
      .trim()
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');

    const co = normalize(company);
    const loc = normalize(location);
    const at = normalize(assetType);

    return `${co}_${loc}_${at}_stationData`;
  }

  /**
   * Generate collection name for repairs
   * @param {string} company - Company name
   * @param {string} location - Location name
   * @returns {string} - Collection name
   */
  getRepairsCollectionName(company, location) {
    const normalize = (str) => String(str || '')
      .trim()
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');

    const co = normalize(company);
    const loc = normalize(location);

    return `${co}_${loc}_repairs`;
  }

  /**
   * List all collections in the database
   * @returns {Promise<string[]>} - Array of collection names
   */
  async listCollections() {
    if (!this.isConnected || !this.db) {
      throw new Error('[MongoDB] Not connected to database');
    }

    const collections = await this.db.listCollections().toArray();
    return collections.map(c => c.name);
  }

  /**
   * Create indexes for a collection (helper method)
   * @param {string} collectionName - Name of the collection
   * @param {Array} indexes - Array of index specifications
   * @returns {Promise<void>}
   */
  async createIndexes(collectionName, indexes) {
    if (!this.isConnected || !this.db) {
      throw new Error('[MongoDB] Not connected to database');
    }

    try {
      const collection = this.getCollection(collectionName);
      await collection.createIndexes(indexes);
      console.log(`[MongoDB] Created indexes for collection: ${collectionName}`);
    } catch (error) {
      console.error(`[MongoDB] Error creating indexes for ${collectionName}:`, error.message);
    }
  }
}

// Export singleton instance
const mongoClient = new MongoDBClient();

module.exports = mongoClient;

// Documentation of MongoDB collection structures
// These schemas mirror the Excel sheet structures

/**
 * COLLECTION: companies
 * Source: lookups.xlsx -> Companies sheet
 *
 * Document Structure:
 * {
 * company: String,       // Company name
 * active: Boolean,       // Whether the company is active
 * description: String,   // Description
 * email: String,         // Email
 * _createdAt: Date,      // Creation timestamp
 * _updatedAt: Date       // Last update timestamp
 * }
 *
 * Indexes:
 * - company (unique)
 */

/**
 * COLLECTION: locations
 * Source: lookups.xlsx -> Locations sheet
 *
 * Document Structure:
 * {
 * location: String,      // Location name (e.g., "BC", "AB")
 * company: String,       // Company name reference
 * link: String,          // Photos base path/link (optional)
 * _createdAt: Date,
 * _updatedAt: Date
 * }
 *
 * Indexes:
 * - { location: 1, company: 1 } (compound unique)
 * - company
 */

/**
 * COLLECTION: assetTypes
 * Source: lookups.xlsx -> AssetTypes sheet
 *
 * Document Structure:
 * {
 * asset_type: String,    // Asset type name (e.g., "Cableway")
 * location: String,      // Location name
 * company: String,       // Company name
 * color: String,         // Hex color code (e.g., "#FF5733")
 * link: String,          // Photos base path/link (optional)
 * _createdAt: Date,
 * _updatedAt: Date
 * }
 *
 * Indexes:
 * - { asset_type: 1, location: 1, company: 1 } (compound unique)
 * - asset_type
 * - { company: 1, location: 1 }
 */

/**
 * COLLECTION: customWeights
 * Source: lookups.xlsx -> Custom Weights sheet
 *
 * Document Structure:
 * {
 * weight: Number,        // Weight value
 * active: Boolean,       // Whether the weight is active
 * _createdAt: Date,
 * _updatedAt: Date
 * }
 * * Indexes:
 * - None (Index on weight could be added if queried frequently)
 */

/**
 * COLLECTION: workplanConstants
 * Source: lookups.xlsx -> Workplan Constants sheet
 *
 * Document Structure:
 * {
 * Field: String,         // Parameter name (e.g., "Max_Budget")
 * Value: Mixed,          // Parameter value (Number or String)
 * _createdAt: Date,
 * _updatedAt: Date
 * }
 *
 * Indexes:
 * - Field (unique)
 */

/**
 * COLLECTION: algorithmParameters
 * Source: lookups.xlsx -> Algorithm Parameters sheet
 *
 * Document Structure:
 * {
 * Applies To: String,    // Where the parameter applies (e.g., "General")
 * Parameter: String,     // Parameter name (e.g., "Age")
 * Condition: String,     // Condition logic
 * MaxWeight: Number,     // Maximum weight allowed
 * Option: String,        // Option value
 * Weight: Number,        // Current weight
 * Selected: Boolean,     // If parameter is selected
 * _createdAt: Date,
 * _updatedAt: Date
 * }
 *
 * Indexes:
 * - Parameter (unique)
 */

/**
 * COLLECTION: fixedParameters
 * Source: lookups.xlsx -> Fixed Parameters sheet
 *
 * Document Structure:
 * {
 * Name: String,          // Parameter name
 * Type: String,          // Data type
 * Configuration: Mixed,  // JSON configuration object
 * _createdAt: Date,
 * _updatedAt: Date
 * }
 *
 * Indexes:
 * - Name (unique)
 */

/**
 * COLLECTION: statusColors
 * Source: lookups.xlsx -> Status Colors sheet
 *
 * Document Structure:
 * {
 * Status: String,        // Status key (e.g., "inactive", "mothballed")
 * Color: String,         // Hex color code
 * _createdAt: Date,
 * _updatedAt: Date
 * }
 *
 * Indexes:
 * - Status (unique)
 */

/**
 * COLLECTION: settings
 * Source: lookups.xlsx -> Settings sheet
 *
 * Document Structure:
 * {
 * Key: String,           // Setting key (e.g., "applyStatusColorsOnMap")
 * Value: Mixed,          // Setting value (Boolean, String, Number, etc.)
 * _createdAt: Date,
 * _updatedAt: Date
 * }
 *
 * Indexes:
 * - Key (unique)
 */

/**
 * COLLECTION: inspectionHistoryKeywords
 * Source: lookups.xlsx -> Inspection History Keywords sheet
 *
 * Document Structure:
 * {
 * Keyword: String,       // Inspection keyword
 * _createdAt: Date,
 * _updatedAt: Date
 * }
 *
 * Indexes:
 * - Keyword (unique)
 */

/**
 * COLLECTION: projectHistoryKeywords
 * Source: lookups.xlsx -> Project History Keywords sheet
 *
 * Document Structure:
 * {
 * Keyword: String,       // Project keyword
 * _createdAt: Date,
 * _updatedAt: Date
 * }
 *
 * Indexes:
 * - Keyword (unique)
 */

/**
 * DYNAMIC COLLECTIONS: {company}_{location}_{assetType}_stationData
 * Source: data/companies/{company}/{location}.xlsx -> Various asset type sheets
 * Example: Acme_BC_Cableway_stationData
 *
 * Document Structure:
 * {
 * station_id: String,    // Station ID (primary identifier)
 * asset_type: String,    // Asset type/Category
 * name: String,          // Site name
 * province: String,      // Province/Location
 * lat: Number,           // Latitude
 * lon: Number,           // Longitude
 * status: String,        // Status (e.g., "Active", "Inactive")
 * company: String,       // Company name
 * location_file: String, // Location file name
 *
 * // Additional fields from Excel (two-row headers preserved as "Section – Field"):
 * "General Information – Field1": Mixed,
 * "Custom Section – Field2": Mixed,
 * // ... (dynamic fields based on asset type schema)
 *
 * _createdAt: Date,
 * _updatedAt: Date,
 * _source: String        // "excel" | "mongodb" | "manual"
 * }
 *
 * Indexes:
 * - station_id (unique)
 * - { lat: 1, lon: 1 }
 * - status
 */

/**
 * DYNAMIC COLLECTIONS: {company}_{location}_repairs
 * Source: data/companies/{company}/{location}.xlsx -> Repairs sheet
 * Example: Acme_BC_repairs
 *
 * Document Structure:
 * {
 * date: Date,            // Repair date
 * station_id: String,    // Station ID
 * assetType: String,     // Asset type
 * name: String,          // Repair name
 * severity: String,      // Severity level
 * priority: String,      // Priority level
 * cost: Number,          // Cost amount
 * category: String,      // "Capital", "O&M", or "Decommission"
 * type: String,          // Type (e.g., "Repair", "Monitoring")
 * days: Number,          // Number of days (optional)
 *
 * // Funding split fields (populated based on category):
 * "O&M": String,         // Funding split string (e.g., "50%Token1-50%Token2")
 * "Capital": String,     // Funding split string
 * "Decommission": String, // Funding split string
 *
 * _createdAt: Date,
 * _updatedAt: Date
 * }
 *
 * Indexes:
 * - station_id
 * - date
 * - { station_id: 1, date: -1 }
 */

/**
 * COLLECTION: authUsers (if applicable)
 * Source: lookups.xlsx or separate auth system
 *
 * Document Structure:
 * {
 * username: String,
 * passwordHash: String,
 * role: String,
 * _createdAt: Date,
 * _updatedAt: Date
 * }
 *
 * Indexes:
 * - username (unique)
 */

module.exports = {
  // Collection names (static)
  COLLECTIONS: {
    COMPANIES: 'companies',
    LOCATIONS: 'locations',
    ASSET_TYPES: 'assetTypes',
    CUSTOM_WEIGHTS: 'customWeights',
    WORKPLAN_CONSTANTS: 'workplanConstants',
    ALGORITHM_PARAMETERS: 'algorithmParameters',
    FIXED_PARAMETERS: 'fixedParameters',
    STATUS_COLORS: 'statusColors',
    SETTINGS: 'settings',
    INSPECTION_KEYWORDS: 'inspectionHistoryKeywords',
    PROJECT_KEYWORDS: 'projectHistoryKeywords',
    AUTH_USERS: 'authUsers',
    REPAIR_COLORS: 'repairColors'
  },

  // Helper to add metadata to documents
  addMetadata(doc, source = 'manual') {
    const now = new Date();
    return {
      ...doc,
      _createdAt: doc._createdAt || now,
      _updatedAt: now,
      ...(doc._source ? {} : { _source: source })
    };
  },

  // Helper to strip metadata for updates
  stripMetadata(doc) {
    const { _id, _createdAt, _updatedAt, _source, ...rest } = doc;
    return rest;
  }
};
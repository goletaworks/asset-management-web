// backend/schema_sync.js
const { getPersistence } = require('./persistence');

/**
 * Extract schema (sections and fields) from station data
 * Excludes General Information fields and values
 */
function extractSchema(stationData) {
  const schema = {
    sections: [],
    fields: []
  };
  
  const SEP = ' – ';
  const processedFields = new Set();
  
  Object.keys(stationData).forEach(key => {
    if (!key.includes(SEP)) return;
    
    const [section, field] = key.split(SEP, 2);
    const sectionNorm = String(section).trim();
    const fieldNorm = String(field).trim();
    
    // Skip General Information fields
    if (sectionNorm.toLowerCase() === 'general information') return;
    
    const fieldKey = `${sectionNorm}${SEP}${fieldNorm}`;
    if (!processedFields.has(fieldKey)) {
      schema.sections.push(sectionNorm);
      schema.fields.push(fieldNorm);
      processedFields.add(fieldKey);
    }
  });
  
  return schema;
}

/**
 * Get all locations from persistence layer
 * Replaces file system scan with database/lookup query
 */
async function getAllLocations() {
  try {
    const persistence = await getPersistence();
    const tree = await persistence.getLookupTree();
    const result = [];
    
    // tree = { companies: [...], locationsByCompany: { Comp: [Loc1, Loc2] } }
    const companies = Object.keys(tree.locationsByCompany || {});

    for (const company of companies) {
      const locations = tree.locationsByCompany[company] || [];
      for (const loc of locations) {
          result.push({
          locationName: loc,
          company: company
        });
      }
    }
    
    return result;
  } catch (e) {
    console.error('[getAllLocations] Error:', e);
    return [];
  }
}

/**
 * Synchronize schema for an asset type across ALL locations and companies
 * This is called after a station edit is saved (Functionality A)
 */
async function syncAssetTypeSchema(assetType, updatedSchema, sourceStationId) {
  console.log(`[syncAssetTypeSchema] Delegating sync for ${assetType} to persistence layer`);
  
  try {
    // The persistence layer (Excel Worker or Mongo) now handles the iteration and updating
    const persistence = await getPersistence();
    return await persistence.updateAssetTypeSchema(assetType, updatedSchema, sourceStationId);

  } catch (error) {
    console.error('[syncAssetTypeSchema] Fatal error:', error);
    return { success: false, message: String(error) };
  }
}

/**
 * Apply a schema to a station, preserving values but updating structure
 * Prevents accidental value copying by using exact key matching
 */
function applySchemaToStation(stationData, schema) {
  const updated = {};
  const SEP = ' – ';
  
  // ═══════════════════════════════════════════════════════════════════
  // FIX: Strict key matching to prevent value copying
  // ═══════════════════════════════════════════════════════════════════
  
  // First, copy all non-section fields and General Information fields
  Object.keys(stationData).forEach(key => {
    if (!key.includes(SEP)) {
      // Simple field (not in a section)
      updated[key] = stationData[key];
    } else {
      // Check if it's General Information
      const [section] = key.split(SEP, 2);
      if (section.toLowerCase() === 'general information') {
        updated[key] = stationData[key];
      }
    }
  });
  
  // Now add all fields from the schema
  schema.sections.forEach((section, index) => {
    const field = schema.fields[index];
    const compositeKey = `${section}${SEP}${field}`;
    
    // Try to find existing value for this field using EXACT matching only
    let value = '';
    
    // 1. Check exact composite key match
    if (stationData[compositeKey] !== undefined) {
      value = stationData[compositeKey];
    } 
    // 2. Check if field exists under ANY section (but still exact field name match)
    else {
      const fieldLower = field.toLowerCase();
      for (const key of Object.keys(stationData)) {
        if (key.includes(SEP)) {
          const [, existingField] = key.split(SEP, 2);
          if (existingField.toLowerCase() === fieldLower) {
            value = stationData[key];
            break; // Take first match only
          }
        }
      }
    }
    // 3. Last resort: check plain field name (but only if no section match found)
    if (value === '' && stationData[field] !== undefined) {
      value = stationData[field];
    }
    
    updated[compositeKey] = value;
  });
  
  return updated;
}

/**
 * Get the schema from existing stations of the given asset type
 * Searches across ALL locations
 * @param {string} assetType - The asset type to search for
 * @param {string[]} [stationIdsToExclude] - Optional array of station IDs to skip (e.g., those being imported)
 */
async function getExistingSchemaForAssetType(assetType, stationIdsToExclude = []) {
  const persistence = await getPersistence();
  const excludeSet = new Set(stationIdsToExclude.map(String));
  
  console.log(`[getExistingSchemaForAssetType] Looking for existing schema for: ${assetType}`);
  console.log(`[getExistingSchemaForAssetType] Excluding ${excludeSet.size} IDs`);
  
  try {
    const locations = await getAllLocations();
    console.log(`[getExistingSchemaForAssetType] Searching in ${locations.length} locations`);

    for (const locFile of locations) {
      const wb = await persistence.readLocationWorkbook(locFile.company, locFile.locationName);
      if (!wb.success || !wb.sheets) continue;
      
      for (const sheetName of wb.sheets) {
        // Case-insensitive check for asset type
        const sheetLower = sheetName.toLowerCase();
        const assetLower = assetType.toLowerCase();
        
        if (!sheetLower.startsWith(assetLower)) continue;
        
        console.log(`[getExistingSchemaForAssetType] Found matching sheet: ${sheetName} in ${locFile.locationName}`);
        
        // Read the first station from this sheet
        const sheetData = await persistence.readSheetData(locFile.company, locFile.locationName, sheetName);
        if (!sheetData.success || !sheetData.rows || sheetData.rows.length === 0) {
          continue;
        }
        
        // Find the first station on this sheet that is NOT in our exclude list
        for (const station of sheetData.rows) {
          const stationId = station['Station ID'] || station['station_id'] || station['StationID'] || station['ID'];
          
          if (stationId && !excludeSet.has(String(stationId))) {
            // Found a valid, existing station. This is our master schema.
            const schema = extractSchema(station);
            console.log(`[getExistingSchemaForAssetType] Extracted schema from: ${stationId}`, schema);
            return schema;
          }
        }
        // If all stations on this sheet were in the exclude list, keep searching
        console.log(`[getExistingSchemaForAssetType] All stations on sheet ${sheetName} were in exclude list`);
      }
    }
    
    console.log(`[getExistingSchemaForAssetType] No existing stations found for ${assetType}`);
    return null;
    
  } catch (error) {
    console.error('[getExistingSchemaForAssetType] Error:', error);
    return null;
  }
}

/**
 * Sync schema to newly imported stations AFTER they've been written
 * This is for Functionality B - when importing new data
 * Works for both Excel and MongoDB persistence layers
 */
async function syncNewlyImportedStations(assetType, company, locationName, existingSchema, importedStationIds) {
  const persistence = await getPersistence();
  const results = {
    success: true,
    message: '',
    stationsUpdated: 0
  };
  
  console.log(`[syncNewlyImportedStations] Syncing ${importedStationIds.length} imported stations to existing schema`);
  
  try {
    // ═══════════════════════════════════════════════════════════════════
    // FIX: MongoDB-compatible sync using persistence layer methods
    // ═══════════════════════════════════════════════════════════════════
    
    // Read the just-imported data using persistence API
    const sheetName = `${assetType} ${locationName}`;
    console.log(`[syncNewlyImportedStations] Reading from sheet/collection: ${sheetName}`);
    
    const sheetData = await persistence.readSheetData(company, locationName, sheetName);
    if (!sheetData.success || !sheetData.rows || sheetData.rows.length === 0) {
      return { 
        success: false, 
        message: `Could not read imported data from ${sheetName}` 
      };
    }
    
    console.log(`[syncNewlyImportedStations] Found ${sheetData.rows.length} stations in data`);
    
    // Create a Set for O(1) lookup
    const importedIdSet = new Set(importedStationIds.map(String));
    
    // Update each imported station to match the existing schema
    for (const station of sheetData.rows) {
      const stationId = station['Station ID'] || station['station_id'] || station['StationID'] || station['ID'];
      
      // Only update the stations we just imported
      if (!importedIdSet.has(String(stationId))) {
        continue;
      }
      
      console.log(`[syncNewlyImportedStations] Updating imported station: ${stationId}`);
      
      // Apply the existing schema while preserving imported values
      const updatedStation = applySchemaToStation(station, existingSchema);
      
      // Write back using persistence layer
      const updateResult = await persistence.updateStationInLocationFile(
        company,
        locationName,
        stationId,
        updatedStation,
        existingSchema
      );
      
      if (updateResult.success) {
        results.stationsUpdated++;
        console.log(`[syncNewlyImportedStations] Successfully updated station: ${stationId}`);
      } else {
        console.error(`[syncNewlyImportedStations] Failed to update station ${stationId}:`, updateResult.message);
      }
    }
    
    results.success = true;
    results.message = `Updated ${results.stationsUpdated} newly imported stations to match existing schema`;
    console.log(`[syncNewlyImportedStations] Completed:`, results.message);
    
  } catch (error) {
    console.error('[syncNewlyImportedStations] Error:', error);
    results.success = false;
    results.message = String(error);
  }
  
  return results;
}

module.exports = {
  extractSchema,
  syncAssetTypeSchema,
  applySchemaToStation,
  getExistingSchemaForAssetType,
  syncNewlyImportedStations
};
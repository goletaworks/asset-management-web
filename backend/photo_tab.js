// backend/photo_tab.js
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const config = require('./config');

const IMAGE_EXTS = config.IMAGE_EXTS;

async function uniqueNameInDir(dir, fileName) {
  const ext = path.extname(fileName);
  const stem = fileName.slice(0, fileName.length - ext.length);
  let candidate = fileName;
  let i = 1;
  for (;;) {
    const full = safePathJoin(dir, candidate);
    try {
      await fsp.access(full);
      candidate = `${stem}_${i}${ext}`;
      i++;
    } catch (_) {
      return candidate;
    }
  }
}

/**
 * Safely join paths, preserving UNC path format
 */
function safePathJoin(basePath, ...segments) {
  if (basePath.startsWith('\\\\')) {
    let result = basePath;
    for (const segment of segments) {
      if (segment) {
        if (!result.endsWith('\\')) {
          result += '\\';
        }
        const cleanSegment = segment.replace(/^\\+|\\+$/g, '');
        result += cleanSegment;
      }
    }
    return result;
  } else {
    return path.join(basePath, ...segments);
  }
}

/**
 * Check if a path contains any image files (recursively)
 */
async function containsImages(dirPath) {
  try {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (IMAGE_EXTS.includes(ext)) {
          return true;
        }
      } else if (entry.isDirectory()) {
        const fullPath = safePathJoin(dirPath, entry.name);
        if (await containsImages(fullPath)) {
          return true;
        }
      }
    }
    return false;
  } catch (e) {
    return false;
  }
}

/**
 * Get station photo directory structure
 * Returns folders and images, filtering out folders without any images
 */
async function getStationPhotoStructure(siteName, stationId, subPath = '') {
  try {
    // Get the station directory
    const app = require('./app');
    const { stationDir } = await app.resolvePhotosBaseAndStationDir(siteName, stationId);
    
    if (!stationDir) {
      return { success: false, message: 'Station photo directory not found' };
    }

    // Build the target path
    const targetPath = subPath 
      ? safePathJoin(stationDir, subPath)
      : stationDir;

    // Check if path exists
    try {
      const stat = await fsp.stat(targetPath);
      if (!stat.isDirectory()) {
        return { success: false, message: 'Path is not a directory' };
      }
    } catch (e) {
      return { success: false, message: 'Path does not exist' };
    }

    // Read directory contents
    const entries = await fsp.readdir(targetPath, { withFileTypes: true });
    
    const folders = [];
    const images = [];

    for (const entry of entries) {
      const fullPath = safePathJoin(targetPath, entry.name);
      
      if (entry.isDirectory()) {
        // Check if folder contains images (recursively)
        if (await containsImages(fullPath)) {
          const stat = await fsp.stat(fullPath);
          folders.push({
            name: entry.name,
            path: subPath ? `${subPath}/${entry.name}` : entry.name,
            modified: stat.mtimeMs
          });
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (IMAGE_EXTS.includes(ext)) {
          const stat = await fsp.stat(fullPath);
          images.push({
            name: entry.name,
            path: subPath ? `${subPath}/${entry.name}` : entry.name,
            fullPath: fullPath,
            modified: stat.mtimeMs,
            size: stat.size
          });
        }
      }
    }

    // Sort folders and images by name
    folders.sort((a, b) => a.name.localeCompare(b.name));
    images.sort((a, b) => a.name.localeCompare(b.name));

    return {
      success: true,
      stationDir,
      currentPath: subPath,
      folders,
      images
    };
  } catch (e) {
    console.error('[getStationPhotoStructure] failed:', e);
    return { success: false, message: String(e) };
  }
}

/**
 * Create a new folder in the station directory
 */
async function createPhotoFolder(siteName, stationId, folderPath) {
  try {
    const app = require('./app');
    const { stationDir } = await app.resolvePhotosBaseAndStationDir(siteName, stationId);
    
    if (!stationDir) {
      return { success: false, message: 'Station photo directory not found' };
    }

    const targetPath = safePathJoin(stationDir, folderPath);

    // Check if folder already exists
    try {
      await fsp.access(targetPath);
      return { success: false, message: 'Folder already exists' };
    } catch (e) {
      // Folder doesn't exist, which is what we want
    }

    // Create the folder
    await fsp.mkdir(targetPath, { recursive: true });

    return { success: true, path: folderPath };
  } catch (e) {
    console.error('[createPhotoFolder] failed:', e);
    return { success: false, message: String(e) };
  }
}

/**
 * Save uploaded photos to a folder
 */
async function savePhotos(siteName, stationId, folderPath, files) {
  try {
    const app = require('./app');
    const { stationDir } = await app.resolvePhotosBaseAndStationDir(siteName, stationId);
    
    if (!stationDir) {
      return { success: false, message: 'Station photo directory not found' };
    }

    const targetPath = folderPath 
      ? safePathJoin(stationDir, folderPath)
      : stationDir;

    // Ensure target directory exists
    await fsp.mkdir(targetPath, { recursive: true });

    const saved = [];
    const errors = [];

    for (const file of files) {
      try {
        // Validate file extension
        const ext = path.extname(file.name).toLowerCase();
        if (!IMAGE_EXTS.includes(ext)) {
          errors.push({ name: file.name, error: 'Invalid file type' });
          continue;
        }

        // Sanitize filename
        const safeName = String(file.name || '').replace(/[^a-zA-Z0-9._-]/g, '_');
        const finalName = await uniqueNameInDir(targetPath, safeName);
        const filePath = safePathJoin(targetPath, finalName);

        // Write file
        const buffer = Buffer.from(file.data, 'base64');
        await fsp.writeFile(filePath, buffer);

        saved.push({
          name: finalName,
          path: folderPath ? `${folderPath}/${finalName}` : finalName
        });
      } catch (e) {
        errors.push({ name: file.name, error: String(e) });
      }
    }

    return {
      success: errors.length === 0,
      saved,
      errors
    };
  } catch (e) {
    console.error('[savePhotos] failed:', e);
    return { success: false, message: String(e) };
  }
}

/**
 * Get full file URL for a photo
 */
async function getPhotoUrl(siteName, stationId, photoPath) {
  try {
    const app = require('./app');
    const { stationDir } = await app.resolvePhotosBaseAndStationDir(siteName, stationId);
    
    if (!stationDir) {
      return { success: false, message: 'Station photo directory not found' };
    }

    const fullPath = safePathJoin(stationDir, photoPath);

    // Verify file exists
    try {
      await fsp.access(fullPath);
    } catch (e) {
      return { success: false, message: 'Photo not found' };
    }

    const { pathToFileURL } = require('url');
    return {
      success: true,
      url: pathToFileURL(fullPath).href
    };
  } catch (e) {
    console.error('[getPhotoUrl] failed:', e);
    return { success: false, message: String(e) };
  }
}

/**
 * Delete a photo
 */
async function deletePhoto(siteName, stationId, photoPath) {
  try {
    const app = require('./app');
    const { stationDir } = await app.resolvePhotosBaseAndStationDir(siteName, stationId);
    
    if (!stationDir) {
      return { success: false, message: 'Station photo directory not found' };
    }

    const fullPath = safePathJoin(stationDir, photoPath);

    // Verify it's a file and within station directory
    const stat = await fsp.stat(fullPath);
    if (!stat.isFile()) {
      return { success: false, message: 'Not a file' };
    }

    // Delete the file
    await fsp.unlink(fullPath);

    return { success: true };
  } catch (e) {
    console.error('[deletePhoto] failed:', e);
    return { success: false, message: String(e) };
  }
}

/**
 * Delete a folder (only if empty)
 */
async function deleteFolder(siteName, stationId, folderPath) {
  try {
    const app = require('./app');
    const { stationDir } = await app.resolvePhotosBaseAndStationDir(siteName, stationId);
    
    if (!stationDir) {
      return { success: false, message: 'Station photo directory not found' };
    }

    const fullPath = safePathJoin(stationDir, folderPath);

    // Verify it's a directory
    const stat = await fsp.stat(fullPath);
    if (!stat.isDirectory()) {
      return { success: false, message: 'Not a directory' };
    }

    // Check if empty
    const entries = await fsp.readdir(fullPath);
    if (entries.length > 0) {
      return { success: false, message: 'Folder is not empty' };
    }

    // Delete the folder
    await fsp.rmdir(fullPath);

    return { success: true };
  } catch (e) {
    console.error('[deleteFolder] failed:', e);
    return { success: false, message: String(e) };
  }
}

module.exports = {
  getStationPhotoStructure,
  createPhotoFolder,
  savePhotos,
  getPhotoUrl,
  deletePhoto,
  deleteFolder
};
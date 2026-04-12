// backend/documents_tab.js
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { pathToFileURL } = require('url');

// Common document extensions
const DOCUMENT_EXTS = [
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.csv', '.rtf', '.odt', '.ods', '.odp',
  '.zip', '.rar', '.7z', '.tar', '.gz'
];

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
 * Check if a path contains any documents (recursively)
 */
async function containsDocuments(dirPath) {
  try {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (DOCUMENT_EXTS.includes(ext)) {
          return true;
        }
      } else if (entry.isDirectory()) {
        const fullPath = safePathJoin(dirPath, entry.name);
        if (await containsDocuments(fullPath)) {
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
 * Resolve station documents directory
 * Returns the station root folder (same as photos) where documents are stored
 */
async function resolveStationDocumentsDir(siteName, stationId) {
  try {
    const app = require('./app');
    const { stationDir } = await app.resolvePhotosBaseAndStationDir(siteName, stationId);
    
    if (!stationDir) {
      return null;
    }

    // Documents are in the station root folder, not a subfolder
    console.log('[resolveStationDocumentsDir] Using station root:', stationDir);
    return stationDir;
  } catch (e) {
    console.error('[resolveStationDocumentsDir] failed:', e);
    return null;
  }
}

/**
 * Format file size to human-readable string
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Get file icon based on extension
 */
function getFileIcon(filename) {
  const ext = path.extname(filename).toLowerCase();
  const iconMap = {
    '.pdf': '📄',
    '.doc': '📝',
    '.docx': '📝',
    '.xls': '📊',
    '.xlsx': '📊',
    '.ppt': '📽️',
    '.pptx': '📽️',
    '.txt': '📃',
    '.csv': '📊',
    '.zip': '🗜️',
    '.rar': '🗜️',
    '.7z': '🗜️',
    '.tar': '🗜️',
    '.gz': '🗜️',
  };
  return iconMap[ext] || '📄';
}

/**
 * Get station document structure
 * Returns folders and documents from station root, filtering out folders without any documents
 * Note: Documents can be mixed with photos in the same folder structure
 */
async function getStationDocumentStructure(siteName, stationId, subPath = '') {
  try {
    const documentsBase = await resolveStationDocumentsDir(siteName, stationId);
    
    console.log('[getStationDocumentStructure] Station:', siteName, stationId);
    console.log('[getStationDocumentStructure] Documents base:', documentsBase);
    console.log('[getStationDocumentStructure] SubPath:', subPath);
    
    if (!documentsBase) {
      return { success: false, message: 'Station documents directory not found' };
    }

    // Build the target path
    const targetPath = subPath 
      ? safePathJoin(documentsBase, subPath)
      : documentsBase;

    console.log('[getStationDocumentStructure] Target path:', targetPath);

    // Check if path exists
    try {
      const stat = await fsp.stat(targetPath);
      if (!stat.isDirectory()) {
        return { success: false, message: 'Path is not a directory' };
      }
    } catch (e) {
      // Directory doesn't exist
      console.log('[getStationDocumentStructure] Directory does not exist');
      return {
        success: true,
        documentsDir: documentsBase,
        currentPath: subPath,
        folders: [],
        documents: []
      };
    }

    // Read directory contents
    const entries = await fsp.readdir(targetPath, { withFileTypes: true });
    console.log('[getStationDocumentStructure] Found', entries.length, 'entries');
    
    const folders = [];
    const documents = [];

    for (const entry of entries) {
      const fullPath = safePathJoin(targetPath, entry.name);
      
      if (entry.isDirectory()) {
        // Check if folder contains documents (recursively)
        const hasDocuments = await containsDocuments(fullPath);
        console.log('[getStationDocumentStructure] Folder', entry.name, 'has documents:', hasDocuments);
        
        if (hasDocuments) {
          const stat = await fsp.stat(fullPath);
          folders.push({
            name: entry.name,
            path: subPath ? `${subPath}/${entry.name}` : entry.name,
            modified: stat.mtimeMs,
            modifiedDate: stat.mtime.toISOString()
          });
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (DOCUMENT_EXTS.includes(ext)) {
          const stat = await fsp.stat(fullPath);
          console.log('[getStationDocumentStructure] Found document:', entry.name);
          documents.push({
            name: entry.name,
            path: subPath ? `${subPath}/${entry.name}` : entry.name,
            fullPath: fullPath,
            modified: stat.mtimeMs,
            modifiedDate: stat.mtime.toISOString(),
            size: stat.size,
            sizeFormatted: formatFileSize(stat.size),
            icon: getFileIcon(entry.name),
            extension: ext
          });
        }
      }
    }

    // Sort folders and documents by name
    folders.sort((a, b) => a.name.localeCompare(b.name));
    documents.sort((a, b) => a.name.localeCompare(b.name));

    console.log('[getStationDocumentStructure] Returning', folders.length, 'folders and', documents.length, 'documents');

    return {
      success: true,
      documentsDir: documentsBase,
      currentPath: subPath,
      folders,
      documents
    };
  } catch (e) {
    console.error('[getStationDocumentStructure] failed:', e);
    return { success: false, message: String(e) };
  }
}

/**
 * Create a new folder in the documents directory
 */
async function createDocumentFolder(siteName, stationId, folderPath) {
  try {
    const documentsBase = await resolveStationDocumentsDir(siteName, stationId);
    
    if (!documentsBase) {
      return { success: false, message: 'Station documents directory not found' };
    }

    const targetPath = safePathJoin(documentsBase, folderPath);

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
    console.error('[createDocumentFolder] failed:', e);
    return { success: false, message: String(e) };
  }
}

/**
 * Save uploaded documents to a folder
 */
async function saveDocuments(siteName, stationId, folderPath, files) {
  try {
    const documentsBase = await resolveStationDocumentsDir(siteName, stationId);
    
    if (!documentsBase) {
      return { success: false, message: 'Station documents directory not found' };
    }

    const targetPath = folderPath 
      ? safePathJoin(documentsBase, folderPath)
      : documentsBase;

    // Ensure target directory exists
    await fsp.mkdir(targetPath, { recursive: true });

    const saved = [];
    const errors = [];

    for (const file of files) {
      try {
        // Validate file extension
        const ext = path.extname(file.name).toLowerCase();
        if (!DOCUMENT_EXTS.includes(ext)) {
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
    console.error('[saveDocuments] failed:', e);
    return { success: false, message: String(e) };
  }
}

/**
 * Get full file path for a document (for opening)
 */
async function getDocumentPath(siteName, stationId, docPath) {
  try {
    const documentsBase = await resolveStationDocumentsDir(siteName, stationId);
    
    if (!documentsBase) {
      return { success: false, message: 'Station documents directory not found' };
    }

    const fullPath = safePathJoin(documentsBase, docPath);

    // Verify file exists
    try {
      await fsp.access(fullPath);
    } catch (e) {
      return { success: false, message: 'Document not found' };
    }

    return {
      success: true,
      path: fullPath,
      url: pathToFileURL(fullPath).href
    };
  } catch (e) {
    console.error('[getDocumentPath] failed:', e);
    return { success: false, message: String(e) };
  }
}

/**
 * Delete a document
 */
async function deleteDocument(siteName, stationId, docPath) {
  try {
    const documentsBase = await resolveStationDocumentsDir(siteName, stationId);
    
    if (!documentsBase) {
      return { success: false, message: 'Station documents directory not found' };
    }

    const fullPath = safePathJoin(documentsBase, docPath);

    // Verify it's a file and within documents directory
    const stat = await fsp.stat(fullPath);
    if (!stat.isFile()) {
      return { success: false, message: 'Not a file' };
    }

    // Delete the file
    await fsp.unlink(fullPath);

    return { success: true };
  } catch (e) {
    console.error('[deleteDocument] failed:', e);
    return { success: false, message: String(e) };
  }
}

/**
 * Delete a folder (only if empty)
 */
async function deleteDocumentFolder(siteName, stationId, folderPath) {
  try {
    const documentsBase = await resolveStationDocumentsDir(siteName, stationId);
    
    if (!documentsBase) {
      return { success: false, message: 'Station documents directory not found' };
    }

    const fullPath = safePathJoin(documentsBase, folderPath);

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
    console.error('[deleteDocumentFolder] failed:', e);
    return { success: false, message: String(e) };
  }
}

module.exports = {
  getStationDocumentStructure,
  createDocumentFolder,
  saveDocuments,
  getDocumentPath,
  deleteDocument,
  deleteDocumentFolder,
  DOCUMENT_EXTS
};
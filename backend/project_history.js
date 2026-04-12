// backend/project_history.js
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { pathToFileURL } = require('url');
const { IMAGE_EXTS } = require('./config');
const app = require('./app');
const { ensureDir } = require('./utils/fs_utils');
const lookups = require('./lookups_repo');


function sanitizeSegment(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\-_ ]+/gu, ' ')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function uniquePath(dir, baseName) {
  let candidate = path.join(dir, baseName);
  let i = 0;
  for (;;) {
    try { await fsp.access(candidate); i++; candidate = path.join(dir, `${baseName}_${i}`); }
    catch { return candidate; }
  }
}

async function copyWithUniqueName(src, destDir) {
  const base = path.basename(src);
  const name = base.replace(/\.[^.]+$/, '');
  const ext  = path.extname(base);
  let target = path.join(destDir, base);
  let i = 0;
  for (;;) {
    try { await fsp.access(target); i++; target = path.join(destDir, `${name} (${i})${ext}`); }
    catch { break; }
  }
  await fsp.copyFile(src, target);
  return target;
}

function sanitizeFilename(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function copyWithDesiredName(src, destDir, desiredName) {
  const srcBase = path.basename(src);
  const srcExt = path.extname(srcBase);
  const raw = String(desiredName || '').trim();
  let base = sanitizeFilename(raw);
  if (!base) return copyWithUniqueName(src, destDir);

  // Ensure extension exists; if desiredName had none, use source ext
  const hasExt = path.extname(base);
  if (!hasExt) base = `${base}${srcExt}`;

  const name = base.replace(/\.[^.]+$/, '');
  const ext = path.extname(base);

  let target = path.join(destDir, base);
  let i = 0;
  for (;;) {
    try { await fsp.access(target); i++; target = path.join(destDir, `${name}_${i}${ext}`); }
    catch { break; }
  }
  await fsp.copyFile(src, target);
  return target;
}

function containsProjectWordFromList(folderName, keywords) {
  // 1. Safety check and normalize the folder name to lowercase
  const nameLower = String(folderName || '').trim().toLowerCase();
  
  if (!nameLower) return false;

  // 2. Normalize the keywords list:
  //    - Ensure it's an array
  //    - Convert every keyword to string
  //    - Trim whitespace
  //    - Convert to lowercase
  //    - Remove empty strings
  const validKeywords = (Array.isArray(keywords) ? keywords : [])
    .map(k => String(k || '').trim().toLowerCase())
    .filter(k => k.length > 0);

  // 3. If list is empty, nothing can match
  if (validKeywords.length === 0) return false;

  // 4. Check if ANY keyword is inside the folder name
  return validKeywords.some(keyword => nameLower.includes(keyword));
}

function parseDateFromFolderName(name) {
  const s = String(name || '').trim();
  // Accept: YYYY, YYYY[-_ ]MM, YYYY[-_ ]MM[-_ ]DD (e.g., 2020, 2020-05, 2020_05_17, 2020 Construction ...)
  const m = s.match(/^(\d{4})(?:[ _-]?(\d{2}))?(?:[ _-]?(\d{2}))?/);
  if (!m) return null;
  const y = Number(m[1]);
  let mo = m[2] ? Number(m[2]) : 1;
  let da = m[3] ? Number(m[3]) : 1;
  if (Number.isNaN(y) || y < 1900 || y > 3000) return null;
  // Clamp to safe ranges
  if (!Number.isFinite(mo) || mo < 1 || mo > 12) mo = 1;
  if (!Number.isFinite(da) || da < 1 || da > 31) da = 1;
  const dateMs = Date.UTC(y, mo - 1, da);
  const human = m[3] ? `${y}-${String(mo).padStart(2,'0')}-${String(da).padStart(2,'0')}`
            : m[2] ? `${y}-${String(mo).padStart(2,'0')}`
            : `${y}`;
  return { dateMs, human };
}

function titleCase(s) {
  return String(s || '')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b([a-z])/g, (m, c) => c.toUpperCase());
}

function toFileUrl(p) { try { return pathToFileURL(p).href; } catch { return null; } }

function parseProjectNoteTxt(raw) {
  if (!raw) return { projectLead: null, commentText: null };
  // Primary pattern: labeled blocks
  const m = raw.match(/^\s*Comment:\s*\r?\n([\s\S]*?)\r?\n\s*Project Lead:\s*\r?\n?([\s\S]*?)\s*$/i);
  if (m) {
    const commentText = (m[1] || '').trim();
    const projectLead = (m[2] || '').trim();
    return {
      projectLead: projectLead || null,
      commentText: commentText || null,
    };
  }
  // Fallbacks: tolerate single-line labels or loose order
  const cm = raw.match(/Comment:\s*([\s\S]*?)(?:\r?\n\r?\n|$)/i);
  const pm = raw.match(/Project Lead:\s*([^\r\n]+)/i);
  const commentText = (cm?.[1] || '').trim();
  const projectLead = (pm?.[1] || '').trim();
  return {
    projectLead: projectLead || null,
    commentText: commentText || null,
  };
}

async function collectFilesRecursive(dir, accept) {
  const files = [];
  const seen = new Set();
  async function walk(d) {
    if (seen.has(d)) return; seen.add(d);
    let ents;
    try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const ent of ents) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) { await walk(full); continue; }
      if (!accept || accept(full, ent.name)) {
        try { const st = await fsp.stat(full); files.push({ path: full, name: ent.name, mtimeMs: st.mtimeMs }); }
        catch { /* ignore */ }
      }
    }
  }
  await walk(dir);
  return files;
}

/** List project folders + up to 5 recent photos + report PDF URL */
async function listProjects(siteName, stationId, perPhotos = 5) {
  try {
    // Pull global keywords from lookups.xlsx ("Project History Keywords" sheet).
    let keywords = [];
    try {
      keywords = await lookups.getProjectKeywords();
    } catch (_) {
      keywords = ['project', 'construction', 'maintenance', 'repair', 'decommission'];
    }

    const { stationDir: stnDir } = await app.resolvePhotosBaseAndStationDir(siteName, stationId);
    if (!stnDir) return [];

    let entries = [];
    try { entries = await fsp.readdir(stnDir, { withFileTypes: true }); } catch (_) {}
    const folders = entries
      .filter(e => e.isDirectory() && containsProjectWordFromList(e.name, keywords))
      .map(e => e.name);

    const out = [];
    for (const folderName of folders) {
      const full = path.join(stnDir, folderName);
      const parsedDate = parseDateFromFolderName(folderName);
      const dateMs = parsedDate ? parsedDate.dateMs : Number.NEGATIVE_INFINITY;

      // Pretty display name (strip leading date chunk if present)
      const m = folderName.match(/^(\d{4})(?:[ _-]?(\d{2}))?(?:[ _-]?(\d{2}))?(.*)$/);
      const tail = m ? (m[4] || '') : folderName;
      const displayName = titleCase((tail || folderName).replace(/^[_\-\s]+/, '').replace(/[_\-]+/g, ' ').trim());

      // Photos
      const imgs = await collectFilesRecursive(full, (_p, n) => IMAGE_EXTS.includes(path.extname(n).toLowerCase()));
      imgs.sort((a, b) => b.mtimeMs - a.mtimeMs);
      const photos = imgs.slice(0, perPhotos).map(f => ({ url: toFileUrl(f.path), name: f.name, mtimeMs: f.mtimeMs }));
      const moreCount = Math.max(0, imgs.length - photos.length);

      // Report PDF (prefer names containing 'report' or 'project', newest first)
      const pdfs = await collectFilesRecursive(full, (_p, n) => /\.pdf$/i.test(n));
      pdfs.sort((a, b) => b.mtimeMs - a.mtimeMs);
      const rep = pdfs.find(f => /report/i.test(f.name)) || pdfs.find(f => /project/i.test(f.name)) || pdfs[0] || null;

      // Date to show (from folder name only)
      const dateHuman = parsedDate ? parsedDate.human : '';

      // Read comment.txt if present
      let projectLead = null, commentText = null;
      try {
        const cpath = path.join(full, 'comment.txt');
        const raw = await fsp.readFile(cpath, 'utf-8');
        const parsed = parseProjectNoteTxt(raw);
        projectLead = parsed.projectLead;
        commentText = parsed.commentText;
      } catch (_) {
        // no comment.txt or unreadable; silently ignore
      }

      out.push({
        folderName,
        fullPath: full,
        displayName: displayName || folderName,
        dateHuman,
        dateMs,
        photos,
        moreCount,
        reportUrl: rep ? toFileUrl(rep.path) : null,
        projectLead: projectLead || null,
        commentText: commentText || null,
        hasComment: Boolean((projectLead && projectLead.trim()) || (commentText && commentText.trim())),
      });
    }

    out.sort((a, b) => (b.dateMs || 0) - (a.dateMs || 0));
    return out;
  } catch (e) {
    console.error('[project_history:listProjects] failed:', e);
    return [];
  }
}

/** Delete a project folder (recursive), confined to the station directory. */
async function deleteProjectFolder(siteName, stationId, folderName) {
  try {
    const { stationDir: stnDir } = await app.resolvePhotosBaseAndStationDir(siteName, stationId);
    if (!stnDir) return { success: false, message: 'Station folder not found' };

    const target = path.join(stnDir, folderName);
    const rel = path.relative(stnDir, target);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      return { success: false, message: 'Invalid folder path' };
    }

    await fsp.rm(target, { recursive: true, force: true });
    return { success: true };
  } catch (e) {
    console.error('[project_history:deleteProjectFolder] failed:', e);
    return { success: false, message: String(e) };
  }
}

/** Create a new project folder and populate photos/report/comment.txt */
async function createProjectFolder(siteName, stationId, payload) {
  try {
    const year = Number(payload?.year);
    const name = String(payload?.name || '').trim();
    const projectLead = String(payload?.projectLead || '').trim();
    const comment = String(payload?.comment || '').trim();
    const photos = Array.isArray(payload?.photos) ? payload.photos : [];
    const report = payload?.report || null;

    if (!Number.isInteger(year) || year < 1000 || year > 9999) {
      return { success: false, message: 'Invalid year. Must be 4 digits between 1000 and 9999.' };
    }
    if (!name) {
      return { success: false, message: 'Name is required.' };
    }

    // Station directory — use canonical dir under dynamic base, create if missing.
    const { PHOTOS_BASE, canonicalDir } = await app.resolvePhotosBaseAndStationDir(siteName, stationId);
    if (!PHOTOS_BASE) return { success: false, message: 'PHOTOS_BASE is not configured.' };
    const stationDir = canonicalDir;
    ensureDir(stationDir);

    // New project folder: "YYYY_<Name…>"
    const desiredName = `${year}_${sanitizeSegment(name)}`;
    const targetDir = await uniquePath(stationDir, desiredName);
    ensureDir(targetDir);

    // Photos subfolder
    const photosDir = path.join(targetDir, 'photos');
    ensureDir(photosDir);

    // Copy photos (if any), keep original filenames, uniquify on collision
    for (const p of photos) {
      const src = (p && typeof p === 'object') ? p.path : p;
      const desired = (p && typeof p === 'object') ? p.name : null;
      if (!src || typeof src !== 'string') continue;
      const ext = path.extname(src).toLowerCase();
      if (!IMAGE_EXTS.includes(ext)) continue; // ignore non-images
      try {
        if (desired) await copyWithDesiredName(src, photosDir, desired);
        else await copyWithUniqueName(src, photosDir);
      } catch (e) { /* continue */ }
    }

    // Copy report as "Project Report.pdf" (if provided)
    if (report && typeof report === 'string') {
      const dest = path.join(targetDir, 'Project Report.pdf');
      try { await fsp.copyFile(report, dest); } catch (e) { /* ignore copy failure */ }
    }

    // Write comment.txt
    const body =
`Comment:
${comment || ''}

Project Lead:
${projectLead || ''}`;
    await fsp.writeFile(path.join(targetDir, 'comment.txt'), body, 'utf-8');

    return { success: true, folderName: path.basename(targetDir) };
  } catch (e) {
    console.error('[project_history:createProjectFolder] failed:', e);
    return { success: false, message: String(e) };
  }
}

module.exports = {
  listProjects,
  deleteProjectFolder,
  createProjectFolder,
};

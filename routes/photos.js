'use strict';

const photoTab = require('../backend/photo_tab');
const backend = require('../backend/app');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { assertSafePathSegment, assertSafeRelativePath } = require('../backend/utils/path_safety');

function validatePhotoPathInputs(reply, { siteName, stationId, photoPath, folderPath }) {
  try {
    if (siteName !== undefined) assertSafePathSegment(siteName, 'siteName');
    if (stationId !== undefined) assertSafePathSegment(stationId, 'stationId');
    if (photoPath !== undefined) assertSafeRelativePath(photoPath, 'photoPath');
    if (folderPath !== undefined) assertSafeRelativePath(folderPath, 'folderPath');
    return true;
  } catch (err) {
    reply.code(err.statusCode || 400).send({ success: false, message: err.message });
    return false;
  }
}

async function photoRoutes(fastify) {
  const PL = fastify.PERMISSION_LEVELS;

  fastify.get('/structure', async (request, reply) => {
    const { siteName, stationId, subPath } = request.query;
    if (!validatePhotoPathInputs(reply, { siteName, stationId })) return;
    if (subPath !== undefined && subPath !== '') {
      try { assertSafeRelativePath(subPath, 'subPath'); }
      catch (err) { return reply.code(err.statusCode || 400).send({ success: false, message: err.message }); }
    }
    return photoTab.getStationPhotoStructure(siteName, stationId, subPath);
  });

  fastify.get('/recent', async (request, reply) => {
    const { siteName, stationId, limit } = request.query;
    if (!validatePhotoPathInputs(reply, { siteName, stationId })) return;
    return backend.getRecentPhotos(siteName, stationId, parseInt(limit, 10) || 5);
  });

  // Stream a photo file to the browser
  fastify.get('/file', async (request, reply) => {
    const { siteName, stationId, photoPath } = request.query;
    if (!validatePhotoPathInputs(reply, { siteName, stationId, photoPath })) return;
    try {
      const result = await photoTab.getPhotoUrl(siteName, stationId, photoPath);
      if (!result || !result.success) {
        return reply.code(404).send({ success: false, message: 'Photo not found' });
      }
      // result.url is a file:// URL or a path; extract the local path
      let localPath = result.url || result.path;
      if (localPath && localPath.startsWith('file:///')) {
        localPath = decodeURIComponent(localPath.replace('file:///', '').replace(/\//g, path.sep));
      }
      if (!localPath || !fs.existsSync(localPath)) {
        return reply.code(404).send({ success: false, message: 'Photo file not found on disk' });
      }
      const ext = path.extname(localPath).toLowerCase();
      const mime = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
        '.tif': 'image/tiff', '.tiff': 'image/tiff',
      }[ext] || 'application/octet-stream';

      const stream = fs.createReadStream(localPath);
      reply.type(mime);
      return reply.send(stream);
    } catch (e) {
      return reply.code(500).send({ success: false, message: String(e) });
    }
  });

  // Multipart photo upload
  fastify.post('/upload', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Save photos')],
  }, async (request, reply) => {
    const parts = request.parts();
    const fields = {};
    const files = [];

    for await (const part of parts) {
      if (part.type === 'file') {
        const buf = await part.toBuffer();
        files.push({ name: part.filename, data: buf.toString('base64') });
      } else {
        fields[part.fieldname] = part.value;
      }
    }

    if (!validatePhotoPathInputs(reply, {
      siteName: fields.siteName,
      stationId: fields.stationId,
      folderPath: fields.folderPath
    })) return;

    return photoTab.savePhotos(fields.siteName, fields.stationId, fields.folderPath, files);
  });

  fastify.get('/default-path', async (request, reply) => {
    const { siteName, stationId } = request.query;
    if (!validatePhotoPathInputs(reply, { siteName, stationId })) return;
    try {
      const all = await backend.getStationData({ skipColors: true, debounce: false });
      const st = all.find(s =>
        String(s.station_id).trim().toLowerCase() === String(stationId).trim().toLowerCase()
      );
      if (!st) return { success: false, path: null };
      const company   = st.company || '';
      const location  = (st.location_file || st.location || st.province || '').trim();
      const assetType = (st.asset_type || '').trim();
      const mediaPath = backend.getDefaultMediaPath(company, location, assetType);
      return { success: !!mediaPath, path: mediaPath };
    } catch (e) {
      return { success: false, path: null, message: String(e) };
    }
  });

  fastify.post('/folder', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Add photo folders')],
  }, async (request, reply) => {
    const { siteName, stationId, folderPath } = request.body || {};
    if (!validatePhotoPathInputs(reply, { siteName, stationId, folderPath })) return;
    return photoTab.createPhotoFolder(siteName, stationId, folderPath);
  });

  fastify.delete('/file', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Delete photos')],
  }, async (request, reply) => {
    const { siteName, stationId, photoPath } = request.body || {};
    if (!validatePhotoPathInputs(reply, { siteName, stationId, photoPath })) return;
    return photoTab.deletePhoto(siteName, stationId, photoPath);
  });

  fastify.delete('/folder', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Delete photo folders')],
  }, async (request, reply) => {
    const { siteName, stationId, folderPath } = request.body || {};
    if (!validatePhotoPathInputs(reply, { siteName, stationId, folderPath })) return;
    return photoTab.deleteFolder(siteName, stationId, folderPath);
  });
}

module.exports = photoRoutes;

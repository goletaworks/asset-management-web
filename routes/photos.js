'use strict';

const photoTab = require('../backend/photo_tab');
const backend = require('../backend/app');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function photoRoutes(fastify) {
  const PL = fastify.PERMISSION_LEVELS;

  fastify.get('/structure', async (request) => {
    const { siteName, stationId, subPath } = request.query;
    return photoTab.getStationPhotoStructure(siteName, stationId, subPath);
  });

  fastify.get('/recent', async (request) => {
    const { siteName, stationId, limit } = request.query;
    return backend.getRecentPhotos(siteName, stationId, parseInt(limit, 10) || 5);
  });

  // Stream a photo file to the browser
  fastify.get('/file', async (request, reply) => {
    const { siteName, stationId, photoPath } = request.query;
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
  }, async (request) => {
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

    return photoTab.savePhotos(fields.siteName, fields.stationId, fields.folderPath, files);
  });

  fastify.post('/folder', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Add photo folders')],
  }, async (request) => {
    const { siteName, stationId, folderPath } = request.body;
    return photoTab.createPhotoFolder(siteName, stationId, folderPath);
  });

  fastify.delete('/file', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Delete photos')],
  }, async (request) => {
    const { siteName, stationId, photoPath } = request.body;
    return photoTab.deletePhoto(siteName, stationId, photoPath);
  });

  fastify.delete('/folder', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Delete photo folders')],
  }, async (request) => {
    const { siteName, stationId, folderPath } = request.body;
    return photoTab.deleteFolder(siteName, stationId, folderPath);
  });
}

module.exports = photoRoutes;

'use strict';

const documentsTab = require('../backend/documents_tab');
const fs = require('fs');
const path = require('path');

async function documentRoutes(fastify) {
  const PL = fastify.PERMISSION_LEVELS;

  fastify.get('/structure', async (request) => {
    const { siteName, stationId, subPath } = request.query;
    return documentsTab.getStationDocumentStructure(siteName, stationId, subPath);
  });

  // Download / stream a document file
  fastify.get('/file', async (request, reply) => {
    const { siteName, stationId, docPath } = request.query;
    try {
      const result = await documentsTab.getDocumentPath(siteName, stationId, docPath);
      if (!result || !result.success || !result.path) {
        return reply.code(404).send({ success: false, message: 'Document not found' });
      }
      if (!fs.existsSync(result.path)) {
        return reply.code(404).send({ success: false, message: 'Document file not found on disk' });
      }
      const ext = path.extname(result.path).toLowerCase();
      const mime = {
        '.pdf': 'application/pdf', '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls': 'application/vnd.ms-excel',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.csv': 'text/csv', '.txt': 'text/plain',
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.gif': 'image/gif', '.webp': 'image/webp',
      }[ext] || 'application/octet-stream';

      reply.header('Content-Disposition', `inline; filename="${path.basename(result.path)}"`);
      reply.type(mime);
      return reply.send(fs.createReadStream(result.path));
    } catch (e) {
      return reply.code(500).send({ success: false, message: String(e) });
    }
  });

  fastify.post('/upload', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Save documents')],
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

    return documentsTab.saveDocuments(fields.siteName, fields.stationId, fields.folderPath, files);
  });

  fastify.post('/folder', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Add document folders')],
  }, async (request) => {
    const { siteName, stationId, folderPath } = request.body;
    return documentsTab.createDocumentFolder(siteName, stationId, folderPath);
  });

  fastify.delete('/file', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Delete documents')],
  }, async (request) => {
    const { siteName, stationId, docPath } = request.body;
    return documentsTab.deleteDocument(siteName, stationId, docPath);
  });

  fastify.delete('/folder', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Delete document folders')],
  }, async (request) => {
    const { siteName, stationId, folderPath } = request.body;
    return documentsTab.deleteDocumentFolder(siteName, stationId, folderPath);
  });
}

module.exports = documentRoutes;

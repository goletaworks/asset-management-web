'use strict';

const documentsTab = require('../backend/documents_tab');
const fs = require('fs');
const path = require('path');
const { assertSafePathSegment, assertSafeRelativePath } = require('../backend/utils/path_safety');

function validateDocPathInputs(reply, { siteName, stationId, docPath, folderPath, subPath }) {
  try {
    if (siteName !== undefined) assertSafePathSegment(siteName, 'siteName');
    if (stationId !== undefined) assertSafePathSegment(stationId, 'stationId');
    if (docPath !== undefined) assertSafeRelativePath(docPath, 'docPath');
    if (folderPath !== undefined) assertSafeRelativePath(folderPath, 'folderPath');
    if (subPath !== undefined && subPath !== '') assertSafeRelativePath(subPath, 'subPath');
    return true;
  } catch (err) {
    reply.code(err.statusCode || 400).send({ success: false, message: err.message });
    return false;
  }
}

async function documentRoutes(fastify) {
  const PL = fastify.PERMISSION_LEVELS;

  fastify.get('/structure', async (request, reply) => {
    const { siteName, stationId, subPath } = request.query;
    if (!validateDocPathInputs(reply, { siteName, stationId, subPath })) return;
    return documentsTab.getStationDocumentStructure(siteName, stationId, subPath);
  });

  // Download / stream a document file
  fastify.get('/file', async (request, reply) => {
    const { siteName, stationId, docPath } = request.query;
    if (!validateDocPathInputs(reply, { siteName, stationId, docPath })) return;
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

    if (!validateDocPathInputs(reply, {
      siteName: fields.siteName,
      stationId: fields.stationId,
      folderPath: fields.folderPath
    })) return;

    return documentsTab.saveDocuments(fields.siteName, fields.stationId, fields.folderPath, files);
  });

  fastify.post('/folder', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Add document folders')],
  }, async (request, reply) => {
    const { siteName, stationId, folderPath } = request.body || {};
    if (!validateDocPathInputs(reply, { siteName, stationId, folderPath })) return;
    return documentsTab.createDocumentFolder(siteName, stationId, folderPath);
  });

  fastify.delete('/file', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Delete documents')],
  }, async (request, reply) => {
    const { siteName, stationId, docPath } = request.body || {};
    if (!validateDocPathInputs(reply, { siteName, stationId, docPath })) return;
    return documentsTab.deleteDocument(siteName, stationId, docPath);
  });

  fastify.delete('/folder', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Delete document folders')],
  }, async (request, reply) => {
    const { siteName, stationId, folderPath } = request.body || {};
    if (!validateDocPathInputs(reply, { siteName, stationId, folderPath })) return;
    return documentsTab.deleteDocumentFolder(siteName, stationId, folderPath);
  });
}

module.exports = documentRoutes;

'use strict';

const inspectionHistory = require('../backend/inspection_history');
const lookups = require('../backend/lookups_repo');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function inspectionRoutes(fastify) {
  const PL = fastify.PERMISSION_LEVELS;

  fastify.get('/', async (request) => {
    const { siteName, stationId, keywords } = request.query;
    const opts = {};
    if (keywords) {
      opts.keywords = typeof keywords === 'string' ? keywords.split(',') : keywords;
    }
    return inspectionHistory.listInspections(siteName, stationId, 5, opts);
  });

  fastify.get('/keywords', async () => lookups.getInspectionKeywords());

  fastify.put('/keywords', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Edit inspection keywords')],
  }, async (request) => {
    const keywords = request.body.keywords;
    return lookups.setInspectionKeywords(Array.isArray(keywords) ? keywords : []);
  });

  fastify.delete('/:siteName/:stationId/:folderName', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Delete inspections')],
  }, async (request) => {
    const { siteName, stationId, folderName } = request.params;
    return inspectionHistory.deleteInspectionFolder(siteName, stationId, folderName);
  });

  // Multipart upload for creating an inspection
  fastify.post('/', {
    preHandler: [fastify.withPermission(PL.READ_EDIT, 'Create inspections')],
  }, async (request) => {
    const parts = request.parts();
    const fields = {};
    const photoFiles = [];
    let reportFile = null;

    for await (const part of parts) {
      if (part.type === 'file') {
        const buf = await part.toBuffer();
        if (part.fieldname === 'report') {
          const tmpPath = path.join(os.tmpdir(), `insp_report_${Date.now()}_${part.filename}`);
          fs.writeFileSync(tmpPath, buf);
          reportFile = tmpPath;
        } else {
          const tmpPath = path.join(os.tmpdir(), `insp_photo_${Date.now()}_${part.filename}`);
          fs.writeFileSync(tmpPath, buf);
          photoFiles.push(tmpPath);
        }
      } else {
        fields[part.fieldname] = part.value;
      }
    }

    const payload = {
      ...JSON.parse(fields.payload || '{}'),
      filePaths: photoFiles,
      reportPath: reportFile,
    };

    const result = await inspectionHistory.createInspectionFolder(
      fields.siteName, fields.stationId, payload
    );

    // Clean up temp files
    for (const f of [...photoFiles, reportFile].filter(Boolean)) {
      try { fs.unlinkSync(f); } catch (_) {}
    }

    return result;
  });
}

module.exports = inspectionRoutes;

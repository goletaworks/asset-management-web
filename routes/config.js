'use strict';

const config = require('../backend/config');
const testConfig = require('../backend/config_test_algorithm');

async function configRoutes(fastify) {
  fastify.get('/db', async () => {
    const dbConfig = config.getDbConfig();
    return {
      readSource: dbConfig.read?.source || 'excel',
      writeTargets: dbConfig.write?.targets || ['excel']
    };
  });

  fastify.get('/test-tab-enabled', async () => {
    return testConfig.TEST_TAB_ENABLED;
  });
}

module.exports = configRoutes;

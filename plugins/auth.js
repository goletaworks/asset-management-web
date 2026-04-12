'use strict';

const fp = require('fastify-plugin');

const PUBLIC_ROUTES = new Set([
  '/api/auth/login',
  '/api/auth/has-users',
  '/api/auth/register',
  '/api/auth/access-request',
  '/api/auth/create-with-code',
]);

async function authPlugin(fastify) {
  if (!fastify.hasRequestDecorator('user')) {
    fastify.decorateRequest('user', null);
  }

  fastify.addHook('onRequest', async (request, reply) => {
    // Skip auth for non-API routes (static files)
    if (!request.url.startsWith('/api/')) return;

    // Skip auth for public API routes
    const urlPath = request.url.split('?')[0];
    if (PUBLIC_ROUTES.has(urlPath)) return;

    // Skip auth for SSE progress endpoint
    if (urlPath === '/api/progress') return;

    try {
      const decoded = await request.jwtVerify();
      request.user = {
        name: decoded.name,
        email: decoded.email,
        permissions: decoded.permissions,
        admin: decoded.admin,
      };
    } catch (err) {
      // Check if auth is disabled via feature flags
      const { getFeatureFlags } = require('../backend/feature_flags');
      const flags = getFeatureFlags();
      if (!flags.authEnabled) {
        request.user = {
          name: 'Developer',
          email: 'developer@local',
          permissions: 'All',
          admin: 'Yes',
        };
        return;
      }
      reply.code(401).send({ success: false, code: 'unauthorized', message: 'Authentication required' });
    }
  });
}

module.exports = fp(authPlugin, { name: 'auth-plugin' });

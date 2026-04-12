'use strict';

const auth = require('../backend/auth');

async function authRoutes(fastify) {
  const PL = fastify.PERMISSION_LEVELS;

  fastify.get('/has-users', async () => auth.hasUsers());

  fastify.post('/login', async (request, reply) => {
    const { name, password } = request.body || {};
    const result = await auth.loginUser(name, password);
    if (!result || !result.success) return result || { success: false };

    const user = result.user || result;
    const token = fastify.jwt.sign({
      name: user.name,
      email: user.email,
      permissions: user.permissions,
      admin: user.admin,
    });

    reply.setCookie('token', token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });

    return { success: true, user, token };
  });

  fastify.post('/logout', async (_request, reply) => {
    await auth.logoutUser();
    reply.clearCookie('token', { path: '/' });
    return { success: true };
  });

  fastify.post('/register', async (request) => {
    return auth.createUser(request.body);
  });

  fastify.post('/admin/create', {
    preHandler: [fastify.withPermission(PL.FULL_ADMIN, 'Create users')],
  }, async (request) => {
    return auth.adminCreateUser(request.body, request.user);
  });

  fastify.get('/me', async (request) => {
    if (request.user) return request.user;
    return null;
  });

  fastify.get('/users', async () => auth.getAllUsers());

  fastify.put('/users/:target', async (request, reply) => {
    const { target } = request.params;
    const updates = request.body;
    const current = request.user;
    const norm = (v) => String(v || '').trim().toLowerCase();
    const targetId = norm(target);
    const isSelf = current && (norm(current.name) === targetId || norm(current.email) === targetId);

    if (isSelf) {
      if (updates?.permissionLevel) {
        return reply.code(403).send({
          success: false,
          code: 'forbidden',
          message: 'You cannot change your own permission level. Please ask an approver to adjust your permissions.'
        });
      }
      return auth.updateUser(target, updates, current);
    }

    if (!fastify.hasPermission(current, PL.FULL_ADMIN)) {
      return reply.code(403).send({
        success: false,
        code: 'forbidden',
        message: 'Update users requires Full Admin access.'
      });
    }
    return auth.updateUser(target, updates, current);
  });

  fastify.delete('/users/:target', {
    preHandler: [fastify.withPermission(PL.FULL_ADMIN, 'Delete users')],
  }, async (request) => {
    return auth.deleteUser(request.params.target, request.user);
  });

  fastify.post('/access-request', async (request) => {
    return auth.sendAccessRequest(request.body);
  });

  fastify.post('/create-with-code', async (request) => {
    return auth.createUserWithCode(request.body);
  });
}

module.exports = authRoutes;

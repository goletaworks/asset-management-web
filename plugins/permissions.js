'use strict';

const fp = require('fastify-plugin');

const PERMISSION_LEVELS = {
  READ_ONLY: 'Read Only',
  READ_EDIT: 'Read and Edit',
  READ_EDIT_GI: 'Read and Edit, including General Info, and Add Infrastructure',
  FULL_ADMIN: 'Full Admin'
};

const PERMISSION_ORDER = [
  PERMISSION_LEVELS.READ_ONLY,
  PERMISSION_LEVELS.READ_EDIT,
  PERMISSION_LEVELS.READ_EDIT_GI,
  PERMISSION_LEVELS.FULL_ADMIN
];

function normalizePermissionLevel(level, isAdminFlag) {
  const raw = String(level || '').trim();
  if (isAdminFlag === true || isAdminFlag === 'Yes' || raw === 'All') return PERMISSION_LEVELS.FULL_ADMIN;
  if (raw === 'Read and Edit General Info and Delete Functionalities') {
    return PERMISSION_LEVELS.READ_EDIT_GI;
  }
  if (PERMISSION_ORDER.includes(raw)) return raw;
  return PERMISSION_LEVELS.READ_ONLY;
}

const GENERAL_INFO_FIELDS = new Set([
  'station_id', 'asset_type', 'name', 'province', 'lat', 'lon',
  'status', 'category', 'site name', 'latitude', 'longitude'
]);

function touchesGeneralInformation(stationData = {}) {
  for (const raw of Object.keys(stationData || {})) {
    const k = String(raw || '').toLowerCase();
    if (k === 'station_id') continue;
    if (GENERAL_INFO_FIELDS.has(k)) return true;
    if (k.startsWith('general information')) return true;
  }
  return false;
}

function stripGeneralInformation(stationData = {}) {
  const out = { ...stationData };
  Object.keys(out).forEach((raw) => {
    const k = String(raw || '').toLowerCase();
    if (k === 'station_id') return;
    if (GENERAL_INFO_FIELDS.has(k) || k.startsWith('general information')) {
      delete out[raw];
    }
  });
  return out;
}

function getUserLevel(user) {
  if (!user) return PERMISSION_LEVELS.READ_ONLY;
  return normalizePermissionLevel(user.permissions, user.admin === 'Yes' || user.admin === true);
}

function hasPermission(user, requiredLevel) {
  const level = getUserLevel(user);
  return PERMISSION_ORDER.indexOf(level) >= PERMISSION_ORDER.indexOf(requiredLevel);
}

function withPermission(requiredLevel, actionLabel = 'This action') {
  return async (request, reply) => {
    if (!hasPermission(request.user, requiredLevel)) {
      reply.code(403).send({
        success: false,
        code: 'forbidden',
        message: `${actionLabel} requires ${requiredLevel} access. Please ask an approver to change your permission level.`
      });
    }
  };
}

async function permissionsPlugin(fastify) {
  fastify.decorate('PERMISSION_LEVELS', PERMISSION_LEVELS);
  fastify.decorate('withPermission', withPermission);
  fastify.decorate('hasPermission', hasPermission);
  fastify.decorate('getUserLevel', getUserLevel);
  fastify.decorate('touchesGeneralInformation', touchesGeneralInformation);
  fastify.decorate('stripGeneralInformation', stripGeneralInformation);
}

module.exports = fp(permissionsPlugin, {
  name: 'permissions-plugin',
  dependencies: ['auth-plugin']
});

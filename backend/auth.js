// backend/auth.js
const crypto = require('crypto');
const { getPersistence } = require('./persistence');
const { getFeatureFlags } = require('./feature_flags');
const accessRequests = require('./access_requests');

// Toggle to enable/disable authentication logic via feature-flags.json.
// false means NO LOGIN; true means YES LOGIN
const AUTH_ENABLED = getFeatureFlags().authEnabled;

let currentUser = null;
let sessionToken = null;

const LEGACY_PERMISSION_LEVEL = 'Read and Edit General Info and Delete Functionalities';
const UPDATED_PERMISSION_LEVEL = 'Read and Edit, including General Info, and Add Infrastructure';

// Default dev user used when auth is disabled
const DEV_USER = {
  name: 'Developer',
  email: 'developer@local',
  admin: 'Yes',
  permissions: 'All',
  status: 'Active',
  created: new Date().toISOString(),
  lastLogin: ''
};

// Initialize auth workbook
async function initAuthWorkbook() {
  try {
    if (!AUTH_ENABLED) {
      console.log('[auth] Auth disabled. Skipping workbook initialization.');
      return { exists: true, disabled: true };
    }

    console.log('[auth] Initializing auth persistence...');
    const persistence = await getPersistence();

    // Create the file through the worker
    const result = await persistence.createAuthWorkbook();
    console.log('[auth] Auth persistence initialized:', result);
    
    return { exists: result.success };
  } catch (error) {
    console.error('[auth] Error initializing auth workbook:', error);
    throw error;
  }
}

// Hash password
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Validate email domain
function validateEmail(email) {
  const normalized = email.toLowerCase().trim();
  return normalized.endsWith('@ec.gc.ca');
}

function normalizeLoginInput(value) {
  return String(value || '').trim().toLowerCase();
}

function mapPermissionLevelToRole(level) {
  const normalized = (() => {
    const trimmed = String(level || '').trim();
    if (trimmed === LEGACY_PERMISSION_LEVEL) return UPDATED_PERMISSION_LEVEL;
    return trimmed;
  })();
  return {
    admin: normalized === 'Full Admin',
    permissions: normalized || 'Read Only'
  };
}

function isFullAdmin(user = {}) {
  const adminFlag = user.admin === true || user.admin === 'Yes';
  const perm = String(user.permissions || '').trim();
  return adminFlag || perm === 'Full Admin' || perm === 'All';
}

function isSameUser(a, b) {
  if (!a || !b) return false;
  const norm = (v) => String(v || '').trim().toLowerCase();
  return norm(a.name) && norm(a.name) === norm(b.name)
    || norm(a.email) && norm(a.email) === norm(b.email);
}

// Create user
async function createUser(userData) {
  try {
    if (!AUTH_ENABLED) {
      console.log('[auth] Auth disabled. createUser ignored.');
      return { success: false, message: 'Authentication is disabled in backend/auth.js' };
    }

    const { name, email, password, admin, permissions } = userData;
    
    console.log('[auth] Creating user:', name);
    
    if (!validateEmail(email)) {
      return { success: false, message: 'Email must be @ec.gc.ca domain' };
    }

    const hashedPassword = hashPassword(password);
    const persistence = await getPersistence();

    const result = await persistence.createAuthUser({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      admin: admin ? 'Yes' : 'No',
      permissions: permissions || 'Read',
      status: 'Inactive',
      created: new Date().toISOString(),
      lastLogin: ''
    });

    console.log('[auth] User creation result:', result);
    return result;
  } catch (error) {
    console.error('[auth] Error creating user:', error);
    return { success: false, message: String(error) };
  }
}

async function adminCreateUser(userData, actingUser = null) {
  try {
    if (!AUTH_ENABLED) {
      return { success: false, message: 'Authentication is disabled in backend/auth.js' };
    }
    const actor = actingUser || getCurrentUser();
    if (!isFullAdmin(actor)) {
      return { success: false, message: 'Only Full Admin can create users' };
    }

    const { name, email, password, permissionLevel } = userData || {};
    if (!name || !email || !password || !permissionLevel) {
      return { success: false, message: 'Name, email, password, and permission level are required' };
    }
    if (!validateEmail(email)) {
      return { success: false, message: 'Email must be @ec.gc.ca domain' };
    }

    const { admin, permissions } = mapPermissionLevelToRole(permissionLevel);
    const hashedPassword = hashPassword(password);
    const persistence = await getPersistence();

    const result = await persistence.createAuthUser({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      admin: admin ? 'Yes' : 'No',
      permissions: permissions || 'Read',
      status: 'Inactive',
      created: new Date().toISOString(),
      lastLogin: ''
    });

    return result;
  } catch (error) {
    console.error('[auth] Error adminCreateUser:', error);
    return { success: false, message: String(error) };
  }
}

// Login user
async function loginUser(name, password) {
  try {
    console.log('[auth] Login attempt for:', name);
    const loginId = normalizeLoginInput(name);

    if (!AUTH_ENABLED) {
      // Bypass login and issue a dev session
      currentUser = { ...DEV_USER, name: name || DEV_USER.name };
      sessionToken = crypto.randomBytes(32).toString('hex');
      console.log('[auth] Auth disabled. Bypassing login for:', currentUser.name);
      return {
        success: true,
        user: currentUser,
        token: sessionToken,
        disabled: true
      };
    }
    
    // Check if any users exist via persistence before trying login
    const userCheck = await hasUsers(); // Call local function directly
    if (!userCheck) {
      return { success: false, message: 'No users exist. Please create an account.' };
    }

    const hashedPassword = hashPassword(password);
    const persistence = await getPersistence();

    const result = await persistence.loginAuthUser(loginId, hashedPassword);
    
    if (result.success) {
      currentUser = result.user;
      sessionToken = crypto.randomBytes(32).toString('hex');
      console.log('[auth] Login successful for:', name);
      
      return { 
        success: true, 
        user: currentUser,
        token: sessionToken
      };
    }
    
    return result;
  } catch (error) {
    console.error('[auth] Login error:', error);
    return { success: false, message: 'Login error occurred' };
  }
}

// Logout user
async function logoutUser() {
  try {
    if (!currentUser) return { success: true };

    if (!AUTH_ENABLED) {
      currentUser = null;
      sessionToken = null;
      return { success: true, disabled: true };
    }

    const persistence = await getPersistence();
    const result = await persistence.logoutAuthUser(currentUser.name);
    
    currentUser = null;
    sessionToken = null;

    return result;
  } catch (error) {
    console.error('[auth] Logout error:', error);
    return { success: true }; // Still clear local session
  }
}

// Get all users
async function getAllUsers() {
  try {
    if (!AUTH_ENABLED) {
      return [DEV_USER];
    }

    const persistence = await getPersistence();
    const result = await persistence.getAllAuthUsers();
    return result.users || [];
  } catch (error) {
    console.error('[auth] Error getting users:', error);
    return [];
  }
}

// Check if any users exist
async function hasUsers() {
  try {
    if (!AUTH_ENABLED) return true;

    const persistence = await getPersistence();
    const result = await persistence.hasAuthUsers();
    return result.hasUsers || false;
  } catch (error) {
    console.error('[auth] Error checking users:', error);
    return false;
  }
}

// Get current user
function getCurrentUser() {
  if (!AUTH_ENABLED) {
    return currentUser || DEV_USER;
  }
  return currentUser;
}

// Verify session
function verifySession(token) {
  if (!AUTH_ENABLED) return true;
  return token === sessionToken && currentUser !== null;
}

// Send access request (email + store pending request)
async function sendAccessRequest(requestData) {
  try {
    const { name, email, password, reason, approver, permissionLevel } = requestData || {};

    if (!name || !email || !password || !reason || !approver || !permissionLevel) {
      return { success: false, message: 'All fields are required' };
    }

    if (!validateEmail(email)) {
      return { success: false, message: 'Email must be @ec.gc.ca domain' };
    }

    const hashedPassword = hashPassword(password);
    const result = await accessRequests.createRequest({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      passwordHash: hashedPassword,
      reason: reason.trim(),
      approverName: approver,
      permissionLevel
    });

    return result;
  } catch (error) {
    console.error('[auth] Error sending access request:', error);
    return { success: false, message: 'Failed to send access request' };
  }
}

// Create account using access code issued to approver
async function createUserWithCode(data) {
  try {
    if (!AUTH_ENABLED) {
      return { success: false, message: 'Authentication is disabled; no account needed' };
    }

    const { nameOrEmail, password, accessCode } = data || {};
    if (!nameOrEmail || !password || !accessCode) {
      return { success: false, message: 'Name/email, password, and access code are required' };
    }

    const hashedPassword = hashPassword(password);
    const consumeResult = await accessRequests.consumeRequest(nameOrEmail, accessCode);
    if (!consumeResult.success) {
      return consumeResult;
    }

    const request = consumeResult.request;
    if (request.passwordHash !== hashedPassword) {
      return { success: false, message: 'Password does not match the original request. Please resend request.' };
    }

    const { admin, permissions } = mapPermissionLevelToRole(request.permissionLevel);
    const persistence = await getPersistence();
    const creation = await persistence.createAuthUser({
      name: request.name,
      email: request.email,
      password: hashedPassword,
      admin,
      permissions,
      status: 'Inactive',
      created: new Date().toISOString(),
      lastLogin: ''
    });

    return creation;
  } catch (error) {
    console.error('[auth] Error creating user with access code:', error);
    return { success: false, message: 'Failed to create user with access code' };
  }
}

async function updateUser(targetNameOrEmail, updates = {}, actingUser = null) {
  try {
    if (!AUTH_ENABLED) {
      return { success: false, message: 'Authentication is disabled; no account needed' };
    }
    if (!targetNameOrEmail) return { success: false, message: 'Target user is required' };
    const actor = actingUser || getCurrentUser();
    const normalizedTarget = String(targetNameOrEmail || '').trim();
    const targetForCompare = {
      name: updates.name || targetNameOrEmail,
      email: updates.email || targetNameOrEmail
    };
    const self = isSameUser(actor, targetForCompare);

    if (!self && !isFullAdmin(actor)) {
      return { success: false, message: 'Only Full Admin can update other users' };
    }

    const updatePayload = {};

    // Permission level changes allowed only when acting on others as Full Admin
    if (updates.permissionLevel) {
      if (self) {
        return { success: false, message: 'You cannot change your own permission level' };
      }
      const { admin, permissions } = mapPermissionLevelToRole(updates.permissionLevel);
      updatePayload.admin = admin ? 'Yes' : 'No';
      updatePayload.permissions = permissions;
    }

    // Identity updates: only for self
    if (self) {
      if (updates.name) updatePayload.name = String(updates.name || '').trim();
      if (updates.email) updatePayload.email = String(updates.email || '').trim().toLowerCase();
      if (updates.password) {
        updatePayload.passwordHash = hashPassword(updates.password);
      }
    } else {
      // For other users, explicitly block name/email/password changes
      if (updates.name || updates.email || updates.password) {
        return { success: false, message: 'You cannot change another user\'s name, email, or password' };
      }
      if (updates.status) updatePayload.status = updates.status;
    }

    const persistence = await getPersistence();
    const result = await persistence.updateAuthUser(normalizedTarget, updatePayload);
    return result;
  } catch (error) {
    console.error('[auth] Error updating user:', error);
    return { success: false, message: 'Failed to update user' };
  }
}

async function deleteUser(targetNameOrEmail, actingUser = null) {
  try {
    if (!AUTH_ENABLED) {
      return { success: false, message: 'Authentication is disabled; no account needed' };
    }
    if (!targetNameOrEmail) return { success: false, message: 'Target user is required' };
    const actor = actingUser || getCurrentUser();
    if (!isFullAdmin(actor)) {
      return { success: false, message: 'Only Full Admin can delete users' };
    }
    const targetForCompare = { name: targetNameOrEmail, email: targetNameOrEmail };
    const isSelf = isSameUser(actor, targetForCompare);

    const persistence = await getPersistence();
    const res = await persistence.deleteAuthUser(String(targetNameOrEmail || '').trim());

    if (res.success && isSelf) {
      currentUser = null;
      sessionToken = null;
      res.autoclose = true;
    }

    return res;
  } catch (error) {
    console.error('[auth] Error deleting user:', error);
    return { success: false, message: 'Failed to delete user' };
  }
}

module.exports = {
  initAuthWorkbook,
  createUser,
  adminCreateUser,
  loginUser,
  logoutUser,
  getAllUsers,
  hasUsers,
  getCurrentUser,
  verifySession,
  sendAccessRequest,
  createUserWithCode,
  updateUser,
  deleteUser
};

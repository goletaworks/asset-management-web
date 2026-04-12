// frontend/js/users.js
(function() {
  'use strict';

  let usersContainer = null;
  let currentUserData = null;
  let editingUser = null;

  const PERMS = {
    READ_ONLY: 'Read Only',
    READ_EDIT: 'Read and Edit',
    READ_EDIT_GI: 'Read and Edit, including General Info, and Add Infrastructure',
    FULL_ADMIN: 'Full Admin'
  };

  function isFullAdmin(user) {
    if (!user) return false;
    if (user.admin === true || user.admin === 'Yes') return true;
    const p = (user.permissions || '').trim();
    return p === PERMS.FULL_ADMIN || p === 'All';
  }

  function isSelf(user) {
    if (!currentUserData || !user) return false;
    const norm = (v) => String(v || '').trim().toLowerCase();
    return norm(currentUserData.email) === norm(user.email) ||
      norm(currentUserData.name) === norm(user.name);
  }

  async function initUsersView() {
    usersContainer = document.getElementById('usersPage');
    if (!usersContainer) return;

    try {
      currentUserData = await window.electronAPI.getCurrentUser();
    } catch (e) {
      console.warn('[users] Failed to get current user', e);
    }

    // Load and display users
    await loadUsers();

    // Bind add user button
    const btnAdd = document.getElementById('btnAddUser');
    if (btnAdd) {
      btnAdd.addEventListener('click', showAddUserModal);
    }

    // Bind modal controls
    bindModalControls();
  }

  async function loadUsers() {
    try {
      const users = await window.electronAPI.getAllUsers();
      renderUsers(users);
    } catch (e) {
      console.error('[users] Failed to load:', e);
      appAlert('Failed to load users');
    }
  }

  function maskPassword(password) {
    if (!password) return '********';
    const firstChar = password.charAt(0);
    return '*******';
  }

  function renderUsers(users) {
    const grid = document.getElementById('usersGrid');
    if (!grid) return;

    grid.innerHTML = '';

    users.forEach(user => {
      const card = document.createElement('div');
      card.className = 'user-card';
      card.classList.toggle('active', user.status === 'Active');
      card.classList.toggle('admin', user.admin);

      card.innerHTML = `
        <div class="user-status ${user.status === 'Active' ? 'status-active' : 'status-inactive'}">
          <span class="status-dot"></span>
          ${user.status}
        </div>
        <div class="user-avatar">
          <span>${user.name ? user.name.charAt(0).toUpperCase() : '?'}</span>
        </div>
        <div class="user-info">
          <h3 class="user-name">${user.name || 'Unknown'}</h3>
          <p class="user-email">${user.email || ''}</p>
        </div>
        <div class="user-details">
          <div class="detail-row">
            <span class="detail-label">Password:</span>
            <span class="detail-value password-masked">${maskPassword(user.password)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Role:</span>
            <span class="detail-value">${user.admin ? 'Admin' : 'User'}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Permissions:</span>
            <span class="detail-value">${user.permissions || 'Read'}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Created:</span>
            <span class="detail-value">${formatDate(user.created)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Last Login:</span>
            <span class="detail-value">${formatDate(user.lastLogin) || 'Never'}</span>
          </div>
        </div>
      `;

      const canEdit = isSelf(user) || isFullAdmin(currentUserData);
      if (canEdit) {
        const actions = document.createElement('div');
        actions.className = 'user-actions';

        const btnEdit = document.createElement('button');
        btnEdit.className = 'btn btn-ghost';
        btnEdit.textContent = 'Edit';
        btnEdit.addEventListener('click', () => showEditUserModal(user));
        actions.appendChild(btnEdit);

        if (isFullAdmin(currentUserData)) {
          const btnDelete = document.createElement('button');
          btnDelete.className = 'btn btn-danger';
          btnDelete.textContent = 'Delete';
          btnDelete.addEventListener('click', () => confirmDeleteUser(user));
          actions.appendChild(btnDelete);
        }

        card.appendChild(actions);
      }

      grid.appendChild(card);
    });
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    } catch {
      return dateStr;
    }
  }

  function showAddUserModal() {
    const modal = document.getElementById('addUserModal');
    if (modal) {
      modal.style.display = 'flex';
      // Ensure the overlay is interactive and visible immediately
      modal.classList.add('open');
      requestAnimationFrame(() => modal.classList.add('open')); // keep fade-in timing
      // Clear form
      document.getElementById('newUserName').value = '';
      document.getElementById('newUserEmail').value = '';
      document.getElementById('newUserPassword').value = '';
      document.getElementById('newUserReason').value = '';
      document.getElementById('newUserApprover').value = 'Khodayar Ahktarhavari';
      document.getElementById('newUserPermissionLevel').value = 'Read Only';
      document.getElementById('newUserAccessCode').value = '';
    }
  }

  function hideAddUserModal() {
    const modal = document.getElementById('addUserModal');
    if (!modal) return;
    modal.classList.remove('open');
    setTimeout(() => { modal.style.display = 'none'; }, 160);
  }

  function showEditUserModal(user) {
    editingUser = user;
    const modal = document.getElementById('editUserModal');
    if (!modal) return;
    document.getElementById('editUserName').value = user.name || '';
    document.getElementById('editUserEmail').value = user.email || '';
    const perm = user.permissions === 'Read and Edit General Info and Delete Functionalities'
      ? PERMS.READ_EDIT_GI
      : (user.permissions || PERMS.READ_ONLY);
    document.getElementById('editUserPermissionLevel').value = perm;
    document.getElementById('editUserPassword').value = '';

    const disableIdentityFields = !isSelf(user);
    document.getElementById('editUserName').disabled = disableIdentityFields;
    document.getElementById('editUserEmail').disabled = disableIdentityFields;
    document.getElementById('editUserPassword').disabled = disableIdentityFields;
    document.getElementById('editUserPermissionLevel').disabled =
      isSelf(user) || !isFullAdmin(currentUserData);

    modal.style.display = 'flex';
    modal.classList.add('open');
  }

  function hideEditUserModal() {
    const modal = document.getElementById('editUserModal');
    if (!modal) return;
    modal.classList.remove('open');
    setTimeout(() => { modal.style.display = 'none'; }, 160);
    editingUser = null;
  }

  function bindModalControls() {
    document.getElementById('closeAddUser')?.addEventListener('click', hideAddUserModal);
    document.getElementById('cancelAddUser')?.addEventListener('click', hideAddUserModal);
    document.getElementById('closeEditUser')?.addEventListener('click', hideEditUserModal);
    document.getElementById('cancelEditUser')?.addEventListener('click', hideEditUserModal);
    
    document.getElementById('btnSendUserRequest')?.addEventListener('click', async () => {
      const name = document.getElementById('newUserName').value.trim();
      const email = document.getElementById('newUserEmail').value.trim();
      const password = document.getElementById('newUserPassword').value;
      const reason = document.getElementById('newUserReason').value.trim();
      const approver = document.getElementById('newUserApprover').value;
      const permissionLevel = document.getElementById('newUserPermissionLevel').value;

      if (!name || !email || !password || !reason) {
        appAlert('Please fill in all required fields');
        return;
      }

      if (!email.toLowerCase().endsWith('@ec.gc.ca')) {
        appAlert('Email must be @ec.gc.ca domain');
        return;
      }

      try {
        const result = await window.electronAPI.sendAccessRequest({
          name,
          email,
          password,
          reason,
          approver,
          permissionLevel
        });

        if (result.success) {
          appAlert('Request sent! Ask your approver for the access code.');
          document.getElementById('newUserAccessCode')?.focus();
        } else {
          appAlert(result.message || 'Failed to send request');
        }
      } catch (e) {
        console.error('[users] Send request failed:', e);
        appAlert('Failed to send request');
      }
    });

    document.getElementById('saveNewUser')?.addEventListener('click', async () => {
      const name = document.getElementById('newUserName').value.trim();
      const email = document.getElementById('newUserEmail').value.trim();
      const password = document.getElementById('newUserPassword').value;
      const accessCode = document.getElementById('newUserAccessCode').value.trim();
      const permissionLevel = document.getElementById('newUserPermissionLevel').value;

      if (!name || !email || !password || !accessCode) {
        appAlert('Please fill in name, email, password, and access code');
        return;
      }

      if (!email.toLowerCase().endsWith('@ec.gc.ca')) {
        appAlert('Email must be @ec.gc.ca domain');
        return;
      }

      try {
        // If current user is Full Admin, allow direct creation without access code
        if (isFullAdmin(currentUserData)) {
          const result = await window.electronAPI.adminCreateUser({
            name,
            email,
            password,
            permissionLevel
          });
          if (result.success) {
            appAlert('User created successfully');
            hideAddUserModal();
            await loadUsers();
            return;
          }
          appAlert(result.message || 'Failed to create user');
          return;
        }

        const result = await window.electronAPI.createUserWithCode({
          nameOrEmail: email || name,
          password,
          accessCode
        });

        if (result.success) {
          appAlert('User created successfully');
          hideAddUserModal();
          await loadUsers();
        } else {
          appAlert(result.message || 'Failed to create user');
        }
      } catch (e) {
        console.error('[users] Create with code failed:', e);
        appAlert('Failed to create user');
      }
    });

    document.getElementById('saveEditUser')?.addEventListener('click', async () => {
      if (!editingUser) return;
      const name = document.getElementById('editUserName').value.trim();
      const email = document.getElementById('editUserEmail').value.trim();
      const permissionLevel = document.getElementById('editUserPermissionLevel').value;
      const password = document.getElementById('editUserPassword').value;

      const updates = {};
      const selfEdit = isSelf(editingUser);
      if (isFullAdmin(currentUserData) && !selfEdit) {
        updates.permissionLevel = permissionLevel;
      }
      if (selfEdit) {
        if (name && name !== editingUser.name) updates.name = name;
        if (email && email !== editingUser.email) updates.email = email;
        if (password) updates.password = password;
      }

      try {
        const result = await window.electronAPI.updateUser(editingUser.email || editingUser.name, updates);
        if (result.success) {
          appAlert('User updated successfully');
          hideEditUserModal();
          await loadUsers();
        } else {
          appAlert(result.message || 'Failed to update user');
        }
      } catch (e) {
        console.error('[users] Update user failed:', e);
        appAlert('Failed to update user');
      }
    });
  }

  async function confirmDeleteUser(user) {
    try {
      const confirmFn = window.appConfirm
        ? window.appConfirm
        : (msg) => Promise.resolve(window.confirm ? window.confirm(msg) : false);
      const label = isSelf(user)
        ? 'Delete your own account? You will be signed out.'
        : `Delete ${user.name || user.email}? This cannot be undone.`;
      const ok = await confirmFn(label);
      if (!ok) return;
      const result = await window.electronAPI.deleteUser(user.email || user.name);
      if (result.success) {
        appAlert('User deleted');
        await loadUsers();
      } else {
        appAlert(result.message || 'Failed to delete user');
      }
    } catch (e) {
      console.error('[users] Delete user failed:', e);
      appAlert('Failed to delete user');
    }
  }

  // Expose for navigation
  window.initUsersView = initUsersView;
})();

// frontend/js/login.js
(function() {
  'use strict';

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    // Check if we need to show registration (no users exist)
    const hasUsers = await window.electronAPI.hasUsers();
    
    if (!hasUsers) {
      showRegisterForm();
      document.getElementById('showLogin').style.display = 'none';
    }

    bindEvents();
  }

  function bindEvents() {
    document.getElementById('showRegister')?.addEventListener('click', (e) => {
      e.preventDefault();
      showRegisterForm();
    });

    document.getElementById('showLogin')?.addEventListener('click', (e) => {
      e.preventDefault();
      showLoginForm();
    });

    document.getElementById('btnLogin')?.addEventListener('click', handleLogin);
    document.getElementById('btnSendRequest')?.addEventListener('click', handleSendRequest);
    document.getElementById('btnCreateAccount')?.addEventListener('click', handleCreateAccount);

    // Enter key handlers
    document.getElementById('loginPassword')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleLogin();
    });
    document.getElementById('regPassword')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleSendRequest();
    });
    document.getElementById('regAccessCode')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleCreateAccount();
    });
  }

  function showLoginForm() {
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('registerForm').style.display = 'none';
  }

  function showRegisterForm() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
  }

  async function handleLogin() {
    const name = document.getElementById('loginName').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!name || !password) {
      window.appAlert('Please enter name and password');
      return;
    }

    try {
      const result = await window.electronAPI.loginUser(name, password);
      
      if (result.success) {
        window.electronAPI.navigateToMain();
      } else {
        window.appAlert(result.message || 'Login failed');
      }
    } catch (e) {
      console.error('[login] Error:', e);
      window.appAlert('Login error occurred');
    }
  }

  async function handleSendRequest() {
    const name = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const reason = document.getElementById('regReason').value.trim();
    const approver = document.getElementById('regApprover').value;
    const permissionLevel = document.getElementById('regPermissionLevel').value;

    if (!name || !email || !password || !reason) {
      window.appAlert('Please fill in all required fields');
      return;
    }

    // PHM disable
    // if (!email.toLowerCase().endsWith('@ec.gc.ca')) {
    //   window.appAlert('Email must be @ec.gc.ca domain');
    //   return;
    // }

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
        window.appAlert('Request sent! Check with your approver for the access code.');
        document.getElementById('regAccessCode')?.focus();
      } else {
        window.appAlert(result.message || 'Failed to send request');
      }
    } catch (e) {
      console.error('[register] Send request error:', e);
      window.appAlert('Failed to send request');
    }
  }

  async function handleCreateAccount() {
    const name = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const accessCode = document.getElementById('regAccessCode').value.trim();

    if (!name || !email || !password || !accessCode) {
      window.appAlert('Please enter name, email, password, and access code');
      return;
    }

    // PHM disable
    // if (!email.toLowerCase().endsWith('@ec.gc.ca')) {
    //   window.appAlert('Email must be @ec.gc.ca domain');
    //   return;
    // }

    try {
      const result = await window.electronAPI.createUserWithCode({
        nameOrEmail: email || name,
        password,
        accessCode
      });

      if (result.success) {
        window.appAlert('Account created! Please login.');
        showLoginForm();
      } else {
        window.appAlert(result.message || 'Registration failed');
      }
    } catch (e) {
      console.error('[register] Create with code error:', e);
      window.appAlert('Registration error occurred');
    }
  }
})();

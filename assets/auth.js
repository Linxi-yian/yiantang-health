/* 易安堂：唯一昵称 + 恢复码认证与账号云端状态同步（无第三方前端依赖） */
(function () {
  'use strict';
  const cfg = window.EY_CONFIG || {};
  const base = String(cfg.SUPABASE_URL || '').replace(/\/$/, '');
  const publicKey = String(cfg.SUPABASE_ANON_KEY || '');
  const preview = cfg.LOCAL_PREVIEW_AUTH === true;
  const SESSION_KEY = 'tcm_health_auth_v2';
  const LEGACY_SESSION_KEY = 'tcm_health_auth_v1';
  const DEVICE_KEY = 'tcm_health_device_v1';
  const PREVIEW_ACCOUNTS_KEY = 'tcm_health_preview_accounts_v1';
  const LOGIN_DOMAIN = 'nickname.invalid';
  const enabled = preview || (/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(base) &&
    publicKey.length > 30 && !/YOUR_|这里粘贴|placeholder/i.test(publicKey));

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || '') || fallback; } catch (e) { return fallback; }
  }
  function writeJson(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function readSession() { return readJson(SESSION_KEY, null); }
  function writeSession(s) {
    try { writeJson(SESSION_KEY, s); localStorage.removeItem(LEGACY_SESSION_KEY); } catch (e) { /* 无痕模式下仍允许临时使用 */ }
  }
  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); localStorage.removeItem(LEGACY_SESSION_KEY); } catch (e) {}
  }
  function deviceId() {
    try {
      let id = localStorage.getItem(DEVICE_KEY);
      if (!id) { id = 'd_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2); localStorage.setItem(DEVICE_KEY, id); }
      return id;
    } catch (e) { return 'browser'; }
  }
  function user() { const s = readSession(); return s && s.user ? s.user : null; }
  function signedIn() { const s = readSession(); return !!(enabled && s && s.access_token && s.user); }
  function normalizeNickname(value) {
    let text = String(value == null ? '' : value);
    try { text = text.normalize('NFKC'); } catch (e) {}
    return text.trim().toLocaleLowerCase('zh-CN').replace(/\s+/g, '');
  }
  function normalizeRecoveryCode(value) { return String(value == null ? '' : value).toUpperCase().replace(/[^A-Z2-9]/g, ''); }
  function formatRecoveryCode(value) {
    const raw = normalizeRecoveryCode(value);
    return (raw.match(/.{1,4}/g) || []).join('-');
  }
  function generateRecoveryCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = new Uint8Array(20);
    crypto.getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] & 31];
    return formatRecoveryCode(out);
  }
  async function sha256Hex(value) {
    const bytes = new TextEncoder().encode(String(value));
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function loginEmail(nickname) {
    const key = normalizeNickname(nickname);
    if (!key) throw new Error('请填写昵称');
    return 'u-' + (await sha256Hex(key)) + '@' + LOGIN_DOMAIN;
  }
  function isNicknameAccount(u) { return !!(u && String(u.email || '').toLowerCase().endsWith('@' + LOGIN_DOMAIN)); }
  function headers(withJson) {
    const s = readSession();
    const h = { apikey: publicKey, Accept: 'application/json' };
    if (withJson) h['Content-Type'] = 'application/json';
    if (s && s.access_token) h.Authorization = 'Bearer ' + s.access_token;
    return h;
  }
  async function rawReq(path, opts) {
    const o = opts || {};
    const res = await fetch(base + path, { method: o.method || 'GET', headers: Object.assign(headers(!!o.body), o.headers || {}), body: o.body ? JSON.stringify(o.body) : undefined });
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) { data = { message: text }; }
    if (!res.ok) {
      const err = new Error((data && (data.msg || data.message || data.error_description || data.error)) || ('请求失败（' + res.status + '）'));
      err.status = res.status; err.details = data; throw err;
    }
    return data;
  }
  async function req(path, opts) {
    if (!enabled || preview) throw new Error('云端账号服务尚未配置');
    try { return await rawReq(path, opts); }
    catch (e) {
      if (e.status !== 401 || /\/auth\/v1\/token/.test(path)) throw e;
      const renewed = await refresh();
      if (!renewed) throw e;
      return rawReq(path, opts);
    }
  }
  function previewAccounts() { return readJson(PREVIEW_ACCOUNTS_KEY, {}); }
  function savePreviewAccounts(accounts) { writeJson(PREVIEW_ACCOUNTS_KEY, accounts); }
  function previewUser(account) {
    return { id: account.userId, email: account.email, user_metadata: { nickname: account.nickname, gender: account.gender, age: account.age, account_kind: 'nickname' } };
  }
  function previewSession(account) {
    return { access_token: 'local-preview', refresh_token: 'local-preview', expires_at: 4102444800, user: previewUser(account) };
  }
  async function signUpNickname(nickname, gender, age) {
    const key = normalizeNickname(nickname);
    const email = await loginEmail(nickname);
    if (preview) {
      const recoveryCode = generateRecoveryCode();
      const password = normalizeRecoveryCode(recoveryCode);
      const accounts = previewAccounts();
      if (accounts[key]) { const err = new Error('该昵称已存在，请更换昵称'); err.code = 'nickname_exists'; throw err; }
      const account = {
        userId: crypto.randomUUID ? crypto.randomUUID() : 'preview_' + Date.now().toString(36) + Math.random().toString(36).slice(2),
        email: email, nickname: String(nickname).trim(), gender: gender, age: age,
        recoveryHash: await sha256Hex(password), state: null, revision: 0, createdAt: new Date().toISOString()
      };
      accounts[key] = account; savePreviewAccounts(accounts); writeSession(previewSession(account));
      return { user: previewUser(account), recoveryCode: recoveryCode, preview: true };
    }
    const recoveryCode = generateRecoveryCode();
    try {
      const created = await rawReq('/functions/v1/register-nickname', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + publicKey },
        body: { nickname: String(nickname).trim(), gender: gender, age: age, recovery_code: recoveryCode }
      });
      if (!created || !created.user) throw new Error('账号服务未返回完整注册结果');
      const data = await signInNickname(nickname, recoveryCode);
      return { user: data.user, recoveryCode: recoveryCode, preview: false };
    } catch (e) {
      if ((e.details && e.details.code === 'nickname_exists') || /already registered|already exists|user already|昵称已存在/i.test(String(e && e.message))) {
        const exists = new Error('该昵称已存在，请更换昵称'); exists.code = 'nickname_exists'; throw exists;
      }
      if (e.status === 429 || (e.details && e.details.code === 'rate_limited')) {
        const limited = new Error('操作过于频繁，请 10 分钟后再试'); limited.code = 'rate_limited'; throw limited;
      }
      if (e.details && e.details.code === 'origin_denied') {
        const denied = new Error('当前网址未获注册权限，请使用网站最新地址'); denied.code = 'origin_denied'; throw denied;
      }
      if (!e.status) {
        try {
          const data = await signInNickname(nickname, recoveryCode);
          return { user: data.user, recoveryCode: recoveryCode, preview: false };
        } catch (ignored) { /* 注册请求未成功，沿用原错误 */ }
        const offline = new Error('无法连接账号服务，请检查网络后重试'); offline.code = 'network_error'; throw offline;
      }
      throw e;
    }
  }
  async function signInNickname(nickname, recoveryCode) {
    const key = normalizeNickname(nickname);
    const password = normalizeRecoveryCode(recoveryCode);
    if (!key || password.length < 16) throw new Error('请填写昵称和完整恢复码');
    if (preview) {
      const account = previewAccounts()[key];
      if (!account || account.recoveryHash !== await sha256Hex(password)) {
        const err = new Error('昵称或恢复码不正确'); err.code = 'invalid_recovery'; throw err;
      }
      const session = previewSession(account); writeSession(session); return session;
    }
    const email = await loginEmail(nickname);
    try {
      const data = await req('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: email, password: password } });
      writeSession(data); return data;
    } catch (e) {
      if (e.status === 400) { const invalid = new Error('昵称或恢复码不正确'); invalid.code = 'invalid_recovery'; throw invalid; }
      throw e;
    }
  }
  async function signOut() {
    try { if (!preview && signedIn()) await req('/auth/v1/logout', { method: 'POST' }); } finally { clearSession(); }
  }
  async function refresh() {
    const s = readSession();
    if (!enabled || !s || !s.refresh_token) return null;
    if (preview) return s;
    try {
      const data = await rawReq('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token } });
      writeSession(data); return data;
    } catch (e) { clearSession(); return null; }
  }
  async function ensureSession() {
    const s = readSession();
    if (!s || !s.user || !s.access_token) return null;
    if (preview) return s;
    if (!isNicknameAccount(s.user)) { clearSession(); return null; }
    const expiresAt = Number(s.expires_at || 0);
    if (!expiresAt || expiresAt * 1000 > Date.now() + 120000) return s;
    return refresh();
  }
  function previewAccountForUser() {
    const u = user(); if (!u) return null;
    const accounts = previewAccounts();
    return Object.values(accounts).find(a => a.userId === u.id) || null;
  }

  window.EYAuth = {
    enabled: () => enabled, preview: () => preview, signedIn: signedIn, user: user, deviceId: deviceId,
    normalizeNickname: normalizeNickname, formatRecoveryCode: formatRecoveryCode,
    signUpNickname: signUpNickname, signInNickname: signInNickname,
    signOut: signOut, refresh: refresh, ensureSession: ensureSession, isNicknameAccount: isNicknameAccount
  };
  window.EYCloud = {
    async getProfile() {
      const u = user(); if (!u) return null;
      if (preview) {
        const a = previewAccountForUser();
        return a ? { user_id: a.userId, nickname: a.nickname, gender: a.gender, age: a.age, updated_at: a.updatedAt || a.createdAt } : null;
      }
      const rows = await req('/rest/v1/profiles?select=user_id,nickname,gender,age,updated_at&user_id=eq.' + encodeURIComponent(u.id) + '&limit=1');
      return rows && rows[0] ? rows[0] : null;
    },
    async getState() {
      const u = user(); if (!u) return null;
      if (preview) {
        const a = previewAccountForUser();
        return a && a.state ? { user_id: a.userId, state: a.state, revision: a.revision || 0, schema_version: 2, device_id: deviceId(), updated_at: a.updatedAt } : null;
      }
      const rows = await req('/rest/v1/account_states?select=user_id,state,revision,schema_version,device_id,updated_at&user_id=eq.' + encodeURIComponent(u.id) + '&limit=1');
      return rows && rows[0] ? rows[0] : null;
    },
    async putState(state, revision) {
      const u = user(); if (!u) throw new Error('未登录');
      const next = Math.max(1, (+revision || 0) + 1);
      if (preview) {
        const accounts = previewAccounts(); const key = Object.keys(accounts).find(k => accounts[k].userId === u.id);
        if (!key) throw new Error('预览账号不存在');
        accounts[key].state = JSON.parse(JSON.stringify(state)); accounts[key].revision = next; accounts[key].updatedAt = new Date().toISOString();
        savePreviewAccounts(accounts); return next;
      }
      const row = { user_id: u.id, state: state, revision: next, schema_version: 2, device_id: deviceId() };
      await req('/rest/v1/account_state_revisions', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { user_id: u.id, revision: next, state: state, device_id: deviceId() } });
      await req('/rest/v1/account_states', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: row });
      return next;
    },
    async upsertProfile(profile) {
      const u = user(); if (!u) return;
      if (preview) {
        const accounts = previewAccounts(); const key = Object.keys(accounts).find(k => accounts[k].userId === u.id);
        if (!key) throw new Error('预览账号不存在');
        accounts[key].gender = profile.gender; accounts[key].age = profile.age; accounts[key].updatedAt = new Date().toISOString();
        savePreviewAccounts(accounts); return;
      }
      await req('/rest/v1/profiles', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: Object.assign({}, profile, { user_id: u.id }) });
    }
  };
})();

/**
 * auth.js — 登录验证 + 账号管理模块
 * 
 * 核心设计：
 * - accounts.json 存在 GitHub 仓库中，所有客户端通过 fetch 读取验证登录
 * - 修改账号需要 GitHub Token（存在 localStorage），只有本机管理员有 Token
 * - 别人登录后只能使用工具，无法修改账号密码
 */
const Auth = (() => {
  // ===== 配置 =====
  const GITHUB_USER = 'luo282';
  const GITHUB_REPO = 'zodiac-tool';
  const ACCOUNTS_URL = `https://luo282.github.io/zodiac-tool/accounts.json`;
  const API_BASE = 'https://api.github.com';
  const TOKEN_KEY = 'zodiac_github_token';   // localStorage key
  const SESSION_KEY = 'zodiac_session';       // sessionStorage key

  // ===== 内部工具 =====
  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }
  function setToken(t) {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  }
  function hasToken() {
    return !!getToken();
  }
  function getSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; }
  }
  function setSession(user) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
  }
  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  // ===== 获取账号列表（从 GitHub Pages） =====
  async function fetchAccounts() {
    // 加时间戳防缓存
    const url = ACCOUNTS_URL + '?t=' + Date.now();
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('获取账号数据失败: ' + resp.status);
    const data = await resp.json();
    return data.accounts || [];
  }

  // ===== 登录 =====
  async function login(username, password) {
    const accounts = await fetchAccounts();
    const found = accounts.find(a => a.username === username && a.password === password);
    if (!found) {
      return { ok: false, msg: '账号或密码错误' };
    }
    setSession({ username: found.username, role: found.role, loginTime: Date.now() });
    return { ok: true, user: { username: found.username, role: found.role } };
  }

  // ===== 检查是否已登录 =====
  function isLoggedIn() {
    const s = getSession();
    return s && s.username;
  }
  function currentUser() {
    return getSession();
  }

  // ===== 登出 =====
  function logout() {
    clearSession();
  }

  // ===== GitHub API 修改 accounts.json =====
  async function githubApi(method, path, body) {
    const token = getToken();
    if (!token) throw new Error('未配置 GitHub Token，无法修改账号');
    const opts = {
      method,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'zodiac-auth/1.0',
        'Content-Type': 'application/json'
      }
    };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch(API_BASE + path, opts);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.message || 'API 错误: ' + resp.status);
    return data;
  }

  // 获取 accounts.json 当前 SHA（更新时必须）
  async function getFileSha() {
    const data = await githubApi('GET', `/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/accounts.json`);
    return data.sha;
  }

  // 写入 accounts.json
  async function saveAccounts(accounts) {
    const sha = await getFileSha();
    const content = btoa(unescape(encodeURIComponent(
      JSON.stringify({
        meta: {
          note: "账号密码文件。修改需 GitHub Token。本机管理员可用网页内管理功能修改。",
          github_api: "通过 PUT /repos/luo282/zodiac-tool/contents/accounts.json 修改"
        },
        accounts: accounts
      }, null, 2)
    )));
    await githubApi('PUT', `/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/accounts.json`, {
      message: '更新账号数据 ' + new Date().toLocaleString('zh-CN'),
      content: content,
      sha: sha
    });
  }

  // ===== 账号管理（需 Token） =====
  async function addAccount(username, password, role) {
    if (!hasToken()) throw new Error('未配置 Token，无权管理账号');
    const accounts = await fetchAccounts();
    if (accounts.find(a => a.username === username)) {
      throw new Error('账号已存在: ' + username);
    }
    accounts.push({ username, password, role: role || 'user' });
    await saveAccounts(accounts);
    return { ok: true, msg: '账号已添加' };
  }

  async function deleteAccount(username) {
    if (!hasToken()) throw new Error('未配置 Token，无权管理账号');
    const accounts = await fetchAccounts();
    const idx = accounts.findIndex(a => a.username === username);
    if (idx === -1) throw new Error('账号不存在');
    if (username === 'admin') throw new Error('不能删除默认管理员账号');
    accounts.splice(idx, 1);
    await saveAccounts(accounts);
    return { ok: true, msg: '账号已删除' };
  }

  async function changePassword(username, newPassword) {
    if (!hasToken()) throw new Error('未配置 Token，无权修改密码');
    const accounts = await fetchAccounts();
    const acc = accounts.find(a => a.username === username);
    if (!acc) throw new Error('账号不存在');
    acc.password = newPassword;
    await saveAccounts(accounts);
    return { ok: true, msg: '密码已修改' };
  }

  async function changeRole(username, newRole) {
    if (!hasToken()) throw new Error('未配置 Token，无权修改角色');
    const accounts = await fetchAccounts();
    const acc = accounts.find(a => a.username === username);
    if (!acc) throw new Error('账号不存在');
    acc.role = newRole;
    await saveAccounts(accounts);
    return { ok: true, msg: '角色已修改' };
  }

  async function listAccounts() {
    if (!hasToken()) throw new Error('未配置 Token');
    const accounts = await fetchAccounts();
    return accounts;
  }

  // 配置 Token
  function configureToken(token) {
    setToken(token);
    return hasToken();
  }

  // 验证 Token 是否有效
  async function verifyToken() {
    if (!hasToken()) return { ok: false, msg: '未配置 Token' };
    try {
      const data = await githubApi('GET', '/user');
      return { ok: true, username: data.login };
    } catch (e) {
      return { ok: false, msg: e.message };
    }
  }

  // 清除 Token
  function clearToken() {
    setToken('');
  }

  // ===== 公开接口 =====
  return {
    login,
    logout,
    isLoggedIn,
    currentUser,
    hasToken,
    configureToken,
    verifyToken,
    clearToken,
    fetchAccounts,
    addAccount,
    deleteAccount,
    changePassword,
    changeRole,
    listAccounts,
    ACCOUNTS_URL
  };
})();

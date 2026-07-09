var _sessionToken = null;
var _sessionValida = false;
var _verificando = false;

function getLoginUrl() {
    if (window.location.pathname.includes('/admin/')) {
        return 'login.html';
    }
    return 'admin/login.html';
}

function getSessionFromHash() {
    var hash = window.location.hash.substring(1);
    if (!hash || hash.length < 10) return null;
    return hash;
}

function limparHash() {
    history.replaceState(null, '', window.location.pathname);
}

async function validarSessao(token) {
    if (!window.API_CONFIG || !window.API_CONFIG.token) {
        if (window.initAPI) await initAPI();
    }
    if (!window.API_CONFIG || !API_CONFIG.token) return false;

    try {
        var res = await fetch(API_CONFIG.baseUrl + '/api/read', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + API_CONFIG.token
            },
            body: JSON.stringify({
                project: API_CONFIG.project,
                table: 'sessoes',
                filters: { access_token: token, status: 'aprovado' },
                limit: 1
            })
        });
        var data = await res.json();
        if (data.data && data.data.length > 0) {
            _sessionToken = token;
            _sessionValida = true;
            return true;
        }
    } catch (e) {
        console.warn('[Auth] Erro ao validar sessão:', e);
    }
    return false;
}

async function checkAuth(required) {
    if (_sessionValida) return true;
    if (_verificando) return false;

    var token = getSessionFromHash();
    if (!token) {
        if (required) window.location.href = getLoginUrl();
        return false;
    }

    _verificando = true;
    var valido = await validarSessao(token);
    _verificando = false;

    if (valido) {
        limparHash();
        return true;
    }

    if (required) window.location.href = getLoginUrl();
    return false;
}

function isAuthenticated() {
    return _sessionValida;
}

function isAdmin() {
    return _sessionValida;
}

function logout() {
    _sessionToken = null;
    _sessionValida = false;
    window.location.href = getLoginUrl();
}

async function runAuthCheck() {
    var path = window.location.pathname;
    var inAdmin = path.startsWith('admin/') || path.includes('/admin/');
    if (inAdmin) {
        var isPublicPage = path.includes('login.html') || path.includes('aprovar.html');
        if (!isPublicPage) {
            await checkAuth(true);
        }
    }
}

document.addEventListener('DOMContentLoaded', runAuthCheck);
window.addEventListener('hashchange', runAuthCheck);

window.logout = logout;
window.isAuthenticated = isAuthenticated;
window.isAdmin = isAdmin;

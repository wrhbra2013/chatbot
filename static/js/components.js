function getBasePath() {
    const path = window.location.pathname;
    if (path === '/' || path.endsWith('/index.html') || path === '/index.html') {
        return './';
    }
    const pathWithoutFile = path.replace(/\/[^/]*$/, '');
    const depth = pathWithoutFile.split('/').filter(p => p).length;
    if (depth === 0) return './';
    if (path.includes('/admin/')) {
        return '../';
    }
    if (path.includes('/paginas/')) {
        return '../';
    }
    return './';
}

function getAdminPath() {
    const path = window.location.pathname;
    if (path.includes('/paginas/')) {
        return '../admin/';
    }
    if (path.includes('/admin/')) {
        return './';
    }
    return 'admin/';
}

function getStaticPath() {
    return getBasePath() + 'static/';
}

function initComponents() {
    const basePath = getBasePath();
    const adminPath = getAdminPath();

    const headerHTML = `<header class="header">
    <div class="header-container">
        <a href="${basePath}index.html" class="header-title">
            <span class="site-title">Loja Online</span>
        </a>
        <input type="checkbox" id="menu-toggle" class="menu-checkbox">
        <label for="menu-toggle" class="sandwich-button" aria-label="Abrir menu">
            <span></span>
            <span></span>
            <span></span>
        </label>
    </div>
    <nav id="main-navigation" class="main-nav">
        <ul class="menu">
            <li class="nav-item"><a class="nav-link" href="${basePath}index.html">Início</a></li>
            <li class="nav-item"><a class="nav-link" href="${basePath}paginas/produtos.html">Produtos</a></li>
            <li class="nav-item"><a class="nav-link" href="${basePath}paginas/carrinho.html">Carrinho</a></li>
            <li class="nav-item"><a class="nav-link" href="${basePath}paginas/contato.html">Contato</a></li>
            <li class="nav-item"><a class="nav-link" href="${adminPath}index.html">Admin</a></li>
        </ul>
    </nav>
</header>
<div class="mobile-overlay" id="mobile-overlay"></div>`;

    const headerAdminHTML = `<header class="header">
    <div class="header-container">
        <a href="${adminPath}index.html" class="header-title">
            <span class="site-title">Admin - Loja Online</span>
        </a>
        <input type="checkbox" id="menu-toggle" class="menu-checkbox">
        <label for="menu-toggle" class="sandwich-button" aria-label="Abrir menu">
            <span></span>
            <span></span>
            <span></span>
        </label>
    </div>
    <nav id="main-navigation" class="main-nav">
        <ul class="menu">
            <li class="nav-item"><a class="nav-link" href="${adminPath}index.html">Dashboard</a></li>
            <li class="nav-item"><a class="nav-link" href="${adminPath}produtos.html">Produtos</a></li>
            <li class="nav-item"><a class="nav-link" href="${adminPath}pedidos.html">Pedidos</a></li>
            <li class="nav-item"><a class="nav-link" href="${basePath}index.html">Ver Loja</a></li>
            <li class="nav-item"><a class="nav-link" href="javascript:logout()" style="color:#ff6b6b;">Sair</a></li>
        </ul>
    </nav>
</header>
<div class="mobile-overlay" id="mobile-overlay"></div>`;

    const footerHTML = `<footer class="footer">
    <p>&copy; 2026 Loja Online. Todos os direitos reservados.</p>
</footer>`;

    var currentRoute = window.location.pathname;
    var isAdminPage = currentRoute.includes('/admin/') || currentRoute.startsWith('admin/');

    document.getElementById('header-placeholder').innerHTML = isAdminPage ? headerAdminHTML : headerHTML;
    document.getElementById('footer-placeholder').innerHTML = footerHTML;

    initMenu();
}

function initMenu() {
    const menuToggle = document.getElementById('menu-toggle');
    const mainNav = document.getElementById('main-navigation');
    const mobileOverlay = document.getElementById('mobile-overlay');

    if (!menuToggle || !mainNav) return;

    function syncMenuState() {
        const isChecked = menuToggle.checked;
        if (isChecked) {
            mainNav.classList.add('is-active');
            if (mobileOverlay) mobileOverlay.classList.add('is-active');
        } else {
            mainNav.classList.remove('is-active');
            if (mobileOverlay) mobileOverlay.classList.remove('is-active');
        }
    }

    menuToggle.addEventListener('change', syncMenuState);

    if (mobileOverlay) {
        mobileOverlay.addEventListener('click', function() {
            menuToggle.checked = false;
            syncMenuState();
        });
    }

    document.querySelectorAll('.nav-link').forEach(function(link) {
        link.addEventListener('click', function() {
            if (window.innerWidth <= 768) {
                menuToggle.checked = false;
                syncMenuState();
            }
        });
    });
}

document.addEventListener('DOMContentLoaded', initComponents);

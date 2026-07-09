function getBasePath() {
    const path = window.location.pathname;
    if (path === '/' || path.endsWith('/index.html') || path === '/index.html') {
        return './';
    }
    const pathWithoutFile = path.replace(/\/[^/]*$/, '');
    const depth = pathWithoutFile.split('/').filter(p => p).length;
    if (depth === 0) return './';
    if (path.includes('/paginas/')) {
        return '../';
    }
    return './';
}

function getStaticPath() {
    return getBasePath() + 'static/';
}

function initComponents() {
    const basePath = getBasePath();

    const headerHTML = `<header class="header">
    <div class="header-container">
        <a href="${basePath}index.html" class="header-title">
            <span class="site-title">Catálogo WhatsApp</span>
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
        </ul>
    </nav>
</header>
<div class="mobile-overlay" id="mobile-overlay"></div>`;

    const footerHTML = `<footer class="footer">
    <p>&copy; 2026 Catálogo WhatsApp. Todos os direitos reservados.</p>
</footer>`;

    document.getElementById('header-placeholder').innerHTML = headerHTML;
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

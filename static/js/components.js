function initComponents() {
    var headerHTML = '<header class="header"><div class="header-container"><a href="index.html" class="header-title"><span class="site-title">Chatbot WhatsApp</span></a><input type="checkbox" id="menu-toggle" class="menu-checkbox"><label for="menu-toggle" class="sandwich-button" aria-label="Abrir menu"><span></span><span></span><span></span></label></div><nav id="main-navigation" class="main-nav"><ul class="menu"><li class="nav-item"><a class="nav-link" href="index.html">Inicio</a></li></ul></nav></header><div class="mobile-overlay" id="mobile-overlay"></div>';
    var footerHTML = '<footer class="footer"><p>&copy; 2026 Chatbot WhatsApp. Todos os direitos reservados.</p></footer>';

    document.getElementById('header-placeholder').innerHTML = headerHTML;
    document.getElementById('footer-placeholder').innerHTML = footerHTML;

    var menuToggle = document.getElementById('menu-toggle');
    var mainNav = document.getElementById('main-navigation');
    var mobileOverlay = document.getElementById('mobile-overlay');

    if (!menuToggle || !mainNav) return;

    function syncMenuState() {
        var isChecked = menuToggle.checked;
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
        mobileOverlay.addEventListener('click', function () {
            menuToggle.checked = false;
            syncMenuState();
        });
    }

    document.querySelectorAll('.nav-link').forEach(function (link) {
        link.addEventListener('click', function () {
            if (window.innerWidth <= 768) {
                menuToggle.checked = false;
                syncMenuState();
            }
        });
    });
}

document.addEventListener('DOMContentLoaded', initComponents);

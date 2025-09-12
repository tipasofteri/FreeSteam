/**
 * Мобильные улучшения для FreeSteam
 * Включает pull-to-refresh, улучшенные touch-взаимодействия, 
 * адаптивную навигацию и другие оптимизации
 */

class FreeSteamMobile {
    constructor() {
        this.isMobile = this.detectMobile();
        this.touchStartY = 0;
        this.touchStartX = 0;
        this.isPullToRefresh = false;
        this.isRefreshing = false;
        this.currentPage = 1;
        this.isInfiniteScrollEnabled = true;
        this.isLoading = false;
        
        this.init();
    }
    
    /**
     * Определение мобильного устройства
     */
    detectMobile() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
               window.innerWidth <= 768;
    }
    
    /**
     * Инициализация мобильных функций
     */
    init() {
        if (this.isMobile) {
            console.log('[Mobile] Initializing mobile enhancements...');
            
            this.setupPullToRefresh();
            this.setupInfiniteScroll();
            this.setupTouchGestures();
            this.setupMobileNavigation();
            this.setupViewportHandler();
            this.addMobileStyles();
            this.optimizeImages();
            
            console.log('[Mobile] Mobile enhancements initialized');
        }
    }
    
    /**
     * Настройка Pull-to-Refresh
     */
    setupPullToRefresh() {
        const container = document.querySelector('.container') || document.body;
        
        // Создаем индикатор обновления
        const refreshIndicator = document.createElement('div');
        refreshIndicator.className = 'pull-refresh-indicator';
        refreshIndicator.innerHTML = `
            <div class="refresh-spinner">
                <i class="fas fa-sync-alt"></i>
            </div>
            <div class="refresh-text">Потяните для обновления</div>
        `;
        
        container.prepend(refreshIndicator);
        
        let startY = 0;
        let currentY = 0;
        let isDragging = false;
        
        container.addEventListener('touchstart', (e) => {
            if (window.scrollY === 0) {
                startY = e.touches[0].clientY;
                isDragging = true;
                refreshIndicator.style.display = 'flex';
            }
        }, { passive: true });
        
        container.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            
            currentY = e.touches[0].clientY;
            const deltaY = currentY - startY;
            
            if (deltaY > 0 && window.scrollY === 0) {
                e.preventDefault();
                
                const pullDistance = Math.min(deltaY, 80);
                const progress = pullDistance / 80;
                
                refreshIndicator.style.transform = `translateY(${pullDistance}px)`;
                refreshIndicator.style.opacity = progress;
                
                const spinner = refreshIndicator.querySelector('.refresh-spinner i');
                spinner.style.transform = `rotate(${progress * 360}deg)`;
                
                if (pullDistance >= 60) {
                    refreshIndicator.querySelector('.refresh-text').textContent = 'Отпустите для обновления';
                    refreshIndicator.classList.add('ready');
                    this.isPullToRefresh = true;
                } else {
                    refreshIndicator.querySelector('.refresh-text').textContent = 'Потяните для обновления';
                    refreshIndicator.classList.remove('ready');
                    this.isPullToRefresh = false;
                }
            }
        }, { passive: false });
        
        container.addEventListener('touchend', async () => {
            if (!isDragging) return;
            
            isDragging = false;
            
            if (this.isPullToRefresh && !this.isRefreshing) {
                await this.performRefresh();
            } else {
                this.hidePullRefreshIndicator();
            }
        });
    }
    
    /**
     * Выполнение обновления
     */
    async performRefresh() {
        this.isRefreshing = true;
        const indicator = document.querySelector('.pull-refresh-indicator');
        
        indicator.classList.add('refreshing');
        indicator.querySelector('.refresh-text').textContent = 'Обновление...';
        
        try {
            // Здесь можно добавить логику обновления данных
            if (typeof window.loadGames === 'function') {
                await window.loadGames();
            } else if (typeof window.location.reload === 'function') {
                await new Promise(resolve => setTimeout(resolve, 1000));
                window.location.reload();
            }
            
            this.showToast('✅ Данные обновлены!');
            
        } catch (error) {
            console.error('[Mobile] Refresh failed:', error);
            this.showToast('❌ Ошибка при обновлении');
        }
        
        setTimeout(() => {
            this.hidePullRefreshIndicator();
            this.isRefreshing = false;
        }, 1000);
    }
    
    /**
     * Скрытие индикатора обновления
     */
    hidePullRefreshIndicator() {
        const indicator = document.querySelector('.pull-refresh-indicator');
        if (indicator) {
            indicator.style.transform = 'translateY(-100px)';
            indicator.style.opacity = '0';
            indicator.classList.remove('ready', 'refreshing');
            
            setTimeout(() => {
                indicator.style.display = 'none';
                indicator.style.transform = '';
                indicator.style.opacity = '';
            }, 300);
        }
        this.isPullToRefresh = false;
    }
    
    /**
     * Настройка бесконечной прокрутки
     */
    setupInfiniteScroll() {
        if (!this.isInfiniteScrollEnabled) return;
        
        const loadingIndicator = document.createElement('div');
        loadingIndicator.className = 'infinite-scroll-loader';
        loadingIndicator.innerHTML = `
            <div class="loader-content">
                <div class="spinner"></div>
                <div class="loader-text">Загрузка...</div>
            </div>
        `;
        loadingIndicator.style.display = 'none';
        
        const gamesList = document.querySelector('.game-list') || document.querySelector('#gamesContainer');
        if (gamesList) {
            gamesList.parentNode.appendChild(loadingIndicator);
        }
        
        let throttleTimeout = null;
        
        window.addEventListener('scroll', () => {
            if (throttleTimeout) return;
            
            throttleTimeout = setTimeout(() => {
                this.checkInfiniteScroll();
                throttleTimeout = null;
            }, 200);
        }, { passive: true });
    }
    
    /**
     * Проверка необходимости загрузки следующей страницы
     */
    checkInfiniteScroll() {
        if (this.isLoading || !this.isInfiniteScrollEnabled) return;
        
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const windowHeight = window.innerHeight;
        const documentHeight = document.documentElement.scrollHeight;
        
        // Загружаем, когда до конца страницы остается 200px
        if (scrollTop + windowHeight >= documentHeight - 200) {
            this.loadNextPage();
        }
    }
    
    /**
     * Загрузка следующей страницы
     */
    async loadNextPage() {
        if (this.isLoading) return;
        
        this.isLoading = true;
        const loader = document.querySelector('.infinite-scroll-loader');
        
        if (loader) {
            loader.style.display = 'flex';
        }
        
        try {
            // Имитация загрузки данных
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            // Здесь должна быть логика загрузки новых игр
            console.log('[Mobile] Loading page', this.currentPage + 1);
            
            this.currentPage++;
            this.showToast(`📄 Страница ${this.currentPage} загружена`);
            
        } catch (error) {
            console.error('[Mobile] Error loading next page:', error);
            this.showToast('❌ Ошибка загрузки');
        } finally {
            this.isLoading = false;
            if (loader) {
                loader.style.display = 'none';
            }
        }
    }
    
    /**
     * Настройка жестов касания
     */
    setupTouchGestures() {
        let touchStartTime = 0;
        let touchEndTime = 0;
        
        document.addEventListener('touchstart', (e) => {
            touchStartTime = Date.now();
            this.touchStartY = e.touches[0].clientY;
            this.touchStartX = e.touches[0].clientX;
        }, { passive: true });
        
        document.addEventListener('touchend', (e) => {
            touchEndTime = Date.now();
            const touchEndY = e.changedTouches[0].clientY;
            const touchEndX = e.changedTouches[0].clientX;
            
            const deltaY = touchEndY - this.touchStartY;
            const deltaX = touchEndX - this.touchStartX;
            const duration = touchEndTime - touchStartTime;
            
            // Свайп влево/вправо для навигации
            if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) && duration < 300) {
                if (deltaX > 0) {
                    this.handleSwipeRight();
                } else {
                    this.handleSwipeLeft();
                }
            }
            
            // Двойное касание для возврата наверх
            if (duration < 300 && Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10) {
                this.handleTap(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
            }
        }, { passive: true });
    }
    
    /**
     * Обработка свайпа вправо
     */
    handleSwipeRight() {
        // Открываем боковое меню если оно есть
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) {
            sidebar.classList.add('open');
            this.showOverlay();
        }
    }
    
    /**
     * Обработка свайпа влево
     */
    handleSwipeLeft() {
        // Закрываем боковое меню
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) {
            sidebar.classList.remove('open');
            this.hideOverlay();
        }
    }
    
    /**
     * Обработка касания
     */
    handleTap(x, y) {
        // Двойное касание в верхней части экрана - прокрутка наверх
        if (y < 100) {
            this.scrollToTop();
        }
    }
    
    /**
     * Плавная прокрутка наверх
     */
    scrollToTop() {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
        
        this.showToast('⬆️ Прокручено наверх');
    }
    
    /**
     * Настройка мобильной навигации
     */
    setupMobileNavigation() {
        // Добавляем кнопку "Назад" если её нет
        this.addBackButton();
        
        // Улучшаем существующую мобильную кнопку меню
        this.enhanceMobileMenuButton();
        
        // Добавляем быстрые действия
        this.addQuickActions();
    }
    
    /**
     * Добавление кнопки "Назад"
     */
    addBackButton() {
        if (document.referrer && !document.querySelector('.mobile-back-button')) {
            const backButton = document.createElement('button');
            backButton.className = 'mobile-back-button';
            backButton.innerHTML = '<i class="fas fa-chevron-left"></i>';
            backButton.onclick = () => window.history.back();
            
            document.body.appendChild(backButton);
        }
    }
    
    /**
     * Улучшение кнопки мобильного меню
     */
    enhanceMobileMenuButton() {
        const menuButton = document.querySelector('.mobile-menu-btn');
        if (menuButton) {
            // Добавляем haptic feedback
            menuButton.addEventListener('click', () => {
                this.hapticFeedback();
            });
            
            // Добавляем анимацию
            menuButton.addEventListener('touchstart', () => {
                menuButton.style.transform = 'scale(0.95)';
            });
            
            menuButton.addEventListener('touchend', () => {
                menuButton.style.transform = 'scale(1)';
            });
        }
    }
    
    /**
     * Добавление быстрых действий
     */
    addQuickActions() {
        const quickActions = document.createElement('div');
        quickActions.className = 'mobile-quick-actions';
        quickActions.innerHTML = `
            <button class="quick-action" data-action="refresh" title="Обновить">
                <i class="fas fa-sync-alt"></i>
            </button>
            <button class="quick-action" data-action="top" title="Наверх">
                <i class="fas fa-arrow-up"></i>
            </button>
            <button class="quick-action" data-action="settings" title="Настройки">
                <i class="fas fa-cog"></i>
            </button>
        `;
        
        document.body.appendChild(quickActions);
        
        // Обработчики для быстрых действий
        quickActions.addEventListener('click', (e) => {
            const button = e.target.closest('.quick-action');
            if (!button) return;
            
            const action = button.dataset.action;
            this.hapticFeedback();
            
            switch (action) {
                case 'refresh':
                    this.performRefresh();
                    break;
                case 'top':
                    this.scrollToTop();
                    break;
                case 'settings':
                    this.openSettings();
                    break;
            }
        });
    }
    
    /**
     * Обработка изменения viewport
     */
    setupViewportHandler() {
        let resizeTimeout;
        
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                this.handleViewportChange();
            }, 250);
        });
        
        // Обработка изменения ориентации
        window.addEventListener('orientationchange', () => {
            setTimeout(() => {
                this.handleOrientationChange();
            }, 500);
        });
    }
    
    /**
     * Обработка изменения viewport
     */
    handleViewportChange() {
        // Пересчитываем размеры элементов
        const gameCards = document.querySelectorAll('.game-card');
        gameCards.forEach((card, index) => {
            card.style.setProperty('--index', index);
        });
        
        // Обновляем определение мобильного устройства
        this.isMobile = this.detectMobile();
    }
    
    /**
     * Обработка смены ориентации
     */
    handleOrientationChange() {
        this.showToast('📱 Ориентация изменена');
        
        // Принудительно пересчитываем высоту
        document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
    }
    
    /**
     * Показ overlay
     */
    showOverlay() {
        let overlay = document.querySelector('.sidebar-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'sidebar-overlay';
            document.body.appendChild(overlay);
        }
        
        overlay.classList.add('show');
        
        overlay.onclick = () => {
            this.hideOverlay();
            const sidebar = document.querySelector('.sidebar');
            if (sidebar) {
                sidebar.classList.remove('open');
            }
        };
    }
    
    /**
     * Скрытие overlay
     */
    hideOverlay() {
        const overlay = document.querySelector('.sidebar-overlay');
        if (overlay) {
            overlay.classList.remove('show');
        }
    }
    
    /**
     * Haptic feedback для поддерживающих устройств
     */
    hapticFeedback() {
        if ('vibrate' in navigator) {
            navigator.vibrate(10);
        }
    }
    
    /**
     * Показ toast уведомления
     */
    showToast(message, duration = 2000) {
        // Удаляем существующий toast
        const existingToast = document.querySelector('.mobile-toast');
        if (existingToast) {
            existingToast.remove();
        }
        
        const toast = document.createElement('div');
        toast.className = 'mobile-toast';
        toast.textContent = message;
        
        document.body.appendChild(toast);
        
        // Показываем с анимацией
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });
        
        // Скрываем через указанное время
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.remove();
                }
            }, 300);
        }, duration);
    }
    
    /**
     * Открытие настроек
     */
    openSettings() {
        // Здесь можно добавить логику открытия модала настроек
        this.showToast('⚙️ Настройки (в разработке)');
    }
    
    /**
     * Оптимизация изображений для мобильных устройств
     */
    optimizeImages() {
        const images = document.querySelectorAll('img');
        
        images.forEach(img => {
            // Добавляем lazy loading если его нет
            if (!img.hasAttribute('loading')) {
                img.setAttribute('loading', 'lazy');
            }
            
            // Добавляем обработчик ошибок
            img.addEventListener('error', () => {
                img.src = '/steamfreeico.png';
            });
        });
    }
    
    /**
     * Добавление мобильных стилей
     */
    addMobileStyles() {
        if (document.getElementById('mobile-enhancement-styles')) return;
        
        const styles = document.createElement('style');
        styles.id = 'mobile-enhancement-styles';
        styles.textContent = `
            /* Pull to Refresh */
            .pull-refresh-indicator {
                position: fixed;
                top: -80px;
                left: 50%;
                transform: translateX(-50%);
                display: none;
                flex-direction: column;
                align-items: center;
                gap: 8px;
                padding: 16px;
                background: linear-gradient(135deg, #1e2332 0%, #252b3d 100%);
                border-radius: 12px;
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
                border: 1px solid rgba(0, 212, 170, 0.3);
                z-index: 1000;
                transition: all 0.3s ease;
                min-width: 200px;
            }
            
            .pull-refresh-indicator.ready {
                border-color: rgba(0, 212, 170, 0.6);
            }
            
            .pull-refresh-indicator.refreshing .refresh-spinner i {
                animation: spin 1s linear infinite;
            }
            
            .refresh-spinner {
                width: 32px;
                height: 32px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 50%;
                background: rgba(0, 212, 170, 0.1);
            }
            
            .refresh-spinner i {
                color: #00d4aa;
                font-size: 18px;
                transition: transform 0.3s ease;
            }
            
            .refresh-text {
                color: #b8c5d6;
                font-size: 14px;
                text-align: center;
            }
            
            /* Infinite Scroll Loader */
            .infinite-scroll-loader {
                display: flex;
                justify-content: center;
                padding: 2rem;
                background: transparent;
            }
            
            .infinite-scroll-loader .loader-content {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 12px;
            }
            
            .infinite-scroll-loader .spinner {
                width: 40px;
                height: 40px;
                border: 3px solid rgba(0, 212, 170, 0.2);
                border-top: 3px solid #00d4aa;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            }
            
            .infinite-scroll-loader .loader-text {
                color: #b8c5d6;
                font-size: 14px;
            }
            
            /* Mobile Quick Actions */
            .mobile-quick-actions {
                position: fixed;
                bottom: 20px;
                right: 20px;
                display: flex;
                flex-direction: column;
                gap: 12px;
                z-index: 1000;
            }
            
            .quick-action {
                width: 48px;
                height: 48px;
                border-radius: 50%;
                background: linear-gradient(135deg, #00d4aa 0%, #00b896 100%);
                border: none;
                color: white;
                font-size: 18px;
                cursor: pointer;
                box-shadow: 0 4px 16px rgba(0, 212, 170, 0.3);
                transition: all 0.3s ease;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .quick-action:hover, .quick-action:active {
                transform: translateY(-2px) scale(1.05);
                box-shadow: 0 6px 20px rgba(0, 212, 170, 0.4);
            }
            
            /* Mobile Back Button */
            .mobile-back-button {
                position: fixed;
                top: 20px;
                left: 20px;
                width: 40px;
                height: 40px;
                border-radius: 50%;
                background: rgba(0, 0, 0, 0.7);
                backdrop-filter: blur(10px);
                border: 1px solid rgba(255, 255, 255, 0.1);
                color: white;
                font-size: 16px;
                cursor: pointer;
                z-index: 1001;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.3s ease;
            }
            
            .mobile-back-button:hover {
                background: rgba(0, 0, 0, 0.9);
                transform: scale(1.05);
            }
            
            /* Mobile Toast */
            .mobile-toast {
                position: fixed;
                bottom: 100px;
                left: 50%;
                transform: translateX(-50%) translateY(100px);
                background: linear-gradient(135deg, #1e2332 0%, #252b3d 100%);
                color: white;
                padding: 12px 24px;
                border-radius: 24px;
                border: 1px solid rgba(0, 212, 170, 0.3);
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
                z-index: 10000;
                font-size: 14px;
                white-space: nowrap;
                opacity: 0;
                transition: all 0.3s ease;
                pointer-events: none;
            }
            
            .mobile-toast.show {
                opacity: 1;
                transform: translateX(-50%) translateY(0);
            }
            
            /* Улучшенная анимация спиннера */
            @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
            
            /* Скрытие быстрых действий на больших экранах */
            @media (min-width: 769px) {
                .mobile-quick-actions,
                .mobile-back-button {
                    display: none;
                }
            }
            
            /* Улучшения для игровых карточек на мобильных */
            @media (max-width: 768px) {
                .game-card {
                    transform: translateZ(0);
                    will-change: transform;
                }
                
                .game-card:active {
                    transform: scale(0.98);
                }
                
                /* Увеличиваем область касания для кнопок */
                .btn, .page-link, button {
                    min-height: 44px;
                    min-width: 44px;
                }
                
                /* Убираем hover эффекты на touch устройствах */
                @media (hover: none) {
                    .game-card:hover,
                    .btn:hover,
                    .page-link:hover {
                        transform: none;
                    }
                }
            }
        `;
        
        document.head.appendChild(styles);
    }
}

// Инициализация мобильных улучшений
document.addEventListener('DOMContentLoaded', () => {
    window.FreeSteamMobile = new FreeSteamMobile();
});

// Экспорт для использования в других модулях
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FreeSteamMobile;
}

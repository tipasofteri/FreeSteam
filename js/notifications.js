/**
 * Улучшенная система уведомлений FreeSteam
 * Поддерживает Web Push, fallback для старых браузеров, настройки пользователя
 */

class FreeSteamNotifications {
    constructor() {
        this.isSupported = this.checkSupport();
        this.settings = this.getSettings();
        this.registration = null;
        this.subscription = null;
        
        // Инициализация при загрузке страницы
        if (this.isSupported) {
            this.init();
        }
    }
    
    /**
     * Проверка поддержки уведомлений браузером
     */
    checkSupport() {
        return !!(
            'serviceWorker' in navigator &&
            'Notification' in window &&
            'PushManager' in window
        );
    }
    
    /**
     * Инициализация системы уведомлений
     */
    async init() {
        try {
            console.log('[Notifications] Initializing...');
            
            // Регистрируем Service Worker
            this.registration = await navigator.serviceWorker.register('./sw.js', {
                scope: './'
            });
            
            console.log('[Notifications] Service Worker registered');
            
            // Ждем активации
            await navigator.serviceWorker.ready;
            
            // Проверяем текущую подписку
            this.subscription = await this.registration.pushManager.getSubscription();
            
            // Обновляем UI
            this.updateUI();
            
            // Устанавливаем периодическую проверку
            this.schedulePeriodicCheck();
            
        } catch (error) {
            console.error('[Notifications] Initialization failed:', error);
            this.showFallbackNotification('Не удалось инициализировать уведомления');
        }
    }
    
    /**
     * Получение настроек уведомлений
     */
    getSettings() {
        try {
            const stored = localStorage.getItem('fs_notification_settings');
            if (stored) {
                return JSON.parse(stored);
            }
        } catch (error) {
            console.warn('[Notifications] LocalStorage blocked or unavailable:', error.message);
            // Показываем предупреждение пользователю
            this.showFallbackNotification('⚠️ Хранилище браузера недоступно. Настройки уведомлений не сохраняются.', 'warning');
        }
        
        // Настройки по умолчанию
        return {
            enabled: false,
            types: {
                newFreeGames: true,
                priceDrops: false,
                weeklyUpdates: false
            },
            frequency: 'instant', // instant, hourly, daily
            quietHours: {
                enabled: false,
                start: 22,
                end: 8
            },
            maxPerDay: 10,
            sound: true,
            vibrate: true
        };
    }
    
    /**
     * Сохранение настроек
     */
    saveSettings(settings) {
        try {
            this.settings = { ...this.settings, ...settings };
            localStorage.setItem('fs_notification_settings', JSON.stringify(this.settings));
            
            // Отправляем настройки в Service Worker
            if (this.registration && this.registration.active) {
                this.registration.active.postMessage({
                    type: 'UPDATE_NOTIFICATION_SETTINGS',
                    settings: this.settings
                });
            }
            
            console.log('[Notifications] Settings saved:', this.settings);
            return true;
        } catch (error) {
            console.error('[Notifications] Error saving settings:', error);
            return false;
        }
    }
    
    /**
     * Обновление настроек (алиас для saveSettings)
     */
    updateSettings(settings) {
        return this.saveSettings(settings);
    }
    
    /**
     * Запрос разрешения на уведомления
     */
    async requestPermission() {
        if (!this.isSupported) {
            this.showFallbackNotification('Ваш браузер не поддерживает push уведомления');
            return false;
        }
        
        try {
            const permission = await Notification.requestPermission();
            
            if (permission === 'granted') {
                console.log('[Notifications] Permission granted');
                
                // Создаем подписку
                await this.subscribeToPush();
                
                // Включаем уведомления
                this.saveSettings({ enabled: true });
                
                // Показываем тестовое уведомление
                this.showTestNotification();
                
                return true;
            } else if (permission === 'denied') {
                this.showFallbackNotification('Уведомления заблокированы в настройках браузера');
                return false;
            } else {
                this.showFallbackNotification('Разрешение на уведомления не предоставлено');
                return false;
            }
        } catch (error) {
            console.error('[Notifications] Error requesting permission:', error);
            this.showFallbackNotification('Ошибка при запросе разрешения на уведомления');
            return false;
        }
    }
    
    /**
     * Подписка на push уведомления
     */
    async subscribeToPush() {
        try {
            // Здесь должен быть VAPID ключ сервера
            // Для демо используем заглушку
            const applicationServerKey = this.urlBase64ToUint8Array(
                'BNcA5LJGJkPNzUfVT5MxJ1CQe4kFCM5bPdJhGzqRuHZbTlGzJPd7vZuKjF3H2CXr7YjqGzCHGvJ0PjvvY5R1PqM'
            );
            
            this.subscription = await this.registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: applicationServerKey
            });
            
            console.log('[Notifications] Push subscription created:', this.subscription);
            
            // Здесь можно отправить подписку на сервер
            // await this.sendSubscriptionToServer(this.subscription);
            
        } catch (error) {
            console.error('[Notifications] Error subscribing to push:', error);
            throw error;
        }
    }
    
    /**
     * Показ тестового уведомления
     */
    async showTestNotification() {
        try {
            console.log('[Notifications] Showing test notification...');
            console.log('[Notifications] Permission:', Notification.permission);
            console.log('[Notifications] Registration:', !!this.registration);
            console.log('[Notifications] Settings:', this.settings);
            
            // Проверяем разрешение на уведомления
            if (Notification.permission !== 'granted') {
                console.log('[Notifications] Requesting permission first...');
                const permission = await Notification.requestPermission();
                if (permission !== 'granted') {
                    this.showFallbackNotification('Разрешение на уведомления не получено', 'error');
                    return;
                }
            }
            
            const notificationOptions = {
                body: 'Теперь вы будете получать уведомления о новых бесплатных играх',
                icon: './steamfreeico.png',
                badge: './steamfreeico.png',
                tag: 'test-notification',
                requireInteraction: false,
                vibrate: this.settings.vibrate ? [200, 100, 200] : undefined,
                data: {
                    type: 'test',
                    timestamp: Date.now()
                }
            };
            
            if (this.registration && this.registration.active) {
                console.log('[Notifications] Using Service Worker notification');
                await this.registration.showNotification('FreeSteam - Тестовое уведомление', notificationOptions);
                console.log('[Notifications] Service Worker notification sent');
            } else {
                console.log('[Notifications] Using direct browser notification');
                // Fallback для браузеров без Service Worker или когда SW не активен
                const notification = new Notification('FreeSteam - Тестовое уведомление', notificationOptions);
                
                // Автоматически закрываем через 5 секунд
                setTimeout(() => {
                    try {
                        notification.close();
                    } catch (e) {
                        console.log('[Notifications] Could not close notification:', e);
                    }
                }, 5000);
                
                console.log('[Notifications] Direct browser notification sent');
            }
            
            // Показываем успешное fallback уведомление на странице
            this.showFallbackNotification('✅ Тестовое уведомление отправлено!', 'success');
            
        } catch (error) {
            console.error('[Notifications] Error showing test notification:', error);
            this.showFallbackNotification(`Ошибка: ${error.message}`, 'error');
        }
    }
    
    /**
     * Проверка новых игр и отправка уведомлений
     */
    async checkForNewGames() {
        if (!this.settings.enabled) {
            console.log('[Notifications] Notifications disabled');
            return;
        }
        
        if (this.isQuietTime()) {
            console.log('[Notifications] Quiet time - skipping notification');
            return;
        }
        
        try {
            // Запрашиваем проверку через Service Worker
            if (this.registration && this.registration.active) {
                this.registration.active.postMessage({
                    type: 'CHECK_NEW_GAMES'
                });
            }
        } catch (error) {
            console.error('[Notifications] Error checking for new games:', error);
        }
    }
    
    /**
     * Проверка тихого времени
     */
    isQuietTime() {
        if (!this.settings.quietHours.enabled) {
            return false;
        }
        
        const now = new Date();
        const hour = now.getHours();
        
        // Поддерживаем как числовой, так и строковый формат времени
        const parseHour = (timeValue) => {
            if (typeof timeValue === 'number') {
                return timeValue;
            }
            if (typeof timeValue === 'string') {
                const match = timeValue.match(/^(\d{1,2}):(\d{2})$/);
                return match ? parseInt(match[1], 10) : 0;
            }
            return 0;
        };
        
        const start = parseHour(this.settings.quietHours.start);
        const end = parseHour(this.settings.quietHours.end);
        
        if (start <= end) {
            return hour >= start && hour < end;
        } else {
            return hour >= start || hour < end;
        }
    }
    
    /**
     * Запуск периодической проверки
     */
    schedulePeriodicCheck() {
        if (!this.settings.enabled) {
            return;
        }
        
        const intervals = {
            'instant': 5 * 60 * 1000,  // 5 минут
            'hourly': 60 * 60 * 1000,  // 1 час  
            'daily': 24 * 60 * 60 * 1000  // 24 часа
        };
        
        const interval = intervals[this.settings.frequency] || intervals.instant;
        
        setInterval(() => {
            this.checkForNewGames();
        }, interval);
        
        console.log('[Notifications] Periodic check scheduled every', interval / 1000, 'seconds');
    }
    
    /**
     * Fallback уведомление для браузеров без поддержки
     */
    showFallbackNotification(message, type = 'info') {
        // Создаем визуальное уведомление на странице
        const notification = document.createElement('div');
        notification.className = `notification-fallback notification-${type}`;
        notification.innerHTML = `
            <div class="notification-content">
                <i class="fas fa-bell"></i>
                <span>${message}</span>
                <button class="notification-close" onclick="this.parentElement.parentElement.remove()">×</button>
            </div>
        `;
        
        // Добавляем стили если их нет
        if (!document.getElementById('notification-fallback-styles')) {
            const styles = document.createElement('style');
            styles.id = 'notification-fallback-styles';
            styles.textContent = `
                .notification-fallback {
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    max-width: 350px;
                    background: linear-gradient(135deg, #1e2332 0%, #252b3d 100%);
                    color: #ffffff;
                    border-radius: 12px;
                    padding: 16px;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
                    border: 1px solid rgba(0, 212, 170, 0.3);
                    z-index: 10000;
                    animation: slideInRight 0.3s ease;
                }
                
                .notification-fallback.notification-error {
                    border-color: rgba(255, 71, 87, 0.5);
                }
                
                .notification-content {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                
                .notification-content i {
                    color: #00d4aa;
                    font-size: 18px;
                }
                
                .notification-close {
                    background: none;
                    border: none;
                    color: #6b7785;
                    font-size: 20px;
                    cursor: pointer;
                    padding: 0;
                    margin-left: auto;
                    transition: color 0.2s;
                }
                
                .notification-close:hover {
                    color: #ffffff;
                }
                
                @keyframes slideInRight {
                    from {
                        transform: translateX(100%);
                        opacity: 0;
                    }
                    to {
                        transform: translateX(0);
                        opacity: 1;
                    }
                }
            `;
            document.head.appendChild(styles);
        }
        
        document.body.appendChild(notification);
        
        // Автоудаление через 5 секунд
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 5000);
    }
    
    /**
     * Обновление UI элементов
     */
    updateUI() {
        const toggleButtons = document.querySelectorAll('[data-notification-toggle]');
        toggleButtons.forEach(button => {
            if (this.settings.enabled && Notification.permission === 'granted') {
                button.textContent = '🔔 Уведомления включены';
                button.className = button.className.replace('btn-outline-light', 'btn-success');
            } else {
                button.textContent = '🔕 Включить уведомления';
                button.className = button.className.replace('btn-success', 'btn-outline-light');
            }
        });
        
        // Обновляем переключатели в настройках
        const notificationsSwitch = document.getElementById('notificationsSwitch');
        const soundSwitch = document.getElementById('soundSwitch');
        const vibrateSwitch = document.getElementById('vibrateSwitch');
        const quietHoursSwitch = document.getElementById('quietHoursSwitch');
        
        if (notificationsSwitch) {
            notificationsSwitch.checked = this.settings.enabled && Notification.permission === 'granted';
        }
        if (soundSwitch) {
            soundSwitch.checked = this.settings.sound;
        }
        if (vibrateSwitch) {
            vibrateSwitch.checked = this.settings.vibrate;
        }
        if (quietHoursSwitch) {
            quietHoursSwitch.checked = this.settings.quietHours.enabled;
        }
    }
    
    /**
     * Отключение уведомлений
     */
    async disable() {
        try {
            // Отписываемся от push уведомлений
            if (this.subscription) {
                await this.subscription.unsubscribe();
                this.subscription = null;
            }
            
            // Сохраняем настройки
            this.saveSettings({ enabled: false });
            
            // Обновляем UI
            this.updateUI();
            
            this.showFallbackNotification('Уведомления отключены');
            
        } catch (error) {
            console.error('[Notifications] Error disabling notifications:', error);
            this.showFallbackNotification('Ошибка при отключении уведомлений', 'error');
        }
    }
    
    /**
     * Диагностика состояния уведомлений
     */
    getNotificationStatus() {
        const status = {
            isSupported: this.isSupported,
            permission: Notification.permission,
            registration: {
                exists: !!this.registration,
                active: !!(this.registration && this.registration.active),
                scope: this.registration ? this.registration.scope : null,
                state: this.registration && this.registration.active ? this.registration.active.state : null
            },
            subscription: {
                exists: !!this.subscription,
                endpoint: this.subscription ? this.subscription.endpoint : null
            },
            settings: this.settings,
            serviceWorkerSupport: 'serviceWorker' in navigator,
            pushSupport: 'PushManager' in window
        };
        
        console.table(status);
        return status;
    }
    
    /**
     * Вспомогательные функции
     */
    urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding)
            .replace(/-/g, '+')
            .replace(/_/g, '/');
        
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }
}

// Глобальный экземпляр системы уведомлений
window.FreeSteamNotifications = new FreeSteamNotifications();

// Экспорт для использования в других модулях
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FreeSteamNotifications;
}

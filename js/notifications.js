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
        this.usingLocalNotifications = false;
        
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
     * Получение настроек уведомлений
     */
    getSettings() {
        const defaults = {
            enabled: true,
            sound: true,
            vibration: true,
            quietHours: {
                enabled: false,
                start: '22:00',
                end: '08:00'
            },
            categories: {
                newGames: true,
                discounts: true,
                updates: true,
                news: false
            }
        };
        
        try {
            const saved = JSON.parse(localStorage.getItem('notificationSettings'));
            return { ...defaults, ...saved };
        } catch (e) {
            return defaults;
        }
    }
    
    /**
     * Сохранение настроек уведомлений
     */
    saveSettings() {
        try {
            localStorage.setItem('notificationSettings', JSON.stringify(this.settings));
            return true;
        } catch (e) {
            console.error('Failed to save notification settings:', e);
            return false;
        }
    }
    
    /**
     * Подписка на push-уведомления
     */
    async subscribe() {
        try {
            console.log('[Notifications] Subscribing to push notifications...');
            
            // Пробуем получить VAPID ключ, но не падаем, если его нет
            let subscriptionOptions = {
                userVisibleOnly: true
            };
            
            try {
                const response = await fetch('/api/vapid-public-key');
                if (response.ok) {
                    const vapidPublicKey = await response.text();
                    if (vapidPublicKey) {
                        // Конвертируем VAPID public key в Uint8Array
                        const convertedVapidKey = this.urlBase64ToUint8Array(vapidPublicKey);
                        subscriptionOptions.applicationServerKey = convertedVapidKey;
                    }
                }
            } catch (e) {
                console.warn('[Notifications] Could not get VAPID key, using fallback notifications');
            }
            
            // Подписываемся на push-уведомления
            this.subscription = await this.registration.pushManager.subscribe(subscriptionOptions);
            
            console.log('[Notifications] Push subscription successful:', this.subscription);
            
            // Если есть валидная подписка, пробуем отправить её на сервер
            if (this.subscription) {
                try {
                    await this.sendSubscriptionToServer(this.subscription);
                } catch (e) {
                    console.warn('[Notifications] Could not send subscription to server, using fallback notifications');
                }
            }
            
            return this.subscription;
            
        } catch (error) {
            console.error('[Notifications] Failed to subscribe to push notifications, falling back to local notifications:', error);
            // Не бросаем ошибку, используем локальные уведомления как запасной вариант
            return null;
        }
    }
    
    /**
     * Конвертация base64 строки в Uint8Array
     */
    urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding)
            .replace(/\-/g, '+')
            .replace(/_/g, '/');
        
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        
        return outputArray;
    }
    
    /**
     * Отправка подписки на сервер
     */
    async sendSubscriptionToServer(subscription) {
        try {
            const response = await fetch('/api/subscribe', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(subscription)
            });
            
            if (!response.ok) {
                throw new Error('Failed to send subscription to server');
            }
            
            console.log('[Notifications] Subscription sent to server successfully');
            return await response.json();
            
        } catch (error) {
            console.error('[Notifications] Error sending subscription to server:', error);
            throw error;
        }
    }
    
    /**
     * Настройка локальных уведомлений как запасного варианта
     */
    setupLocalNotifications() {
        console.log('[Notifications] Setting up local notifications');
        
        // Указываем, что используем локальные уведомления
        this.usingLocalNotifications = true;
        
        // Настраиваем канал сообщений для общения с Service Worker
        this.messageChannel = new MessageChannel();
        this.messageChannel.port1.onmessage = (event) => {
            console.log('[Notifications] Message from service worker:', event.data);
            if (event.data.type === 'SHOW_LOCAL_NOTIFICATION') {
                this.showLocalNotification(event.data.title, event.data.options);
            }
        };
        
        // Отправляем порт в Service Worker
        if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
                type: 'INIT_LOCAL_NOTIFICATIONS'
            }, [this.messageChannel.port2]);
        }
    }
    
    /**
     * Показать локальное уведомление
     */
    showLocalNotification(title, options) {
        // Проверяем наличие разрешения
        if (Notification.permission !== 'granted') {
            console.warn('[Notifications] Cannot show notification: no permission');
            return;
        }
        
        // Показываем уведомление
        const notification = new Notification(title, options);
        
        // Обрабатываем клик по уведомлению
        notification.onclick = (event) => {
            event.preventDefault();
            window.focus();
            notification.close();
            
            // Обрабатываем клик по уведомлению
            if (options.data && options.data.url) {
                window.location.href = options.data.url;
            }
        };
        
        return notification;
    }
    
    /**
     * Инициализация системы уведомлений
     */
    async init() {
        try {
            console.log('[Notifications] Initializing...');
            
            // Сначала проверяем разрешение на уведомления
            const permission = await Notification.requestPermission();
            console.log('[Notifications] Notification permission:', permission);
            
            if (permission !== 'granted') {
                console.warn('[Notifications] Notification permission not granted');
                return;
            }
            
            // Регистрируем Service Worker
            this.registration = await navigator.serviceWorker.register('./sw.js', {
                scope: './'
            });
            
            console.log('[Notifications] Service Worker registered:', this.registration);
            
            // Ждем, пока Service Worker будет готов
            await navigator.serviceWorker.ready;
            console.log('[Notifications] Service Worker is ready');
            
            // Пробуем настроить push-уведомления
            try {
                // Проверяем текущую подписку
                this.subscription = await this.registration.pushManager.getSubscription();
                console.log('[Notifications] Current subscription:', this.subscription);
                
                // Подписываемся, если еще не подписаны
                if (!this.subscription) {
                    this.subscription = await this.subscribe();
                }
                
                // Если есть валидная подписка, используем push-уведомления
                if (this.subscription) {
                    console.log('[Notifications] Push notifications enabled');
                } else {
                    console.log('[Notifications] Using local notifications as fallback');
                    this.setupLocalNotifications();
                }
            } catch (error) {
                console.error('[Notifications] Error setting up push notifications, falling back to local:', error);
                this.setupLocalNotifications();
            }
            
            // Обновляем UI
            this.updateUI();
            
            // Устанавливаем периодическую проверку
            this.schedulePeriodicCheck();
            
        } catch (error) {
            console.error('[Notifications] Initialization failed:', error);
            // Пробуем использовать локальные уведомления как запасной вариант
            if (Notification.permission === 'granted') {
                this.setupLocalNotifications();
            }
        }
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
                // Переинициализируем, если разрешение получено
                await this.init();
                return true;
            } else {
                console.warn('[Notifications] Notification permission denied');
                return false;
            }
        } catch (error) {
            console.error('[Notifications] Error requesting permission:', error);
            return false;
        }
    }
    
    /**
     * Показать тестовое уведомление
     */
    async showTestNotification() {
        try {
            console.log('[Notifications] Showing test notification...');
            console.log('[Notifications] Permission:', Notification.permission);
            console.log('[Notifications] Registration:', !!this.registration);
            console.log('[Notifications] Subscription:', this.subscription);
            
            if (Notification.permission !== 'granted') {
                const granted = await this.requestPermission();
                if (!granted) return;
            }
            
            const options = {
                body: 'Это тестовое уведомление от FreeSteam',
                icon: './steamfreeico.png',
                badge: './steamfreeico.png',
                tag: 'test-notification',
                requireInteraction: true,
                actions: [
                    {
                        action: 'open',
                        title: 'Открыть',
                        icon: './steamfreeico.png'
                    },
                    {
                        action: 'close',
                        title: 'Закрыть'
                    }
                ],
                data: {
                    url: window.location.href,
                    timestamp: new Date().toISOString()
                }
            };
            
            // Если есть Service Worker и push-уведомления, используем их
            if (this.registration && this.subscription) {
                // Отправляем сообщение в Service Worker для показа уведомления
                await this.registration.showNotification('Тестовое уведомление', options);
            } 
            // Иначе используем локальные уведомления
            else if (this.usingLocalNotifications) {
                this.showLocalNotification('Тестовое уведомление', options);
            }
            // Или показываем fallback-уведомление
            else {
                this.showFallbackNotification('Тестовое уведомление: ' + options.body);
            }
            
            return true;
            
        } catch (error) {
            console.error('[Notifications] Failed to show test notification:', error);
            this.showFallbackNotification('Не удалось показать тестовое уведомление');
            return false;
        }
    }
    
    /**
     * Показать fallback-уведомление (для браузеров без поддержки)
     */
    showFallbackNotification(message) {
        // Показываем простое уведомление в интерфейсе
        const notification = document.createElement('div');
        notification.className = 'fixed bottom-4 right-4 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 rounded shadow-lg';
        notification.role = 'alert';
        
        const closeButton = document.createElement('button');
        closeButton.className = 'absolute top-0 right-0 px-2 py-1 text-yellow-700 hover:text-yellow-900';
        closeButton.innerHTML = '&times;';
        closeButton.onclick = () => notification.remove();
        
        notification.innerHTML = `
            <p class="font-bold">Уведомление</p>
            <p>${message}</p>
        `;
        
        notification.prepend(closeButton);
        document.body.appendChild(notification);
        
        // Автоматически скрываем через 5 секунд
        setTimeout(() => {
            notification.remove();
        }, 5000);
    }
    
    /**
     * Проверить, находится ли текущее время в "тихих часах"
     */
    isQuietTime() {
        if (!this.settings.quietHours.enabled) {
            return false;
        }
        
        // Функция для преобразования времени в минуты
        const parseHour = (timeValue) => {
            if (typeof timeValue === 'number') {
                return timeValue;
            }
            
            if (typeof timeValue === 'string') {
                const [hours, minutes] = timeValue.split(':').map(Number);
                return hours * 60 + (minutes || 0);
            }
            
            return 0;
        };
        
        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        const start = parseHour(this.settings.quietHours.start);
        const end = parseHour(this.settings.quietHours.end);
        
        if (start <= end) {
            return currentMinutes >= start && currentMinutes < end;
        } else {
            return currentMinutes >= start || currentMinutes < end;
        }
    }
    
    /**
     * Запланировать периодическую проверку уведомлений
     */
    schedulePeriodicCheck() {
        // Очищаем предыдущий таймер, если он был
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }
        
        // Проверяем уведомления каждые 5 минут
        this.checkInterval = setInterval(() => {
            this.checkForUpdates();
        }, 5 * 60 * 1000);
        
        // Также проверяем при следующем запуске
        this.checkForUpdates();
    }
    
    /**
     * Проверить наличие обновлений
     */
    async checkForUpdates() {
        if (this.isCheckingForUpdates) return;
        
        try {
            this.isCheckingForUpdates = true;
            
            // Пропускаем проверку в "тихие часы"
            if (this.isQuietTime()) {
                console.log('[Notifications] Skipping update check during quiet hours');
                return;
            }
            
            console.log('[Notifications] Checking for updates...');
            
            // Здесь должна быть логика проверки обновлений
            // Например, запрос к API для проверки новых игр или скидок
            
            // Временная заглушка
            const hasUpdates = Math.random() > 0.5;
            
            if (hasUpdates) {
                console.log('[Notifications] Updates found');
                
                const options = {
                    body: 'Доступны новые бесплатные игры и скидки на Steam!',
                    icon: './steamfreeico.png',
                    badge: './steamfreeico.png',
                    tag: 'updates-available',
                    data: {
                        url: window.location.href,
                        timestamp: new Date().toISOString()
                    }
                };
                
                // Показываем уведомление в зависимости от доступного метода
                if (this.registration) {
                    await this.registration.showNotification('Новые обновления на FreeSteam', options);
                } else if (this.usingLocalNotifications) {
                    this.showLocalNotification('Новые обновления на FreeSteam', options);
                } else {
                    this.showFallbackNotification(options.body);
                }
            } else {
                console.log('[Notifications] No updates found');
            }
            
        } catch (error) {
            console.error('[Notifications] Error checking for updates:', error);
        } finally {
            this.isCheckingForUpdates = false;
        }
    }
    
    /**
     * Обновить UI в соответствии с текущим состоянием
     */
    updateUI() {
        const toggleButtons = document.querySelectorAll('[data-notification-toggle]');
        toggleButtons.forEach(button => {
            if (this.settings.enabled && Notification.permission === 'granted') {
                button.textContent = '🔔 Уведомления включены';
                button.classList.remove('bg-gray-200', 'text-gray-700');
                button.classList.add('bg-green-100', 'text-green-800');
            } else if (Notification.permission === 'denied') {
                button.textContent = '❌ Уведомления отключены';
                button.classList.remove('bg-green-100', 'text-green-800');
                button.classList.add('bg-red-100', 'text-red-800');
            } else {
                button.textContent = '🔕 Нажмите, чтобы включить уведомления';
                button.classList.remove('bg-green-100', 'text-green-800');
                button.classList.add('bg-gray-200', 'text-gray-700');
            }
            
            // Добавляем обработчик клика, если его еще нет
            if (!button.hasAttribute('data-notification-listener')) {
                button.setAttribute('data-notification-listener', 'true');
                button.addEventListener('click', () => this.toggleNotifications());
            }
        });
    }
    
    /**
     * Переключить состояние уведомлений
     */
    async toggleNotifications() {
        if (Notification.permission === 'granted') {
            // Если уведомления уже включены, отключаем их
            this.settings.enabled = !this.settings.enabled;
            this.saveSettings();
            this.updateUI();
            
            if (!this.settings.enabled) {
                // Показываем подтверждение отключения
                this.showFallbackNotification('Уведомления отключены');
            }
        } else if (Notification.permission === 'denied') {
            // Если доступ запрещен, показываем инструкции
            this.showFallbackNotification('Разрешите уведомления в настройках браузера');
        } else {
            // Запрашиваем разрешение
            await this.requestPermission();
        }
    }
    
    /**
     * Очистить все уведомления
     */
    clearNotifications() {
        if (this.registration) {
            this.registration.getNotifications().then(notifications => {
                notifications.forEach(notification => notification.close());
            });
        }
    }
}

// Создаем глобальный экземпляр
if (!window.FreeSteamNotifications) {
    window.FreeSteamNotifications = new FreeSteamNotifications();
}

// Экспортируем для использования в модулях
export default window.FreeSteamNotifications;

const CACHE_VERSION = 'v2.1.0';
const CACHE_NAME = `freesteam-${CACHE_VERSION}`;
const DATA_CACHE_NAME = `freesteam-data-${CACHE_VERSION}`;
const CACHE_DURATION = 1000 * 60 * 30; // 30 минут

// Статические файлы для кэширования (относительные пути)
const STATIC_CACHE_URLS = [
  './',
  './index.html',
  './landing.html',
  './freesteamhub.html',
  './checker.html',
  './free_games.html',
  './steamfreeico.png',
  './loading.gif',
  './loading1.gif',
  './manifest.json',
  // CDN ресурсы
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/noUiSlider/15.7.0/nouislider.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/noUiSlider/15.7.0/nouislider.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/ScrollTrigger.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/tone/14.7.77/Tone.js',
  'https://cdn.jsdelivr.net/npm/lenis@1.0.42/dist/lenis.min.js'
];

// API эндпоинты для кэширования данных
const DATA_CACHE_PATTERNS = [
  /.*free_goods_detail.*\.json$/,
  /.*\/api\/.*$/,
  /.*\/data\/.*\.json$/
];

// Установка Service Worker
self.addEventListener('install', (event) => {
  console.log('[SW] Installing Service Worker...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Pre-caching static resources');
        return cache.addAll(STATIC_CACHE_URLS);
      })
      .then(() => {
        console.log('[SW] Installation complete');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[SW] Installation failed:', error);
      })
  );
});

// Активация Service Worker
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Service Worker...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((cacheName) => {
              // Удаляем старые версии кэша
              return cacheName !== CACHE_NAME && cacheName !== DATA_CACHE_NAME;
            })
            .map((cacheName) => {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            })
        );
      })
      .then(() => {
        console.log('[SW] Activation complete');
        return self.clients.claim();
      })
  );
});

// Обработка fetch запросов
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Кэширование JSON данных игр
  if (DATA_CACHE_PATTERNS.some(pattern => pattern.test(url.pathname))) {
    event.respondWith(
      caches.open(DATA_CACHE_NAME)
        .then((cache) => {
          return cache.match(event.request)
            .then((cachedResponse) => {
              // Стратегия: Cache First, но с обновлением в фоне
              if (cachedResponse) {
                // Возвращаем кэшированную версию
                const fetchPromise = fetch(event.request)
                  .then((networkResponse) => {
                    if (networkResponse.ok) {
                      cache.put(event.request, networkResponse.clone());
                    }
                    return networkResponse;
                  })
                  .catch(() => cachedResponse);
                
                // Не ждем обновления кэша
                fetchPromise.catch(() => {});
                
                return cachedResponse;
              } else {
                // Если нет в кэше, загружаем из сети
                return fetch(event.request)
                  .then((networkResponse) => {
                    if (networkResponse.ok) {
                      cache.put(event.request, networkResponse.clone());
                    }
                    return networkResponse;
                  })
                  .catch(() => {
                    // Возвращаем офлайн страницу для данных
                    return new Response(
                      JSON.stringify({
                        error: 'Offline',
                        message: 'Данные недоступны без подключения к интернету',
                        cached: false,
                        timestamp: new Date().toISOString()
                      }),
                      {
                        status: 503,
                        statusText: 'Service Unavailable',
                        headers: {
                          'Content-Type': 'application/json'
                        }
                      }
                    );
                  });
              }
            });
        })
    );
    return;
  }
  
  // Для статических ресурсов используем Cache First стратегию
  if (event.request.method === 'GET') {
    event.respondWith(
      caches.match(event.request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          
          return fetch(event.request)
            .then((networkResponse) => {
              // Кэшируем только успешные ответы
              if (networkResponse.ok && networkResponse.status === 200) {
                const responseClone = networkResponse.clone();
                
                caches.open(CACHE_NAME)
                  .then((cache) => {
                    cache.put(event.request, responseClone);
                  });
              }
              
              return networkResponse;
            })
            .catch(() => {
              // Офлайн fallback для HTML страниц
              if (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html')) {
                return caches.match('./index.html') || caches.match('./');
              }
              
              // Для остальных ресурсов возвращаем ошибку
              return new Response('Offline', {
                status: 503,
                statusText: 'Service Unavailable'
              });
            });
        })
    );
  }
});

// Background Sync для уведомлений
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync triggered:', event.tag);
  
  if (event.tag === 'check-new-games') {
    event.waitUntil(
      checkForNewGames()
        .then((hasNewGames) => {
          if (hasNewGames) {
            return showNewGamesNotification();
          }
        })
        .catch((error) => {
          console.error('[SW] Background sync failed:', error);
        })
    );
  }
});

// Push уведомления
self.addEventListener('push', (event) => {
  console.log('[SW] Push notification received');
  
  let notificationData = {
    title: 'FreeSteam',
    body: 'Новые бесплатные игры доступны!',
    icon: './steamfreeico.png',
    badge: './steamfreeico.png',
    tag: 'new-games',
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
      url: './'
    }
  };
  
  if (event.data) {
    try {
      const pushData = event.data.json();
      notificationData = { ...notificationData, ...pushData };
    } catch (e) {
      console.error('[SW] Error parsing push data:', e);
    }
  }
  
  event.waitUntil(
    self.registration.showNotification(notificationData.title, notificationData)
  );
});

// Обработка кликов по уведомлениям
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification click received');
  
  event.notification.close();
  
  if (event.action === 'close') {
    return;
  }
  
  const urlToOpen = event.notification.data?.url || '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Проверяем, есть ли уже открытое окно
        for (let client of clientList) {
          if (client.url === urlToOpen && 'focus' in client) {
            return client.focus();
          }
        }
        
        // Если нет открытого окна, открываем новое
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

// Вспомогательные функции
async function checkForNewGames() {
  try {
    console.log('[SW] Checking for new games...');
    
    // Получаем настройки уведомлений
    const settings = await getNotificationSettings();
    if (!settings.enabled) {
      console.log('[SW] Notifications disabled by user');
      return false;
    }
    
    // Загружаем актуальный список игр
    const response = await fetch('https://raw.githubusercontent.com/InJeCTrL/NeedFree/master/free_goods_detail.json');
    if (!response.ok) {
      console.log('[SW] Failed to fetch games list');
      return false;
    }
    
    const data = await response.json();
    if (!data.free_list || data.free_list.length === 0) {
      return false;
    }
    
    // Получаем последний известный список
    const lastKnownGames = await getLastKnownGames();
    const currentGameIds = data.free_list.map(game => extractGameId(game[1]));
    const lastKnownIds = lastKnownGames.map(game => extractGameId(game[1]));
    
    // Находим новые игры
    const newGameIds = currentGameIds.filter(id => !lastKnownIds.includes(id));
    
    if (newGameIds.length > 0) {
      const newGames = data.free_list.filter(game => {
        const gameId = extractGameId(game[1]);
        return newGameIds.includes(gameId);
      });
      
      console.log('[SW] Found new games:', newGames.length);
      
      // Сохраняем обновленный список
      await saveLastKnownGames(data.free_list);
      await saveNewGamesForNotification(newGames);
      
      return true;
    }
    
    console.log('[SW] No new games found');
    return false;
    
  } catch (error) {
    console.error('[SW] Error checking for new games:', error);
    return false;
  }
}

async function showNewGamesNotification() {
  try {
    const newGames = await getNewGamesForNotification();
    if (!newGames || newGames.length === 0) {
      return;
    }
    
    const count = newGames.length;
    const firstGameTitle = newGames[0][0];
    
    const title = count === 1 ? 
      '🎮 Новая бесплатная игра!' : 
      `🎮 ${count} новых бесплатных игр!`;
      
    const body = count === 1 ?
      `${firstGameTitle} теперь доступна бесплатно!` :
      `${firstGameTitle} и еще ${count - 1} игр теперь бесплатны!`;
    
    const notificationOptions = {
      body: body,
      icon: './steamfreeico.png',
      badge: './steamfreeico.png',
      tag: 'new-games-' + Date.now(),
      requireInteraction: true,
      vibrate: [200, 100, 200], // Для мобильных устройств
      actions: [
        {
          action: 'view',
          title: '👀 Посмотреть',
          icon: './steamfreeico.png'
        },
        {
          action: 'later',
          title: '⏰ Позже'
        }
      ],
      data: {
        url: './',
        games: newGames,
        timestamp: Date.now()
      }
    };
    
    return self.registration.showNotification(title, notificationOptions);
    
  } catch (error) {
    console.error('[SW] Error showing notification:', error);
  }
}

// Дополнительные вспомогательные функции
function extractGameId(steamUrl) {
  const match = steamUrl.match(/app\/(\d+)/);
  return match ? match[1] : steamUrl;
}

async function getNotificationSettings() {
  try {
    const cache = await caches.open(DATA_CACHE_NAME);
    const response = await cache.match('/notification-settings');
    if (response) {
      const data = await response.json();
      return data;
    }
  } catch (error) {
    console.error('[SW] Error getting notification settings:', error);
  }
  
  // Настройки по умолчанию
  return {
    enabled: true,
    types: ['all'],
    maxPerDay: 10,
    quietHours: { start: 22, end: 8 },
    vibrate: true,
    sound: true
  };
}

async function getLastKnownGames() {
  try {
    const cache = await caches.open(DATA_CACHE_NAME);
    const response = await cache.match('/last-known-games');
    if (response) {
      const data = await response.json();
      return data.games || [];
    }
  } catch (error) {
    console.error('[SW] Error getting last known games:', error);
  }
  return [];
}

async function saveLastKnownGames(games) {
  try {
    const cache = await caches.open(DATA_CACHE_NAME);
    const data = {
      games: games,
      timestamp: Date.now()
    };
    const response = new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' }
    });
    await cache.put('/last-known-games', response);
  } catch (error) {
    console.error('[SW] Error saving last known games:', error);
  }
}

async function saveNewGamesForNotification(games) {
  try {
    const cache = await caches.open(DATA_CACHE_NAME);
    const data = {
      games: games,
      timestamp: Date.now()
    };
    const response = new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' }
    });
    await cache.put('/new-games-notification', response);
  } catch (error) {
    console.error('[SW] Error saving new games for notification:', error);
  }
}

async function getNewGamesForNotification() {
  try {
    const cache = await caches.open(DATA_CACHE_NAME);
    const response = await cache.match('/new-games-notification');
    if (response) {
      const data = await response.json();
      return data.games || [];
    }
  } catch (error) {
    console.error('[SW] Error getting new games for notification:', error);
  }
  return [];
}

// Обработка сообщений от клиента
self.addEventListener('message', (event) => {
    console.log('[SW] Message received:', event.data);
    
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    
    if (event.data && event.data.type === 'CHECK_NEW_GAMES') {
        event.waitUntil(checkForNewGames().then(hasNewGames => {
            if (hasNewGames) {
                return showNewGamesNotification();
            }
        }));
    }
    
    if (event.data && event.data.type === 'UPDATE_NOTIFICATION_SETTINGS') {
        event.waitUntil(updateNotificationSettings(event.data.settings));
    }
    
    // Новый обработчик для уведомлений о бесплатных играх
    if (event.data && event.data.type === 'SHOW_FREE_GAMES_NOTIFICATION') {
        event.waitUntil(showFreeGamesNotification(event.data.data));
    }
});

// Функция для отображения уведомлений о бесплатных играх
async function showFreeGamesNotification(notificationData) {
  try {
    console.log('[SW] Showing free games notification:', notificationData);
    
    const settings = await getNotificationSettings();
    if (!settings.enabled) {
      console.log('[SW] Notifications disabled by user');
      return;
    }
    
    // Проверяем тихие часы
    if (settings.quietHours && settings.quietHours.enabled) {
      const now = new Date();
      const hour = now.getHours();
      const start = settings.quietHours.start || 22;
      const end = settings.quietHours.end || 8;
      
      let isQuietTime = false;
      if (start <= end) {
        isQuietTime = hour >= start && hour < end;
      } else {
        isQuietTime = hour >= start || hour < end;
      }
      
      if (isQuietTime) {
        console.log('[SW] Quiet time - skipping notification');
        return;
      }
    }
    
    // Подготавливаем данные уведомления
    const notificationOptions = {
      body: notificationData.body || 'Новые бесплатные игры доступны!',
      icon: notificationData.icon || './steamfreeico.png',
      badge: notificationData.badge || './steamfreeico.png',
      tag: notificationData.tag || 'free-games-' + Date.now(),
      requireInteraction: notificationData.requireInteraction || true,
      data: notificationData.data || { url: './free_games.html' }
    };
    
    // Добавляем вибрацию если разрешено
    if (settings.vibrate && notificationData.vibrate) {
      notificationOptions.vibrate = notificationData.vibrate;
    }
    
    // Добавляем действия если есть
    if (notificationData.actions) {
      notificationOptions.actions = notificationData.actions;
    }
    
    const title = notificationData.title || 'FreeSteam - Бесплатные игры!';
    
    return self.registration.showNotification(title, notificationOptions);
    
  } catch (error) {
    console.error('[SW] Error showing free games notification:', error);
  }
}

async function updateNotificationSettings(settings) {
  try {
    const cache = await caches.open(DATA_CACHE_NAME);
    const response = new Response(JSON.stringify(settings), {
      headers: { 'Content-Type': 'application/json' }
    });
    await cache.put('/notification-settings', response);
    console.log('[SW] Notification settings updated');
  } catch (error) {
    console.error('[SW] Error updating notification settings:', error);
  }
}

// Обработка ошибок
self.addEventListener('error', (event) => {
  console.error('[SW] Service Worker error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('[SW] Unhandled promise rejection:', event.reason);
});

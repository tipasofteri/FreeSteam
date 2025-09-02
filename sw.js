const CACHE_VERSION = 'v1.2.0';
const CACHE_NAME = `freesteam-${CACHE_VERSION}`;
const DATA_CACHE_NAME = `freesteam-data-${CACHE_VERSION}`;

// Статические файлы для кэширования
const STATIC_CACHE_URLS = [
  '/',
  '/index.html',
  '/checker.html',
  '/landing.html',
  '/steamfreeico.png',
  '/loading.gif',
  '/loading1.gif',
  '/manifest.json',
  // CDN ресурсы
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/noUiSlider/15.7.0/nouislider.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/noUiSlider/15.7.0/nouislider.min.js'
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
              if (event.request.headers.get('accept').includes('text/html')) {
                return caches.match('/index.html');
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
    icon: '/steamfreeico.png',
    badge: '/steamfreeico.png',
    tag: 'new-games',
    requireInteraction: true,
    actions: [
      {
        action: 'open',
        title: 'Открыть',
        icon: '/steamfreeico.png'
      },
      {
        action: 'close',
        title: 'Закрыть'
      }
    ],
    data: {
      url: '/'
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
    const response = await fetch('/api/health');
    if (response.ok) {
      // Здесь можно добавить логику проверки новых игр
      return Math.random() > 0.8; // Заглушка
    }
    return false;
  } catch (error) {
    console.error('[SW] Error checking for new games:', error);
    return false;
  }
}

async function showNewGamesNotification() {
  const notificationOptions = {
    body: 'Найдены новые бесплатные игры в Steam!',
    icon: '/steamfreeico.png',
    badge: '/steamfreeico.png',
    tag: 'new-games-auto',
    requireInteraction: false,
    actions: [
      {
        action: 'view',
        title: 'Посмотреть',
        icon: '/steamfreeico.png'
      }
    ],
    data: {
      url: '/'
    }
  };
  
  return self.registration.showNotification('FreeSteam - Новые игры!', notificationOptions);
}

// Обработка ошибок
self.addEventListener('error', (event) => {
  console.error('[SW] Service Worker error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('[SW] Unhandled promise rejection:', event.reason);
});

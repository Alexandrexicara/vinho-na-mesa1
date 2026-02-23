// Service Worker básico para Vinho na Mesa
const CACHE_NAME = 'vinho-na-mesa-v1';
const urlsToCache = [
  '/',
  '/viewer.html',
  '/viewer1.html',
  '/artist.html',
  '/admin.html',
  '/login.html',
  '/manifest.json',
  '/img/logo_vinhonamesa.png'
];

// Instalar o Service Worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache aberto');
        return cache.addAll(urlsToCache);
      })
  );
});

// Intercepta requisições e serve do cache quando possível
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Retorna do cache se encontrado, senão faz a requisição normal
        return response || fetch(event.request);
      })
  );
});

// Atualiza o Service Worker e remove caches antigos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
const CACHE_NAME = "sdc-v27";
const SHELL = ["./", "index.html", "styles.css?v=27", "app.js?v=27", "manifest.json", "cards.json", "diagrams.json", "quizzes.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  e.respondWith(
    fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(e.request, c)); return r; })
      .catch(() => caches.match(e.request))
  );
});

// Background notification support for PWA
const BG_MESSAGES = [
  "Your brain cells are filing a missing person report 😱",
  "1 card a day keeps the rejection away 💪",
  "Your interview prep called. It misses you 📞",
  "CAP theorem says you can't have it all. But you CAN study today 🤓",
  "BREAKING: Local developer discovers studying actually works 📰",
  "Future you will thank present you. Go study 🙏",
  "Even Netflix takes a break. Your brain doesn't have to 🧠",
  "Your load balancer can't balance your study schedule for you ⚖️"
];

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SHOW_NOTIFICATION") {
    const msg = BG_MESSAGES[Math.floor(Math.random() * BG_MESSAGES.length)];
    self.registration.showNotification("System Design Cards", {
      body: msg,
      icon: "icon-192.png",
      badge: "icon-192.png",
      tag: "sdc-reminder",
      renotify: true
    });
  }
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((cls) => {
      for (const client of cls) {
        if (client.url.includes("index.html") || client.url.endsWith("/")) {
          return client.focus();
        }
      }
      return clients.openWindow("./");
    })
  );
});

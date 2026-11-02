// bloom-gamekit pwa가 생성한 파일입니다. 직접 고치지 말고 생성 스크립트를 다시 실행하세요.
(function serviceWorker(config) {
  const PREFIX = `bloom-pwa:${new URL(self.registration.scope).pathname}:`;
  const RUNTIME = PREFIX + "runtime";
  const GAMEKIT_CACHE = PREFIX + "gamekit";
  const GAMEKIT = new RegExp(config.gamekit);
  self.addEventListener("install", () => {
    self.skipWaiting();
  });
  self.addEventListener("activate", (event) => {
    event.waitUntil(
      Promise.all([
        self.clients.claim(),
        caches.keys().then(
          (keys) => Promise.all(
            keys.filter((key) => key.startsWith(PREFIX) && key !== RUNTIME && key !== GAMEKIT_CACHE).map((key) => caches.delete(key))
          )
        )
      ])
    );
  });
  async function offline(request, error) {
    const STORE = await caches.open(RUNTIME);
    const NAVIGATE = request.mode === "navigate";
    let response = await STORE.match(request, { ignoreSearch: NAVIGATE });
    const ADDRESS = new URL(request.url);
    if (!response && NAVIGATE && ADDRESS.pathname.endsWith("/")) {
      response = await STORE.match(new URL("index.html", ADDRESS).href);
    }
    if (!response) {
      throw error;
    }
    return response;
  }
  async function sameOrigin(event) {
    const REQUEST = event.request;
    let response;
    try {
      response = await fetch(REQUEST, { cache: "no-cache" });
    } catch (error) {
      return offline(REQUEST, error);
    }
    if (response.status === 200) {
      const COPY = response.clone();
      event.waitUntil(caches.open(RUNTIME).then((store) => store.put(REQUEST, COPY)));
    }
    return response;
  }
  async function gamekit(request) {
    const STORE = await caches.open(GAMEKIT_CACHE);
    const CACHED = await STORE.match(request);
    if (CACHED) {
      return CACHED;
    }
    const RESPONSE = await fetch(request);
    if (RESPONSE.ok) {
      await STORE.put(request, RESPONSE.clone());
    }
    return RESPONSE;
  }
  self.addEventListener("fetch", (event) => {
    const REQUEST = event.request;
    if (REQUEST.method !== "GET") {
      return;
    }
    if (new URL(REQUEST.url).origin === self.location.origin) {
      event.respondWith(sameOrigin(event));
    } else if (GAMEKIT.test(REQUEST.url)) {
      event.respondWith(gamekit(REQUEST));
    }
  });
})({
    "gamekit": "^https:\\/\\/cdn\\.jsdelivr\\.net\\/gh\\/byh-playground\\/bloom-gamekit@[0-9a-f]{40}\\/[A-Za-z0-9._/-]+$"
});

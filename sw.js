// bloom-gamekit pwa가 생성한 파일입니다. 직접 고치지 말고 생성 스크립트를 다시 실행하세요.
(function serviceWorker(config) {
  const SCOPE = self.registration.scope;
  const PREFIX = `bloom-pwa:${new URL(SCOPE).pathname}:`;
  const CACHE = PREFIX + config.version;
  const RUNTIME = PREFIX + "gamekit";
  const GAMEKIT = new RegExp(config.gamekit);
  self.addEventListener("install", (event) => {
    event.waitUntil(
      caches.open(CACHE).then(
        (cache) => cache.addAll(
          config.precache.map(
            (url) => GAMEKIT.test(url) ? new Request(url, { mode: "cors" }) : new Request(url, { cache: "reload" })
          )
        )
      )
    );
  });
  self.addEventListener("activate", (event) => {
    event.waitUntil(
      caches.keys().then(
        (keys) => Promise.all(
          keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE && key !== RUNTIME).map((key) => caches.delete(key))
        )
      ).then(() => self.clients.claim())
    );
  });
  self.addEventListener("message", (event) => {
    if (event.data?.type === config.activateMessage) {
      self.skipWaiting();
    }
  });
  async function sameOrigin(request) {
    const STORE = await caches.open(CACHE);
    const NAVIGATE = request.mode === "navigate";
    let response = await STORE.match(request, { ignoreSearch: NAVIGATE });
    const ADDRESS = new URL(request.url);
    if (!response && NAVIGATE && ADDRESS.pathname.endsWith("/")) {
      response = await STORE.match(new URL("index.html", ADDRESS).href);
    }
    return response ?? fetch(request);
  }
  async function gamekit(request) {
    const CACHED = await caches.match(request);
    if (CACHED) {
      return CACHED;
    }
    const RESPONSE = await fetch(request);
    if (RESPONSE.ok) {
      const STORE = await caches.open(RUNTIME);
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
      event.respondWith(sameOrigin(REQUEST));
    } else if (GAMEKIT.test(REQUEST.url)) {
      event.respondWith(gamekit(REQUEST));
    }
  });
})({
    "version": "4006039866850c5a",
    "activateMessage": "bloom-pwa:activate",
    "gamekit": "^https:\\/\\/cdn\\.jsdelivr\\.net\\/gh\\/byh-playground\\/bloom-gamekit@[0-9a-f]{40}\\/[A-Za-z0-9._/-]+$",
    "precache": [
        "assets/audio/head-in-the-sand.ogg",
        "index.html",
        "manifest.webmanifest",
        "pwa/apple-touch-icon.png",
        "pwa/icon-192.png",
        "pwa/icon-512.png",
        "pwa/maskable-512.png",
        "src/club/club.js",
        "src/club/generator.js",
        "src/club/names-ko.js",
        "src/config/game.js",
        "src/config/intro.js",
        "src/config/runtime.js",
        "src/config/schools.js",
        "src/debug-scenes.js",
        "src/learning/core/actor-critic.js",
        "src/learning/core/algorithm.js",
        "src/learning/core/baseline.js",
        "src/learning/core/dqn.js",
        "src/learning/core/exploration.js",
        "src/learning/core/optimizer.js",
        "src/learning/core/policy.js",
        "src/learning/core/quantize.js",
        "src/learning/core/reinforce.js",
        "src/learning/core/replay-buffer.js",
        "src/learning/core/task.js",
        "src/learning/index.js",
        "src/learning/match/match-learning.js",
        "src/learning/takraw/observation.js",
        "src/learning/takraw/receive-task.js",
        "src/learning/takraw/tuning.js",
        "src/learning/teammate.js",
        "src/learning/trainer.js",
        "src/main.js",
        "src/motion/data.js",
        "src/motion/matcher.js",
        "src/motion/model.js",
        "src/presentation/field-effects.js",
        "src/presentation/highlight-shadow.js",
        "src/presentation/highlight-worker.js",
        "src/presentation/highlight.js",
        "src/presentation/impact.js",
        "src/presentation/intro-script.js",
        "src/presentation/intro.js",
        "src/presentation/match-status.js",
        "src/presentation/score-motion.js",
        "src/presentation/sound.js",
        "src/presentation/ui.js",
        "src/presentation/view.js",
        "src/runtime.js",
        "src/simulation/ai-brain.js",
        "src/simulation/ai-formation.js",
        "src/simulation/game.js",
        "src/simulation/identity.js",
        "src/simulation/joint-limits.js",
        "src/simulation/physics.js",
        "src/simulation/timing.js",
        "styles/app.css",
        "https://cdn.jsdelivr.net/gh/byh-playground/bloom-gamekit@2fb6332f54a7dc602c3743f516afed1f9a8b3229/audio.js",
        "https://cdn.jsdelivr.net/gh/byh-playground/bloom-gamekit@2fb6332f54a7dc602c3743f516afed1f9a8b3229/debug-tools.js",
        "https://cdn.jsdelivr.net/gh/byh-playground/bloom-gamekit@2fb6332f54a7dc602c3743f516afed1f9a8b3229/deterministic.js",
        "https://cdn.jsdelivr.net/gh/byh-playground/bloom-gamekit@2fb6332f54a7dc602c3743f516afed1f9a8b3229/input.js",
        "https://cdn.jsdelivr.net/gh/byh-playground/bloom-gamekit@2fb6332f54a7dc602c3743f516afed1f9a8b3229/interpolation.js",
        "https://cdn.jsdelivr.net/gh/byh-playground/bloom-gamekit@2fb6332f54a7dc602c3743f516afed1f9a8b3229/object-pool.js",
        "https://cdn.jsdelivr.net/gh/byh-playground/bloom-gamekit@2fb6332f54a7dc602c3743f516afed1f9a8b3229/presentation-events.js",
        "https://cdn.jsdelivr.net/gh/byh-playground/bloom-gamekit@2fb6332f54a7dc602c3743f516afed1f9a8b3229/pwa.js",
        "https://cdn.jsdelivr.net/gh/byh-playground/bloom-gamekit@2fb6332f54a7dc602c3743f516afed1f9a8b3229/rollback.js",
        "https://cdn.jsdelivr.net/gh/byh-playground/bloom-gamekit@2fb6332f54a7dc602c3743f516afed1f9a8b3229/save.js",
        "https://cdn.jsdelivr.net/gh/byh-playground/bloom-gamekit@2fb6332f54a7dc602c3743f516afed1f9a8b3229/scenario.js",
        "https://cdn.jsdelivr.net/gh/byh-playground/bloom-gamekit@2fb6332f54a7dc602c3743f516afed1f9a8b3229/simloop.js",
        "https://cdn.jsdelivr.net/gh/byh-playground/bloom-gamekit@2fb6332f54a7dc602c3743f516afed1f9a8b3229/transport.js"
    ]
});

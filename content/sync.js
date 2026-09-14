/* ParsLiveDub lipsync: delay VIDEO pixels only.
   Tab audio stays live so Gemini does not recapture a lagged soundtrack. */
(function () {
  if (window.__pldSyncInstalled) return;
  window.__pldSyncInstalled = true;

  const MAX_DELAY_MS = 5000;
  const MIN_DELAY_MS = 800;
  const DEFAULT_DELAY_MS = 2900;

  const state = {
    enabled: false,
    delayMs: DEFAULT_DELAY_MS,
    video: null,
    canvas: null,
    ctx: null,
    hud: null,
    frames: [],
    running: false,
    rvfcHandle: null,
    rafHandle: 0,
    lastCapture: 0,
    captureEveryMs: 42,
    observer: null,
    onSeek: null,
    onFs: null,
  };

  function clampDelay(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n)) return DEFAULT_DELAY_MS;
    return Math.max(MIN_DELAY_MS, Math.min(MAX_DELAY_MS, n));
  }

  function findVideo() {
    const nodes = Array.from(document.querySelectorAll("video"));
    if (!nodes.length) return null;
    const scored = nodes
      .filter((v) => v.readyState >= 1 && v.videoWidth > 16)
      .map((v) => {
        const r = v.getBoundingClientRect();
        const visible = r.width > 40 && r.height > 40 && r.bottom > 0 && r.right > 0;
        const playing = !v.paused && !v.ended && v.readyState >= 2;
        return { v, area: Math.max(0, r.width * r.height), visible, playing };
      })
      .filter((x) => x.visible || x.playing);
    if (!scored.length) return null;
    scored.sort((a, b) => {
      if (a.playing !== b.playing) return a.playing ? -1 : 1;
      return b.area - a.area;
    });
    return scored[0].v;
  }

  function hostFor(video) {
    return (
      video.closest(".html5-video-container") ||
      video.closest(".html5-video-player") ||
      video.closest("#player") ||
      video.closest(".video-stream") ||
      video.parentElement ||
      document.body
    );
  }

  function ensureOverlay(video) {
    const host = hostFor(video);
    const hostStyle = window.getComputedStyle(host);
    if (hostStyle.position === "static") host.style.position = "relative";

    if (!state.canvas) {
      const canvas = document.createElement("canvas");
      canvas.id = "pld-lipsync-canvas";
      canvas.setAttribute("aria-hidden", "true");
      Object.assign(canvas.style, {
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        objectFit: "contain",
        pointerEvents: "none",
        zIndex: "2",
      });
      state.canvas = canvas;
      state.ctx = canvas.getContext("2d", { alpha: false });
    }

    if (state.canvas.parentElement !== host) host.appendChild(state.canvas);

    if (!state.hud) {
      const hud = document.createElement("div");
      hud.id = "pld-lipsync-hud";
      Object.assign(hud.style, {
        position: "absolute",
        left: "12px",
        top: "12px",
        zIndex: "4",
        pointerEvents: "none",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        fontSize: "11px",
        letterSpacing: "0.04em",
        color: "#f4f4f5",
        background: "rgba(10,10,12,0.62)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: "999px",
        padding: "4px 10px",
      });
      state.hud = hud;
    }
    if (state.hud.parentElement !== host) host.appendChild(state.hud);

    video.style.opacity = "0";
    video.dataset.pldHidden = "1";
  }

  function pruneFrames(now) {
    const keepFrom = now - state.delayMs - 250;
    while (state.frames.length > 1 && state.frames[0].t < keepFrom) {
      const gone = state.frames.shift();
      if (gone && gone.bmp && gone.bmp.close) gone.bmp.close();
    }
    const cap = Math.ceil((state.delayMs / 1000) * 28) + 8;
    while (state.frames.length > cap) {
      const gone = state.frames.shift();
      if (gone && gone.bmp && gone.bmp.close) gone.bmp.close();
    }
  }

  function captureSize(video) {
    const w = video.videoWidth || 0;
    const h = video.videoHeight || 0;
    if (!w || !h) return null;
    const maxW = window.innerWidth < 700 ? 854 : 1280;
    const scale = w > maxW ? maxW / w : 1;
    return { w: Math.max(2, Math.round(w * scale)), h: Math.max(2, Math.round(h * scale)) };
  }

  async function grabFrame(video) {
    const size = captureSize(video);
    if (!size) return;
    const now = performance.now();
    try {
      let bmp;
      if (typeof createImageBitmap === "function") {
        bmp = await createImageBitmap(video, {
          resizeWidth: size.w,
          resizeHeight: size.h,
          resizeQuality: "low",
        });
      } else {
        const scratch = document.createElement("canvas");
        scratch.width = size.w;
        scratch.height = size.h;
        scratch.getContext("2d").drawImage(video, 0, 0, size.w, size.h);
        bmp = scratch;
      }
      state.frames.push({ t: now, bmp, w: size.w, h: size.h });
      pruneFrames(now);
    } catch (_) {}
  }

  function pickFrame(now) {
    const target = now - state.delayMs;
    let chosen = null;
    for (let i = 0; i < state.frames.length; i++) {
      if (state.frames[i].t <= target) chosen = state.frames[i];
      else break;
    }
    return chosen || (state.frames.length ? state.frames[0] : null);
  }

  function draw() {
    if (!state.running || !state.canvas || !state.ctx) return;
    const video = state.video;
    if (!video) return;
    const frame = pickFrame(performance.now());
    if (!frame) return;
    if (state.canvas.width !== frame.w || state.canvas.height !== frame.h) {
      state.canvas.width = frame.w;
      state.canvas.height = frame.h;
    }
    try {
      state.ctx.drawImage(frame.bmp, 0, 0, frame.w, frame.h);
    } catch (_) {}
    if (state.hud) {
      const sec = (state.delayMs / 1000).toFixed(1);
      state.hud.textContent = "Lipsync " + sec + "s";
    }
  }

  function loopCapture() {
    if (!state.running) return;
    const video = state.video && document.contains(state.video) ? state.video : findVideo();
    if (video && video !== state.video) {
      restoreVideo(state.video);
      state.video = video;
      ensureOverlay(video);
      bindVideo(video);
    }
    if (state.video) {
      const now = performance.now();
      if (now - state.lastCapture >= state.captureEveryMs) {
        state.lastCapture = now;
        grabFrame(state.video);
      }
    }
    draw();
    state.rafHandle = requestAnimationFrame(loopCapture);
  }

  function bindVideo(video) {
    if (state.onSeek && state.video) {
      try {
        state.video.removeEventListener("seeked", state.onSeek);
      } catch (_) {}
    }
    state.onSeek = () => {
      while (state.frames.length) {
        const gone = state.frames.shift();
        if (gone && gone.bmp && gone.bmp.close) gone.bmp.close();
      }
    };
    video.addEventListener("seeked", state.onSeek);
  }

  function restoreVideo(video) {
    if (!video) return;
    if (video.dataset.pldHidden === "1") {
      video.style.opacity = "";
      delete video.dataset.pldHidden;
    }
  }

  function start(delayMs) {
    state.enabled = true;
    state.delayMs = clampDelay(delayMs || state.delayMs);
    state.captureEveryMs = window.innerWidth < 700 ? 50 : 40;
    const video = findVideo();
    if (!video) {
      state.running = true;
      if (!state.rafHandle) state.rafHandle = requestAnimationFrame(loopCapture);
      return;
    }
    state.video = video;
    ensureOverlay(video);
    bindVideo(video);
    if (!state.running) {
      state.running = true;
      state.rafHandle = requestAnimationFrame(loopCapture);
    }
    if (!state.onFs) {
      state.onFs = () => {
        if (state.video) ensureOverlay(state.video);
      };
      document.addEventListener("fullscreenchange", state.onFs);
    }
  }

  function updateDelay(delayMs) {
    state.delayMs = clampDelay(delayMs);
    if (state.hud) state.hud.textContent = "Lipsync " + (state.delayMs / 1000).toFixed(1) + "s";
  }

  function stop() {
    state.enabled = false;
    state.running = false;
    if (state.rafHandle) cancelAnimationFrame(state.rafHandle);
    state.rafHandle = 0;
    restoreVideo(state.video);
    while (state.frames.length) {
      const gone = state.frames.shift();
      if (gone && gone.bmp && gone.bmp.close) gone.bmp.close();
    }
    if (state.canvas && state.canvas.parentElement) state.canvas.parentElement.removeChild(state.canvas);
    if (state.hud && state.hud.parentElement) state.hud.parentElement.removeChild(state.hud);
    if (state.onSeek && state.video) {
      try {
        state.video.removeEventListener("seeked", state.onSeek);
      } catch (_) {}
    }
    if (state.onFs) {
      document.removeEventListener("fullscreenchange", state.onFs);
      state.onFs = null;
    }
    state.video = null;
    state.canvas = null;
    state.ctx = null;
    state.hud = null;
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message.type !== "string") return;
    if (message.type === "PLD_START" || message.type === "PLD_SYNC") {
      if (message.enabled === false) {
        stop();
        return;
      }
      if (message.delayMs) updateDelay(message.delayMs);
      start(message.delayMs);
    } else if (message.type === "PLD_STOP") {
      stop();
    }
  });
})();

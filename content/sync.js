/* ParsLiveDub lipsync v1.6.13
   Delay VIDEO FRAMES only (canvas). Tab audio for Gemini stays real-time.
   Mobile: try canvas lag; never hide video until non-blank frames proven. */
(function () {
  if (window.__pldSyncInstalled) return;
  window.__pldSyncInstalled = true;

  const MAX_DELAY_MS = 5000;
  const MIN_DELAY_MS = 600;
  const DEFAULT_DELAY_MS = 2000;

  function isMobileEnv() {
    try {
      if (/Android|iPhone|iPad|iPod|Mobile|Lemur/i.test(navigator.userAgent || "")) return true;
      if ((navigator.maxTouchPoints || 0) > 1 && Math.min(window.innerWidth, window.innerHeight) < 900) return true;
    } catch (_) {}
    return false;
  }

  const MOBILE = isMobileEnv();

  const state = {
    enabled: false,
    delayMs: DEFAULT_DELAY_MS,
    video: null,
    canvas: null,
    ctx: null,
    hud: null,
    frames: [],
    pool: [],
    running: false,
    rafHandle: 0,
    lastCapture: 0,
    captureEveryMs: 50,
    onSeek: null,
    onFs: null,
    videoHidden: false,
    captureOk: false,
    captureFails: 0,
    startedAt: 0,
    aborted: false,
    mobileMode: MOBILE,
    syncState: null,
    syncTimer: null,
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
      video.closest("#movie_player") ||
      video.closest("#player") ||
      video.closest(".video-stream") ||
      video.parentElement ||
      document.body
    );
  }

  function ensureHud(video) {
    const host = hostFor(video);
    if (!host) return;
    const hostStyle = window.getComputedStyle(host);
    if (hostStyle.position === "static") host.style.position = "relative";

    if (!state.hud) {
      const hud = document.createElement("div");
      hud.id = "pld-lipsync-hud";
      Object.assign(hud.style, {
        position: "absolute",
        left: "12px",
        top: "12px",
        zIndex: "2147483646",
        pointerEvents: "none",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        fontSize: "11px",
        letterSpacing: "0.04em",
        color: "#f4f4f5",
        background: "rgba(10,10,12,0.72)",
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: "999px",
        padding: "4px 10px",
      });
      state.hud = hud;
    }
    if (state.hud.parentElement !== host) host.appendChild(state.hud);
    updateHud();
  }

  function ensureOverlay(video) {
    if (state.aborted) {
      ensureHud(video);
      return;
    }
    const host = hostFor(video);
    if (!host) return;
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
        background: "transparent",
        display: "none",
      });
      state.canvas = canvas;
      state.ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    }

    if (state.canvas.parentElement !== host) host.appendChild(state.canvas);
    ensureHud(video);
  }

  function hideVideo(video) {
    if (state.aborted) return;
    if (!video || state.videoHidden) return;
    video.style.opacity = "0";
    video.style.visibility = "visible";
    video.dataset.pldHidden = "1";
    state.videoHidden = true;
    if (state.canvas) state.canvas.style.display = "block";
  }

  function restoreVideo(video) {
    if (!video) return;
    if (video.dataset.pldHidden === "1") {
      video.style.opacity = "";
      delete video.dataset.pldHidden;
    }
    state.videoHidden = false;
    if (state.canvas) state.canvas.style.display = "none";
  }

  function acquireCanvas(w, h) {
    const c = state.pool.pop() || document.createElement("canvas");
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    return c;
  }

  function releaseCanvas(c) {
    if (!c) return;
    if (state.pool.length < 72) state.pool.push(c);
  }

  function pruneFrames(now) {
    const keepFrom = now - state.delayMs - 280;
    while (state.frames.length > 1 && state.frames[0].t < keepFrom) {
      releaseCanvas(state.frames.shift().bmp);
    }
    const fps = 1000 / Math.max(33, state.captureEveryMs);
    const cap = Math.ceil((state.delayMs / 1000) * fps) + 6;
    while (state.frames.length > cap) {
      releaseCanvas(state.frames.shift().bmp);
    }
  }

  function captureSize(video) {
    const w = video.videoWidth || 0;
    const h = video.videoHeight || 0;
    if (!w || !h) return null;
    const maxW = 960;
    const scale = w > maxW ? maxW / w : 1;
    return { w: Math.max(2, Math.round(w * scale)), h: Math.max(2, Math.round(h * scale)) };
  }

  function frameLooksBlank(bmp) {
    try {
      const ctx = bmp.getContext("2d", { willReadFrequently: true });
      if (!ctx) return true;
      const w = bmp.width;
      const h = bmp.height;
      if (w < 2 || h < 2) return true;
      const samples = [
        ctx.getImageData(Math.floor(w * 0.5), Math.floor(h * 0.5), 1, 1).data,
        ctx.getImageData(Math.floor(w * 0.25), Math.floor(h * 0.25), 1, 1).data,
        ctx.getImageData(Math.floor(w * 0.75), Math.floor(h * 0.75), 1, 1).data,
        ctx.getImageData(Math.floor(w * 0.25), Math.floor(h * 0.75), 1, 1).data,
        ctx.getImageData(Math.floor(w * 0.75), Math.floor(h * 0.25), 1, 1).data,
      ];
      let bright = 0;
      for (let i = 0; i < samples.length; i++) {
        const d = samples[i];
        if (d[0] + d[1] + d[2] > 24) bright += 1;
      }
      return bright < 2;
    } catch (_) {
      return true;
    }
  }

  function grabFrame(video) {
    if (state.aborted) return;
    const size = captureSize(video);
    if (!size || !video.videoWidth) {
      state.captureFails += 1;
      return;
    }
    const now = performance.now();
    try {
      const bmp = acquireCanvas(size.w, size.h);
      const ctx = bmp.getContext("2d", { alpha: false });
      ctx.drawImage(video, 0, 0, size.w, size.h);
      if (frameLooksBlank(bmp)) {
        releaseCanvas(bmp);
        state.captureFails += 1;
        return;
      }
      state.captureFails = 0;
      state.captureOk = true;
      state.frames.push({ t: now, bmp, w: size.w, h: size.h });
      pruneFrames(now);
      maybeEnableOverlay();
    } catch (_) {
      state.captureFails += 1;
    }
  }

  function maybeEnableOverlay() {
    if (state.aborted || state.videoHidden || !state.captureOk) return;
    const need = Math.max(4, Math.ceil(state.delayMs / state.captureEveryMs) * 0.4);
    if (state.frames.length >= need) {
      hideVideo(state.video);
    }
  }

  function abortVisualLipsync(reason) {
    if (state.aborted) return;
    state.aborted = true;
    restoreVideo(state.video);
    while (state.frames.length) releaseCanvas(state.frames.shift().bmp);
    if (state.canvas && state.canvas.parentElement) {
      state.canvas.parentElement.removeChild(state.canvas);
    }
    state.canvas = null;
    state.ctx = null;
    updateHud();
    console.warn("[ParsLiveDub] visual lipsync aborted:", reason);
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

  function updateHud() {
    if (!state.hud) return;
    if (state.aborted) {
      state.hud.textContent = "Dub live · picture real-time";
      return;
    }
    if (!state.videoHidden || !state.captureOk) {
      state.hud.textContent = "Buffering picture lag…";
      return;
    }
    state.hud.textContent = "Picture lag " + (state.delayMs / 1000).toFixed(1) + "s · audio live";
  }

  function draw() {
    if (state.aborted) return;
    if (!state.running || !state.canvas || !state.ctx || !state.videoHidden) return;
    const frame = pickFrame(performance.now());
    if (!frame) return;
    if (state.canvas.width !== frame.w || state.canvas.height !== frame.h) {
      state.canvas.width = frame.w;
      state.canvas.height = frame.h;
    }
    try {
      state.ctx.drawImage(frame.bmp, 0, 0, frame.w, frame.h);
    } catch (_) {}
    updateHud();
  }

  function loopCapture() {
    if (!state.running) return;

    const graceMs = state.mobileMode ? 3500 : 2000;
    if (!state.aborted && state.startedAt && performance.now() - state.startedAt > graceMs) {
      if (!state.captureOk || state.frames.length < 2) {
        abortVisualLipsync("no usable frames");
      } else if (state.captureFails > 24 && state.frames.length < 3) {
        abortVisualLipsync("capture failing");
      }
    }

    if (!state.aborted) {
      const video = state.video && document.contains(state.video) ? state.video : findVideo();
      if (video && video !== state.video) {
        restoreVideo(state.video);
        state.video = video;
        ensureOverlay(video);
        bindVideo(video);
      }
      if (state.video && !state.video.paused) {
        const now = performance.now();
        if (now - state.lastCapture >= state.captureEveryMs) {
          state.lastCapture = now;
          grabFrame(state.video);
        }
      }
      draw();
    } else if (state.video) {
      ensureHud(state.video);
    }

    state.rafHandle = requestAnimationFrame(loopCapture);
  }

  function bindVideo(video) {
    if (state.onSeek && state.video) {
      try {
        state.video.removeEventListener("seeked", state.onSeek);
      } catch (_) {}
    }
    state.onSeek = () => {
      while (state.frames.length) releaseCanvas(state.frames.shift().bmp);
      restoreVideo(video);
    };
    video.addEventListener("seeked", state.onSeek);
  }

  function start(delayMs) {
    state.enabled = true;
    state.aborted = false;
    state.captureOk = false;
    state.captureFails = 0;
    state.videoHidden = false;
    state.startedAt = performance.now();
    state.delayMs = clampDelay(delayMs || state.delayMs);
    state.captureEveryMs = 48;
    state.mobileMode = isMobileEnv();

    const video = findVideo();
    if (video) {
      state.video = video;
      restoreVideo(video);
      ensureOverlay(video);
      bindVideo(video);
    }

    // Canvas picture lag only — do not slow video.playbackRate (delays source audio too).
    updateHud();

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
    updateHud();
  }

  function stop() {
    state.enabled = false;
    state.running = false;
    state.aborted = false;
    state.captureOk = false;
    state.captureFails = 0;
    if (state.rafHandle) cancelAnimationFrame(state.rafHandle);
    state.rafHandle = 0;
    restoreVideo(state.video);
    while (state.frames.length) releaseCanvas(state.frames.shift().bmp);
    state.pool.length = 0;
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
    // Clean up sync timer
    if (state.syncTimer) {
      clearInterval(state.syncTimer);
      state.syncTimer = null;
      state.syncState = null;
    }
    state.video = null;
    state.canvas = null;
    state.ctx = null;
    state.hud = null;
    state.videoHidden = false;
  }

  function startContinuousSync(video, lagSec) {
    if (!state.syncTimer) {
      state.syncTimer = setInterval(() => {
        if (!state.enabled || !state.mobileMode || !video || video.readyState < 2) {
          clearInterval(state.syncTimer);
          state.syncTimer = null;
          return;
        }

        // Gentle continuous adjustment
        const now = performance.now();
        if (now - state.syncState.lastAdjust < 300) return; // Don't adjust too frequently

        const currentTime = video.currentTime;
        const expectedTime = state.syncState.expectedTime || currentTime;

        // Calculate drift
        const drift = currentTime - expectedTime;
        const absDrift = Math.abs(drift);

        // Gentle rate adjustment
        let newRate = video.playbackRate;
        if (absDrift > 0.1) { // >100ms drift
          // Small adjustment: 0.01 rate change per adjustment
          if (drift > 0) {
            newRate = Math.max(0.85, video.playbackRate - 0.01); // Slow down if ahead
          } else {
            newRate = Math.min(1.15, video.playbackRate + 0.01); // Speed up if behind
          }
        } else if (absDrift > 0.05) { // >50ms drift
          // Tiny adjustment
          if (drift > 0) {
            newRate = Math.max(0.9, video.playbackRate - 0.005);
          } else {
            newRate = Math.min(1.1, video.playbackRate + 0.005);
          }
        }

        // Apply if rate changed
        if (Math.abs(newRate - video.playbackRate) > 0.001) {
          try {
            video.playbackRate = newRate;
            state.syncState.currentRate = newRate;
            state.syncState.lastAdjust = now;
            state.syncState.adjustmentCount++;
          } catch (_) {}
        }

        // Update expected time for next check
        state.syncState.expectedTime = currentTime + 0.3; // Check every 300ms

        // Stop if we've done enough adjustments or drift is small
        if (state.syncState.adjustmentCount >= state.syncState.maxAdjustments || absDrift < 0.02) {
          // Gradually return to normal rate
          if (Math.abs(video.playbackRate - 1.0) > 0.01) {
            try {
              video.playbackRate = 1.0 + (video.playbackRate - 1.0) * 0.7; // 30% correction toward 1.0
            } catch (_) {}
          } else {
            clearInterval(state.syncTimer);
            state.syncTimer = null;
            state.syncState = null;
          }
        }
      }, 300); // Check every 300ms
    }
  }

  function onNav() {
    if (!state.enabled) return;
    restoreVideo(state.video);
    while (state.frames.length) releaseCanvas(state.frames.shift().bmp);
    state.video = null;
    state.videoHidden = false;
    state.aborted = false;
    state.captureOk = false;
    state.captureFails = 0;
    state.startedAt = performance.now();
    // Clean up sync timer if exists
    if (state.syncTimer) {
      clearInterval(state.syncTimer);
      state.syncTimer = null;
      state.syncState = null;
    }
    start(state.delayMs);
  }

  window.addEventListener("yt-navigate-finish", onNav);
  window.addEventListener("yt-page-data-updated", onNav);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== "string") return;
    if (message.type === "PLD_PING") {
      sendResponse({
        ok: true,
        enabled: state.enabled,
        delayMs: state.delayMs,
        aborted: state.aborted,
        mobile: state.mobileMode,
      });
      return;
    }
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

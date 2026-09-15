const WS_URL_BASE =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const MODEL = "models/gemini-3.5-live-translate-preview";
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const CHUNK_MS = 60;
const MAX_RECONNECT_ATTEMPTS = 4;
const INPUT_HOLD_MAX_S = 2;
const DEFAULT_DELAY_MS = 2900;

let session = null;

function sendToBackground(message) {
  try {
    chrome.runtime.sendMessage({ target: "background", ...message }).catch(() => {});
  } catch (_) {}
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function uint8ArrayToBase64(bytes) {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function downsampleTo16k(samples, fromRate) {
  if (fromRate === INPUT_SAMPLE_RATE) return samples;
  const ratio = fromRate / INPUT_SAMPLE_RATE;
  const outLength = Math.max(1, Math.round(samples.length / ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const frac = src - i0;
    out[i] = samples[i0] * (1 - frac) + samples[i1] * frac;
  }
  return out;
}

function floatTo16BitPCM(samples) {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

function pcm16BytesToFloat32(bytes) {
  const usable = bytes.length - (bytes.length % 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, usable);
  const out = new Float32Array(usable / 2);
  for (let i = 0; i < out.length; i++) {
    const s = view.getInt16(i * 2, true);
    out[i] = s / (s < 0 ? 0x8000 : 0x7fff);
  }
  return out;
}

function concatFloat32(a, b) {
  if (!a || !a.length) return b;
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function estimateF0(samples, sampleRate) {
  const n = samples.length;
  if (n < 160) return 0;
  let energy = 0;
  for (let i = 0; i < n; i++) energy += samples[i] * samples[i];
  const rms = Math.sqrt(energy / n);
  if (rms < 0.02) return 0;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += samples[i];
  mean /= n;
  const minF = 75;
  const maxF = 320;
  const minLag = Math.max(2, Math.floor(sampleRate / maxF));
  const maxLag = Math.min(n - 2, Math.floor(sampleRate / minF));
  let bestLag = 0;
  let bestCorr = 0;
  let var0 = 0;
  for (let i = 0; i < n; i++) {
    const x = samples[i] - mean;
    var0 += x * x;
  }
  if (var0 < 1e-6) return 0;
  const step = sampleRate > 20000 ? 2 : 1;
  for (let lag = minLag; lag <= maxLag; lag += step) {
    let corr = 0;
    const count = n - lag;
    for (let i = 0; i < count; i++) {
      corr += (samples[i] - mean) * (samples[i + lag] - mean);
    }
    corr /= count;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }
  const norm = bestCorr / (var0 / n);
  if (!bestLag || norm < 0.22) return 0;
  return sampleRate / bestLag;
}

function classifyGender(f0) {
  if (!f0 || f0 < 70 || f0 > 350) return "u";
  if (f0 < 155) return "m";
  if (f0 > 180) return "f";
  return "u";
}

function median(values) {
  if (!values.length) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function pitchShiftKeepLength(samples, ratio) {
  // v1.6.11: no per-chunk WSOLA (causes Gender matched noise)
  return samples;
}

function pushF0(list, value, cap) {
  if (!value) return;
  list.push(value);
  if (list.length > cap) list.shift();
}

function emitLatency(s) {
  const delayMs = s.syncOffsetMs > 0 ? s.syncOffsetMs : s.measuredDelayMs || DEFAULT_DELAY_MS;
  sendToBackground({
    type: "latency",
    tabId: s.tabId,
    ms: delayMs,
    measuredMs: s.measuredDelayMs || 0,
    lipsync: !!s.lipsync,
    srcGender: s.srcGender,
    outGender: s.outGender,
    pitchRatio: s.pitchRatio,
  });
}

async function startSession(opts) {
  stopSessionInternal();
  const apiKey = opts.apiKey;
  let targetLanguageCode = opts.targetLanguageCode;
  const streamId = opts.streamId;
  const tabId = opts.tabId;
  if (typeof apiKey !== "string" || !apiKey) {
    throw new Error("No API key set. Open Settings and paste your Gemini key.");
  }
  if (typeof streamId !== "string" || !streamId) {
    throw new Error("Could not obtain the tab audio stream.");
  }
  if (typeof targetLanguageCode !== "string" || !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(targetLanguageCode)) {
    targetLanguageCode = "fa";
  }
  sendToBackground({ type: "status", status: "capturing" });
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    },
    video: false,
  });
  const captureContext = new AudioContext();
  const playbackContext = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE, latencyHint: "interactive" });
  if (captureContext.state === "suspended") await captureContext.resume().catch(() => {});
  if (playbackContext.state === "suspended") await playbackContext.resume().catch(() => {});
  const sourceNode = captureContext.createMediaStreamSource(stream);
  const monitorGain = captureContext.createGain();
  monitorGain.gain.value = 0.12;
  sourceNode.connect(monitorGain);
  monitorGain.connect(captureContext.destination);
  const s = {
    tabId,
    apiKey,
    targetLanguageCode,
    lipsync: opts.lipsync !== false,
    matchGender: opts.matchGender !== false,
    syncOffsetMs: Number(opts.syncOffsetMs) || 0,
    stream,
    captureContext,
    playbackContext,
    sourceNode,
    monitorGain,
    captureNode: null,
    silenceGain: null,
    ws: null,
    ready: false,
    everReady: false,
    closedByUs: false,
    queue: [],
    queuedLength: 0,
    inputChunkSize: Math.round((captureContext.sampleRate * CHUNK_MS) / 1000),
    nextPlayTime: 0,
    playbackLead: 0.08,
    reconnectAttempts: 0,
    reconnectTimer: null,
    firstSendAt: 0,
    firstPlayAt: 0,
    measuredDelayMs: DEFAULT_DELAY_MS,
    delayMeasures: [],
    srcAcc: new Float32Array(0),
    outAcc: new Float32Array(0),
    srcF0s: [],
    outF0s: [],
    srcGender: "u",
    outGender: "u",
    pitchRatio: 1,
    lastLatencyEmit: 0,
  };
  session = s;
  await attachCapture(s);
  const [track] = stream.getAudioTracks();
  if (track) {
    track.addEventListener("ended", () => {
      if (session === s) {
        sendToBackground({ type: "ended", tabId: s.tabId });
        stopSessionInternal();
      }
    });
  }
  sendToBackground({ type: "status", status: "connecting" });
  if (s.lipsync) emitLatency(s);
  connectWebSocket(s);
}

async function attachCapture(s) {
  const onSamples = (samples) => onCapturedSamples(s, samples);
  if (s.captureContext.audioWorklet) {
    try {
      await s.captureContext.audioWorklet.addModule("pcm-worklet.js");
      const workletNode = new AudioWorkletNode(s.captureContext, "pcm-capture");
      workletNode.port.onmessage = (event) => onSamples(event.data);
      const silenceGain = s.captureContext.createGain();
      silenceGain.gain.value = 0;
      s.sourceNode.connect(workletNode);
      workletNode.connect(silenceGain);
      silenceGain.connect(s.captureContext.destination);
      s.captureNode = workletNode;
      s.silenceGain = silenceGain;
      return;
    } catch (err) {
      console.warn("[ParsLiveDub] AudioWorklet failed, using ScriptProcessor", err);
    }
  }
  const scriptNode = s.captureContext.createScriptProcessor(1024, 1, 1);
  scriptNode.onaudioprocess = (event) => {
    onSamples(new Float32Array(event.inputBuffer.getChannelData(0)));
  };
  const silenceGain = s.captureContext.createGain();
  silenceGain.gain.value = 0;
  s.sourceNode.connect(scriptNode);
  scriptNode.connect(silenceGain);
  silenceGain.connect(s.captureContext.destination);
  s.captureNode = scriptNode;
  s.silenceGain = silenceGain;
}

function connectWebSocket(s) {
  s.ready = false;
  const ws = new WebSocket(WS_URL_BASE + "?key=" + encodeURIComponent(s.apiKey));
  ws.binaryType = "arraybuffer";
  s.ws = ws;
  ws.onopen = () => {
    if (session !== s || s.ws !== ws) return;
    ws.send(
      JSON.stringify({
        setup: {
          model: MODEL,
          generationConfig: {
            responseModalities: ["AUDIO"],
            translationConfig: {
              targetLanguageCode: s.targetLanguageCode,
              echoTargetLanguage: true,
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      })
    );
  };
  ws.onmessage = (event) => {
    if (session !== s || s.ws !== ws) return;
    handleServerMessage(s, event.data);
  };
  ws.onerror = (event) => {
    if (session !== s || s.ws !== ws) return;
    if (!s.everReady) {
      let message = "Cannot connect to Gemini Live. ";
      // Try to infer common issues
      if (location.protocol === 'http:') {
        message += "The page is HTTP (not secure). For API access, open YouTube via HTTPS.";
      } else {
        message += "Check VPN/network, and ensure site permission for generativelanguage.googleapis.com is ON in Lemur.";
      }
      if (event && event.timeStamp < 5000) {
        message += " Also verify the API key in Settings.";
      }
      sendToBackground({
        type: "error",
        tabId: s.tabId,
        message,
      });
    }
  };
  ws.onclose = (event) => {
    if (session !== s || s.ws !== ws || s.closedByUs) return;
    if (!s.everReady) {
      const reason = event.reason || "";
      let message = "";
      const code = event.code || 0;

      // Map common WebSocket close codes to user-friendly messages
      if (code === 1006) {
        message = "Network disconnected or server unreachable.";
      } else if (code === 1008) {
        message = "Invalid API key or policy violation.";
      } else if (code === 1011) {
        message = "Gemini Live reported an internal error.";
      } else if (reason.includes("quota") || reason.includes("Quota")) {
        message = "API quota exceeded. Check usage on Google AI Studio.";
      } else if (reason.includes("key") || reason.includes("invalid")) {
        message = "Invalid API key. Get a new one from Google AI Studio.";
      } else if (reason.includes("permission") || reason.includes("access")) {
        message = "Site permission missing. Enable generativelanguage.googleapis.com in Lemur.";
      } else if (reason) {
        message = "Gemini refused: " + reason;
      } else {
        message = "Gemini refused the connection. Check API key and network.";
      }

      sendToBackground({ type: "error", tabId: s.tabId, message });
      stopSessionInternal();
      return;
    }
    if (s.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      sendToBackground({
        type: "error",
        tabId: s.tabId,
        message: "Lost the Gemini connection and could not reconnect.",
      });
      stopSessionInternal();
      return;
    }
    s.reconnectAttempts += 1;
    sendToBackground({ type: "status", status: "reconnecting" });
    const delay = Math.min(500 * 2 ** (s.reconnectAttempts - 1), 5000);
    s.reconnectTimer = setTimeout(() => {
      if (session === s && !s.closedByUs) connectWebSocket(s);
    }, delay);
  };
}

function observeSourcePitch(s, pcm16k) {
  if (!s.matchGender) return;
  s.srcAcc = concatFloat32(s.srcAcc, pcm16k);
  const need = 2048;
  while (s.srcAcc.length >= need) {
    const window = s.srcAcc.subarray(0, need);
    const f0 = estimateF0(window, INPUT_SAMPLE_RATE);
    pushF0(s.srcF0s, f0, 10);
    s.srcAcc = s.srcAcc.subarray(need);
    const med = median(s.srcF0s);
    const g = classifyGender(med);
    if (g !== "u") s.srcGender = g;
    updatePitchRatio(s);
  }
}

function observeOutputPitch(s, pcm24k) {
  if (!s.matchGender) return;
  s.outAcc = concatFloat32(s.outAcc, pcm24k);
  const need = 3072;
  while (s.outAcc.length >= need) {
    const window = s.outAcc.subarray(0, need);
    const f0 = estimateF0(window, OUTPUT_SAMPLE_RATE);
    pushF0(s.outF0s, f0, 8);
    s.outAcc = s.outAcc.subarray(need);
    const med = median(s.outF0s);
    const g = classifyGender(med);
    if (g !== "u") s.outGender = g;
    updatePitchRatio(s);
  }
}

function updatePitchRatio(s) {
  let target = 1;
  if (s.srcGender === "f" && s.outGender === "m") target = 1.28;
  else if (s.srcGender === "m" && s.outGender === "f") target = 0.78;
  s.pitchRatio = s.pitchRatio * 0.82 + target * 0.18;
}

function onCapturedSamples(s, samples) {
  if (session !== s) return;
  s.queue.push(samples);
  s.queuedLength += samples.length;
  if (!s.ready || !s.ws || s.ws.readyState !== WebSocket.OPEN) {
    const maxQueued = s.captureContext.sampleRate * INPUT_HOLD_MAX_S;
    while (s.queuedLength > maxQueued && s.queue.length) {
      s.queuedLength -= s.queue[0].length;
      s.queue.shift();
    }
    return;
  }
  drainQueue(s);
}

function drainQueue(s) {
  if (!s.ready || !s.ws || s.ws.readyState !== WebSocket.OPEN) return;

  // Send smaller batches if queue is growing too fast (aggressive draining)
  const maxChunksPerCall = s.queuedLength > s.inputChunkSize * 8 ? 4 : Infinity;
  let chunksSent = 0;

  while (s.queuedLength >= s.inputChunkSize && chunksSent < maxChunksPerCall) {
    const chunk = new Float32Array(s.inputChunkSize);
    let filled = 0;
    while (filled < s.inputChunkSize) {
      const head = s.queue[0];
      const need = s.inputChunkSize - filled;
      if (head.length <= need) {
        chunk.set(head, filled);
        filled += head.length;
        s.queue.shift();
      } else {
        chunk.set(head.subarray(0, need), filled);
        s.queue[0] = head.subarray(need);
        filled += need;
      }
    }
    s.queuedLength -= s.inputChunkSize;
    const pcm16 = downsampleTo16k(chunk, s.captureContext.sampleRate);
    observeSourcePitch(s, pcm16);
    const pcmBytes = floatTo16BitPCM(pcm16);
    try {
      s.ws.send(
        JSON.stringify({
          realtimeInput: {
            audio: {
              data: uint8ArrayToBase64(pcmBytes),
              mimeType: "audio/pcm;rate=16000",
            },
          },
        })
      );
      if (!s.firstSendAt) s.firstSendAt = performance.now();
    } catch (_) {
      break;
    }
  }
}

async function handleServerMessage(s, data) {
  let text;
  if (typeof data === "string") {
    text = data;
  } else if (data instanceof Blob) {
    try {
      text = await data.text();
    } catch (_) {
      return;
    }
  } else {
    try {
      text = new TextDecoder().decode(data);
    } catch (_) {
      return;
    }
  }
  let msg;
  try {
    msg = JSON.parse(text);
  } catch (_) {
    return;
  }
  if (msg.error && msg.error.message) {
    sendToBackground({ type: "error", tabId: s.tabId, message: msg.error.message });
    stopSessionInternal();
    return;
  }
  if (msg.setupComplete) {
    s.ready = true;
    s.everReady = true;
    s.reconnectAttempts = 0;
    s.nextPlayTime = 0;
    sendToBackground({ type: "ready", tabId: s.tabId });
    drainQueue(s);
    return;
  }
  if (msg.goAway) {
    const oldWs = s.ws;
    connectWebSocket(s);
    try {
      oldWs.close(1000);
    } catch (_) {}
    return;
  }
  const content = msg.serverContent || msg.server_content;
  if (!content) return;
  const turn = content.modelTurn || content.model_turn;
  if (turn && Array.isArray(turn.parts)) {
    for (let i = 0; i < turn.parts.length; i++) {
      const part = turn.parts[i];
      const inline = part.inlineData || part.inline_data;
      if (inline && typeof inline.data === "string") {
        playTranslatedAudio(s, inline.data);
      }
    }
  }
}

function playTranslatedAudio(s, base64Data) {
  try {
    const bytes = base64ToUint8Array(base64Data);
    if (bytes.length < 2) return;
    let samples = pcm16BytesToFloat32(bytes);
    observeOutputPitch(s, samples);
    // pitch shift disabled v1.6.11 — clean audio on Gender matched

    if (s.playbackContext.state === "suspended") s.playbackContext.resume().catch(() => {});
    const buffer = s.playbackContext.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    const node = s.playbackContext.createBufferSource();
    node.buffer = buffer;
    node.connect(s.playbackContext.destination);
    const now = s.playbackContext.currentTime;
    if (s.nextPlayTime < now + 0.03) s.nextPlayTime = now + 0.08;
    node.start(s.nextPlayTime);
    s.nextPlayTime += buffer.duration;
    if (s.firstSendAt && s.delayMeasures.length < 6) {
      s.delayMeasures.push(performance.now() - s.firstSendAt);
      if (!s.firstPlayAt) s.firstPlayAt = performance.now();
      if (s.delayMeasures.length >= 3) {
        const sorted = s.delayMeasures.slice().sort((a, b) => a - b);
        const mid = sorted[Math.floor(sorted.length / 2)];
        s.measuredDelayMs = Math.max(1200, Math.min(5000, mid));
        emitLatency(s);
      }
    } else if (s.lipsync && performance.now() - s.lastLatencyEmit > 800) {
      s.lastLatencyEmit = performance.now();
      emitLatency(s);
    }
    if (s.monitorGain) {
      const t = s.captureContext.currentTime;
      s.monitorGain.gain.cancelScheduledValues(t);
      s.monitorGain.gain.setTargetAtTime(0.04, t, 0.03);
      s.monitorGain.gain.setTargetAtTime(0.12, t + buffer.duration + 0.04, 0.2);
    }
  } catch (_) {}
}

function stopSessionInternal() {
  const s = session;
  if (!s) return;

  // Set flag first to prevent reconnection attempts
  s.closedByUs = true;
  if (s.reconnectTimer) clearTimeout(s.reconnectTimer);

  // Clear session reference AFTER setting flag to avoid race conditions
  session = null;

  // WebSocket cleanup - remove event listeners first
  if (s.ws) {
    s.ws.onopen = null;
    s.ws.onmessage = null;
    s.ws.onerror = null;
    s.ws.onclose = null;
    try {
      if (s.ws.readyState === WebSocket.OPEN || s.ws.readyState === WebSocket.CONNECTING) {
        s.ws.close(1000);
      }
    } catch (_) {}
  }

  // Audio node cleanup in safe order
  try {
    if (s.monitorGain) s.monitorGain.disconnect();
    if (s.silenceGain) s.silenceGain.disconnect();
    if (s.captureNode) {
      if (s.captureNode.port) s.captureNode.port.onmessage = null;
      s.captureNode.disconnect();
    }
    if (s.sourceNode) s.sourceNode.disconnect();
  } catch (_) {}

  // Media stream tracks
  try {
    if (s.stream) s.stream.getTracks().forEach((t) => t.stop());
  } catch (_) {}

  // Audio contexts (should be after all nodes disconnected)
  try {
    if (s.playbackContext && s.playbackContext.state !== 'closed') {
      s.playbackContext.close();
    }
  } catch (_) {}
  try {
    if (s.captureContext && s.captureContext.state !== 'closed') {
      s.captureContext.close();
    }
  } catch (_) {}

  // Clear all pending queues and buffers
  s.queue.length = 0;
  s.queuedLength = 0;
  s.srcAcc = new Float32Array(0);
  s.outAcc = new Float32Array(0);
  s.srcF0s.length = 0;
  s.outF0s.length = 0;
  s.delayMeasures.length = 0;
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.target !== "offscreen") return;
  if (sender && sender.id && sender.id !== chrome.runtime.id) return;
  if (message.type === "start") {
    startSession(message).catch((err) => {
      sendToBackground({
        type: "error",
        tabId: message.tabId,
        message: String((err && err.message) || err),
      });
      stopSessionInternal();
    });
  } else if (message.type === "stop") {
    stopSessionInternal();
    sendToBackground({ type: "stopped" });
  } else if (message.type === "update-settings" && session) {
    if (typeof message.lipsync === "boolean") session.lipsync = message.lipsync;
    if (typeof message.matchGender === "boolean") session.matchGender = message.matchGender;
    if (Number.isFinite(Number(message.syncOffsetMs))) session.syncOffsetMs = Number(message.syncOffsetMs);
    emitLatency(session);
  }
});

const WS_URL_BASE =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const MODEL = "models/gemini-3.5-live-translate-preview";
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const CHUNK_MS = 100;
const MAX_RECONNECT_ATTEMPTS = 4;
const INPUT_HOLD_MAX_S = 5;

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

async function startSession({ tabId, streamId, apiKey, targetLanguageCode }) {
  stopSessionInternal();

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
  const playbackContext = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE, latencyHint: "playback" });
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
    playbackLead: 0.2,
    reconnectAttempts: 0,
    reconnectTimer: null,
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

  const scriptNode = s.captureContext.createScriptProcessor(4096, 1, 1);
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
    // Transcription configs MUST sit at setup root.
    // Putting them inside generationConfig is rejected:
    // "Unknown name inputAudioTranscription"
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

  ws.onerror = () => {
    if (session !== s || s.ws !== ws) return;
    if (!s.everReady) {
      sendToBackground({
        type: "error",
        tabId: s.tabId,
        message: "WebSocket error. Check VPN/network, then retry.",
      });
    }
  };

  ws.onclose = (event) => {
    if (session !== s || s.ws !== ws || s.closedByUs) return;

    if (!s.everReady) {
      const reason = event.reason || "";
      let message = "Gemini refused the connection.";
      if (reason) message += " " + reason;
      else message += " Check the API key in Settings. If Persian Live Dub works with this key, the previous ParsLiveDub setup payload was invalid — this build uses the working protocol.";
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

  while (s.queuedLength >= s.inputChunkSize) {
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

    const pcmBytes = floatTo16BitPCM(downsampleTo16k(chunk, s.captureContext.sampleRate));
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
    const samples = pcm16BytesToFloat32(bytes);
    if (s.playbackContext.state === "suspended") s.playbackContext.resume().catch(() => {});

    const buffer = s.playbackContext.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    const node = s.playbackContext.createBufferSource();
    node.buffer = buffer;
    node.connect(s.playbackContext.destination);

    const now = s.playbackContext.currentTime;
    if (s.nextPlayTime < now + 0.02) s.nextPlayTime = now + 0.08;
    node.start(s.nextPlayTime);
    s.nextPlayTime += buffer.duration;

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
  session = null;
  s.closedByUs = true;
  if (s.reconnectTimer) clearTimeout(s.reconnectTimer);
  try {
    if (s.captureNode) {
      if (s.captureNode.port) s.captureNode.port.onmessage = null;
      s.captureNode.disconnect();
    }
    if (s.silenceGain) s.silenceGain.disconnect();
    if (s.sourceNode) s.sourceNode.disconnect();
    if (s.monitorGain) s.monitorGain.disconnect();
  } catch (_) {}
  try {
    s.stream.getTracks().forEach((t) => t.stop());
  } catch (_) {}
  try {
    s.captureContext.close();
  } catch (_) {}
  try {
    s.playbackContext.close();
  } catch (_) {}
  try {
    if (s.ws && (s.ws.readyState === WebSocket.OPEN || s.ws.readyState === WebSocket.CONNECTING)) {
      s.ws.close(1000);
    }
  } catch (_) {}
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
  }
});

// ParsLiveDub Offscreen Engine v1.3
// Official Live Translate protocol: 100ms PCM chunks, realtimeInput.audio, dual sample-rate

let captureCtx = null;
let playbackCtx = null;
let mediaStream = null;
let sourceNode = null;
let gainNode = null;
let processorNode = null;
let muteNode = null;
let websocket = null;
let isActive = false;
let apiKey = "";
let targetLang = "fa";
let nextPlayTime = 0;
let reconnectAttempts = 0;
let leftover = new Float32Array(0);

const MAX_RECONNECT = 5;
const MODEL = "gemini-3.5-live-translate-preview";
const CAPTURE_RATE = 16000;
const PLAYBACK_RATE = 24000;
const CHUNK_SAMPLES = 1600;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "OFFSCREEN_START") {
    startCapture(message.streamId, message.apiKey, message.targetLang)
      .then(() => sendResponse({ success: true }))
      .catch((err) => {
        console.error("[ParsLiveDub] Start failed:", err);
        sendResponse({ success: false, error: err.message || String(err) });
      });
    return true;
  }
  if (message.type === "OFFSCREEN_STOP") {
    stopCapture();
    sendResponse({ success: true });
  }
});

async function startCapture(streamId, key, lang) {
  if (isActive) stopCapture();

  apiKey = key;
  targetLang = lang || "fa";
  isActive = true;
  reconnectAttempts = 0;
  nextPlayTime = 0;
  leftover = new Float32Array(0);

  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    },
  });

  captureCtx = new AudioContext({ sampleRate: CAPTURE_RATE });
  playbackCtx = new AudioContext({ sampleRate: PLAYBACK_RATE });
  sourceNode = captureCtx.createMediaStreamSource(mediaStream);

  gainNode = captureCtx.createGain();
  gainNode.gain.value = 0.14;
  sourceNode.connect(gainNode);
  gainNode.connect(captureCtx.destination);

  processorNode = captureCtx.createScriptProcessor(2048, 1, 1);
  processorNode.onaudioprocess = (e) => {
    if (!isActive || !websocket || websocket.readyState !== WebSocket.OPEN) return;
    enqueueAndSend(e.inputBuffer.getChannelData(0));
  };
  sourceNode.connect(processorNode);
  muteNode = captureCtx.createGain();
  muteNode.gain.value = 0;
  processorNode.connect(muteNode);
  muteNode.connect(captureCtx.destination);

  await connectWS();
  console.log("[ParsLiveDub] v1.3 ready →", targetLang);
}

function floatTo16BitPCM(f32) {
  const buf = new ArrayBuffer(f32.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

function bytesToBase64(bytes) {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function enqueueAndSend(input) {
  const merged = new Float32Array(leftover.length + input.length);
  merged.set(leftover);
  merged.set(input, leftover.length);
  let offset = 0;
  while (offset + CHUNK_SAMPLES <= merged.length) {
    const slice = merged.subarray(offset, offset + CHUNK_SAMPLES);
    const pcm = floatTo16BitPCM(slice);
    websocket.send(
      JSON.stringify({
        realtimeInput: {
          audio: {
            mimeType: "audio/pcm;rate=16000",
            data: bytesToBase64(pcm),
          },
        },
      }),
    );
    offset += CHUNK_SAMPLES;
  }
  leftover = merged.slice(offset);
}

function connectWS() {
  return new Promise((resolve, reject) => {
    const url =
      "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=" +
      encodeURIComponent(apiKey);
    websocket = new WebSocket(url);

    websocket.onopen = () => {
      reconnectAttempts = 0;
      websocket.send(
        JSON.stringify({
          setup: {
            model: "models/" + MODEL,
            generationConfig: {
              responseModalities: ["AUDIO"],
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              translationConfig: {
                targetLanguageCode: targetLang,
                echoTargetLanguage: true,
              },
            },
          },
        }),
      );
    };

    websocket.onmessage = async (ev) => {
      try {
        const raw = typeof ev.data === "string" ? ev.data : await ev.data.text();
        const data = JSON.parse(raw);
        if (data.setupComplete) {
          resolve();
          return;
        }
        if (data.serverContent && data.serverContent.modelTurn && data.serverContent.modelTurn.parts) {
          const parts = data.serverContent.modelTurn.parts;
          for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (part.inlineData && part.inlineData.data) {
              playRawPCM(base64ToAB(part.inlineData.data));
            }
          }
        }
      } catch (e) {
        console.error("[ParsLiveDub] onmessage", e);
      }
    };

    websocket.onerror = (e) => {
      console.error("[ParsLiveDub] WS error", e);
      reject(new Error("WebSocket failed"));
    };

    websocket.onclose = () => {
      if (isActive && reconnectAttempts < MAX_RECONNECT) {
        reconnectAttempts += 1;
        setTimeout(() => connectWS().catch(console.error), 800 * reconnectAttempts);
      }
    };
  });
}

function base64ToAB(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function playRawPCM(arrayBuffer) {
  if (!playbackCtx) return;
  const int16 = new Int16Array(arrayBuffer);
  if (!int16.length) return;
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
  const buffer = playbackCtx.createBuffer(1, float32.length, PLAYBACK_RATE);
  buffer.copyToChannel(float32, 0);
  const src = playbackCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(playbackCtx.destination);
  const now = playbackCtx.currentTime;
  if (nextPlayTime < now) nextPlayTime = now + 0.015;
  src.start(nextPlayTime);
  nextPlayTime += buffer.duration;

  if (gainNode && captureCtx) {
    const t = captureCtx.currentTime;
    gainNode.gain.cancelScheduledValues(t);
    gainNode.gain.setTargetAtTime(0.04, t, 0.025);
    gainNode.gain.setTargetAtTime(0.14, t + buffer.duration + 0.05, 0.18);
  }
}

function stopCapture() {
  isActive = false;
  if (websocket) {
    try {
      websocket.close();
    } catch (_) {}
    websocket = null;
  }
  if (processorNode) {
    try {
      processorNode.disconnect();
    } catch (_) {}
    processorNode = null;
  }
  if (muteNode) {
    try {
      muteNode.disconnect();
    } catch (_) {}
    muteNode = null;
  }
  if (gainNode) {
    try {
      gainNode.disconnect();
    } catch (_) {}
    gainNode = null;
  }
  if (sourceNode) {
    try {
      sourceNode.disconnect();
    } catch (_) {}
    sourceNode = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
  if (captureCtx) {
    captureCtx.close().catch(function () {});
    captureCtx = null;
  }
  if (playbackCtx) {
    playbackCtx.close().catch(function () {});
    playbackCtx = null;
  }
  leftover = new Float32Array(0);
  nextPlayTime = 0;
}

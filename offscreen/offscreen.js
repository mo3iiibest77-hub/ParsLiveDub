// ParsLiveDub Offscreen Engine v1.2
// Proper dual sample-rate (16kHz capture → 24kHz playback) + robust PCM handling

let captureCtx = null;   // 16 kHz for sending to Gemini
let playbackCtx = null;  // 24 kHz for playing translated audio
let mediaStream = null;
let sourceNode = null;
let gainNode = null;
let processorNode = null;
let websocket = null;
let isActive = false;
let apiKey = '';
let targetLang = 'fa';
let nextPlayTime = 0;
let reconnectAttempts = 0;

const MAX_RECONNECT = 5;
const MODEL = 'gemini-3.5-live-translate-preview';
const CAPTURE_RATE = 16000;
const PLAYBACK_RATE = 24000;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'OFFSCREEN_START') {
    startCapture(message.streamId, message.apiKey, message.targetLang)
      .then(() => sendResponse({ success: true }))
      .catch(err => {
        console.error('[ParsLiveDub] Start failed:', err);
        sendResponse({ success: false, error: err.message || String(err) });
      });
    return true;
  }
  if (message.type === 'OFFSCREEN_STOP') {
    stopCapture();
    sendResponse({ success: true });
  }
});

async function startCapture(streamId, key, lang = 'fa') {
  if (isActive) stopCapture();

  apiKey = key;
  targetLang = lang || 'fa';
  isActive = true;
  reconnectAttempts = 0;
  nextPlayTime = 0;

  // 1. Capture tab audio
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    }
  });

  // 2. Capture context (16 kHz) – what we send to Gemini
  captureCtx = new AudioContext({ sampleRate: CAPTURE_RATE });
  sourceNode = captureCtx.createMediaStreamSource(mediaStream);

  // Duck original audio
  gainNode = captureCtx.createGain();
  gainNode.gain.value = 0.14;
  sourceNode.connect(gainNode);
  gainNode.connect(captureCtx.destination);

  // 3. Playback context (24 kHz) – for natural Gemini output
  playbackCtx = new AudioContext({ sampleRate: PLAYBACK_RATE });

  // 4. Extract PCM and send
  const bufferSize = 4096;
  processorNode = captureCtx.createScriptProcessor(bufferSize, 1, 1);
  processorNode.onaudioprocess = (e) => {
    if (!isActive || !websocket || websocket.readyState !== WebSocket.OPEN) return;
    const pcm = floatTo16BitPCM(e.inputBuffer.getChannelData(0));
    sendChunk(pcm);
  };
  sourceNode.connect(processorNode);

  await connectWS();
  console.log('[ParsLiveDub] v1.2 Engine ready – Live Translate →', targetLang);
}

function floatTo16BitPCM(f32) {
  const buf = new ArrayBuffer(f32.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < f32.length; i++) {
    let s = Math.max(-1, Math.min(1, f32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return new Uint8Array(buf);
}

function connectWS() {
  return new Promise((resolve, reject) => {
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
    websocket = new WebSocket(url);

    websocket.onopen = () => {
      console.log('[ParsLiveDub] WebSocket connected');
      reconnectAttempts = 0;

      const setup = {
        setup: {
          model: `models/${MODEL}`,
          generationConfig: {
            responseModalities: ['AUDIO'],
            translationConfig: {
              targetLanguageCode: targetLang,
              echoTargetLanguage: true
            }
          }
        }
      };
      websocket.send(JSON.stringify(setup));
      resolve();
    };

    websocket.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);

        if (data.setupComplete) {
          console.log('[ParsLiveDub] Setup complete');
          return;
        }

        if (data.serverContent?.modelTurn?.parts) {
          for (const part of data.serverContent.modelTurn.parts) {
            if (part.inlineData?.data) {
              const mime = (part.inlineData.mimeType || '').toLowerCase();
              const ab = base64ToAB(part.inlineData.data);

              // Live Translate almost always returns raw PCM
              if (mime.includes('pcm') || mime.includes('raw') || mime === '' || 
                  (!mime.includes('mpeg') && !mime.includes('mp3') && !mime.includes('wav') && !mime.includes('ogg'))) {
                playRawPCM(ab);
              } else {
                playEncoded(ab);
              }
            }
          }
        }
      } catch (e) {
        console.error('[ParsLiveDub] onmessage error', e);
      }
    };

    websocket.onerror = (e) => {
      console.error('[ParsLiveDub] WS error', e);
      reject(e);
    };

    websocket.onclose = () => {
      console.log('[ParsLiveDub] WS closed');
      if (isActive && reconnectAttempts < MAX_RECONNECT) {
        reconnectAttempts++;
        console.log(`[ParsLiveDub] Reconnecting (${reconnectAttempts}/${MAX_RECONNECT})...`);
        setTimeout(() => connectWS().catch(console.error), 800 * reconnectAttempts);
      }
    };
  });
}

function sendChunk(pcm16) {
  if (!websocket || websocket.readyState !== WebSocket.OPEN) return;

  let binary = '';
  for (let i = 0; i < pcm16.length; i++) binary += String.fromCharCode(pcm16[i]);
  const b64 = btoa(binary);

  websocket.send(JSON.stringify({
    realtimeInput: {
      mediaChunks: [{
        mimeType: 'audio/pcm;rate=16000',
        data: b64
      }]
    }
  }));
}

function base64ToAB(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

// Play raw 16-bit little-endian PCM at 24 kHz
function playRawPCM(arrayBuffer) {
  if (!playbackCtx) return;

  const int16 = new Int16Array(arrayBuffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768.0;
  }

  const buffer = playbackCtx.createBuffer(1, float32.length, PLAYBACK_RATE);
  buffer.copyToChannel(float32, 0);

  const src = playbackCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(playbackCtx.destination);

  const now = playbackCtx.currentTime;
  if (nextPlayTime < now) nextPlayTime = now + 0.015;
  src.start(nextPlayTime);
  nextPlayTime += buffer.duration;

  // Smooth ducking of original audio
  if (gainNode && captureCtx) {
    const t = captureCtx.currentTime;
    gainNode.gain.cancelScheduledValues(t);
    gainNode.gain.setTargetAtTime(0.04, t, 0.025);
    gainNode.gain.setTargetAtTime(0.14, t + buffer.duration + 0.05, 0.18);
  }
}

async function playEncoded(arrayBuffer) {
  if (!playbackCtx) return;
  try {
    const audioBuffer = await playbackCtx.decodeAudioData(arrayBuffer.slice(0));
    const src = playbackCtx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(playbackCtx.destination);

    const now = playbackCtx.currentTime;
    if (nextPlayTime < now) nextPlayTime = now + 0.015;
    src.start(nextPlayTime);
    nextPlayTime += audioBuffer.duration;

    if (gainNode && captureCtx) {
      const t = captureCtx.currentTime;
      gainNode.gain.cancelScheduledValues(t);
      gainNode.gain.setTargetAtTime(0.04, t, 0.025);
      gainNode.gain.setTargetAtTime(0.14, t + audioBuffer.duration + 0.05, 0.18);
    }
  } catch (e) {
    console.warn('[ParsLiveDub] decode failed → fallback to raw PCM', e.message);
    playRawPCM(arrayBuffer);
  }
}

function stopCapture() {
  isActive = false;

  if (websocket) {
    try { websocket.close(); } catch (_) {}
    websocket = null;
  }
  if (processorNode) {
    try { processorNode.disconnect(); } catch (_) {}
    processorNode = null;
  }
  if (gainNode) {
    try { gainNode.disconnect(); } catch (_) {}
    gainNode = null;
  }
  if (sourceNode) {
    try { sourceNode.disconnect(); } catch (_) {}
    sourceNode = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }
  if (captureCtx) {
    captureCtx.close().catch(() => {});
    captureCtx = null;
  }
  if (playbackCtx) {
    playbackCtx.close().catch(() => {});
    playbackCtx = null;
  }
  nextPlayTime = 0;
  console.log('[ParsLiveDub] Engine fully stopped');
}

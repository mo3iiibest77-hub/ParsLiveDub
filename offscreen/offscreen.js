// ParsLiveDub Offscreen Engine v1.1
// Improved audio handling for Gemini Live Translate (raw PCM support)

let audioContext = null;
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

// Playback sample rate from Gemini Live Translate is usually 24kHz
const PLAYBACK_SAMPLE_RATE = 24000;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'OFFSCREEN_START') {
    startCapture(message.streamId, message.apiKey, message.targetLang)
      .then(() => sendResponse({ success: true }))
      .catch(err => {
        console.error('[ParsLiveDub] Start failed:', err);
        sendResponse({ success: false, error: err.message });
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

  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    }
  });

  // Input context at 16kHz for sending to Gemini
  audioContext = new AudioContext({ sampleRate: 16000 });
  sourceNode = audioContext.createMediaStreamSource(mediaStream);

  // Duck original audio
  gainNode = audioContext.createGain();
  gainNode.gain.value = 0.15;
  sourceNode.connect(gainNode);
  gainNode.connect(audioContext.destination);

  const bufferSize = 4096;
  processorNode = audioContext.createScriptProcessor(bufferSize, 1, 1);
  processorNode.onaudioprocess = (e) => {
    if (!isActive || !websocket || websocket.readyState !== WebSocket.OPEN) return;
    const pcm = floatTo16BitPCM(e.inputBuffer.getChannelData(0));
    sendChunk(pcm);
  };
  sourceNode.connect(processorNode);

  await connectWS();
  console.log('[ParsLiveDub] Engine started → Live Translate to', targetLang);
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

    websocket.onmessage = async (ev) => {
      try {
        const data = JSON.parse(ev.data);

        if (data.setupComplete) {
          console.log('[ParsLiveDub] Setup complete – ready');
          return;
        }

        if (data.serverContent?.modelTurn?.parts) {
          for (const part of data.serverContent.modelTurn.parts) {
            if (part.inlineData && part.inlineData.data) {
              const mime = part.inlineData.mimeType || '';
              const ab = base64ToAB(part.inlineData.data);

              if (mime.includes('pcm') || mime.includes('raw') || !mime.includes('mpeg') && !mime.includes('mp3') && !mime.includes('wav')) {
                // Raw PCM path (most common for Live API)
                playRawPCM(ab, PLAYBACK_SAMPLE_RATE);
              } else {
                // Encoded audio – try decode
                playEncoded(ab);
              }
            }
          }
        }
      } catch (e) {
        console.error('[ParsLiveDub] message error', e);
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
        console.log(`[ParsLiveDub] Reconnect attempt ${reconnectAttempts}`);
        setTimeout(() => {
          connectWS().catch(console.error);
        }, 1000 * reconnectAttempts);
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

// Play raw 16-bit PCM (little-endian) at given sample rate
function playRawPCM(arrayBuffer, sampleRate = 24000) {
  if (!audioContext) return;

  const int16 = new Int16Array(arrayBuffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768;
  }

  const buffer = audioContext.createBuffer(1, float32.length, sampleRate);
  buffer.copyToChannel(float32, 0);

  const src = audioContext.createBufferSource();
  src.buffer = buffer;
  src.connect(audioContext.destination);

  const now = audioContext.currentTime;
  if (nextPlayTime < now) nextPlayTime = now + 0.02;
  src.start(nextPlayTime);
  nextPlayTime += buffer.duration;

  // Duck original while speaking
  if (gainNode) {
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setTargetAtTime(0.05, now, 0.03);
    gainNode.gain.setTargetAtTime(0.15, nextPlayTime, 0.2);
  }
}

async function playEncoded(arrayBuffer) {
  if (!audioContext) return;
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const src = audioContext.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(audioContext.destination);

    const now = audioContext.currentTime;
    if (nextPlayTime < now) nextPlayTime = now + 0.02;
    src.start(nextPlayTime);
    nextPlayTime += audioBuffer.duration;

    if (gainNode) {
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setTargetAtTime(0.05, now, 0.03);
      gainNode.gain.setTargetAtTime(0.15, nextPlayTime, 0.2);
    }
  } catch (e) {
    console.warn('[ParsLiveDub] decode failed, trying raw PCM', e.message);
    playRawPCM(arrayBuffer, PLAYBACK_SAMPLE_RATE);
  }
}

function stopCapture() {
  isActive = false;

  if (websocket) {
    try { websocket.close(); } catch (_) {}
    websocket = null;
  }
  if (processorNode) {
    processorNode.disconnect();
    processorNode = null;
  }
  if (gainNode) {
    gainNode.disconnect();
    gainNode = null;
  }
  if (sourceNode) {
    sourceNode.disconnect();
    sourceNode = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }
  if (audioContext) {
    audioContext.close().catch(() => {});
    audioContext = null;
  }
  nextPlayTime = 0;
  console.log('[ParsLiveDub] Engine stopped');
}

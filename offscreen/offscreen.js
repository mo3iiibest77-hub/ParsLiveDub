// ParsLiveDub - Offscreen Audio Processor
// Handles tab audio capture, PCM conversion, Gemini Live WebSocket, and playback

let audioContext = null;
let mediaStream = null;
let sourceNode = null;
let processorNode = null;
let websocket = null;
let isActive = false;
let apiKey = '';
let targetLang = 'fa';

// Audio playback queue for smooth output
let nextPlayTime = 0;
const audioQueue = [];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'OFFSCREEN_START') {
    startCapture(message.streamId, message.apiKey, message.targetLang)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  
  if (message.type === 'OFFSCREEN_STOP') {
    stopCapture();
    sendResponse({ success: true });
  }
});

async function startCapture(streamId, key, lang) {
  if (isActive) stopCapture();
  
  apiKey = key;
  targetLang = lang || 'fa';
  isActive = true;
  
  // Get the media stream from tabCapture
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    }
  });
  
  audioContext = new AudioContext({ sampleRate: 16000 });
  
  // Create source from tab stream
  sourceNode = audioContext.createMediaStreamSource(mediaStream);
  
  // Create a ScriptProcessor for getting raw PCM (or better: AudioWorklet in future)
  // For simplicity and compatibility we use ScriptProcessor first
  const bufferSize = 4096;
  processorNode = audioContext.createScriptProcessor(bufferSize, 1, 1);
  
  processorNode.onaudioprocess = (event) => {
    if (!isActive || !websocket || websocket.readyState !== WebSocket.OPEN) return;
    
    const inputData = event.inputBuffer.getChannelData(0);
    // Convert Float32 to Int16 PCM
    const pcm16 = floatTo16BitPCM(inputData);
    sendAudioChunk(pcm16);
  };
  
  sourceNode.connect(processorNode);
  processorNode.connect(audioContext.destination); // Keep the original audio playing (we can duck later)
  
  // Connect to Gemini Live Translate
  await connectToGemini();
  
  console.log('[ParsLiveDub] Capture started');
}

function floatTo16BitPCM(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32Array.length; i++) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return new Uint8Array(buffer);
}

async function connectToGemini() {
  // Gemini Live API WebSocket endpoint
  // Using the Live Translate model for best speech-to-speech
  const model = 'gemini-2.5-flash-native-audio-preview-12-2025'; // or latest live translate model
  // Note: Check current available models. For pure translation better use live-translate if available.
  
  const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
  
  websocket = new WebSocket(url);
  
  websocket.onopen = () => {
    console.log('[ParsLiveDub] WebSocket connected');
    // Send setup message
    const setup = {
      setup: {
        model: `models/${model}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: 'Kore' // or other available voices
              }
            }
          }
        },
        systemInstruction: {
          parts: [{
            text: `You are a professional simultaneous interpreter. Translate the incoming speech into natural, fluent Persian (Farsi). Keep the original meaning, tone and emotion. Output only the translated speech audio. Do not add any extra comments.`
          }]
        }
      }
    };
    websocket.send(JSON.stringify(setup));
  };
  
  websocket.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      
      // Handle audio response
      if (data.serverContent?.modelTurn?.parts) {
        for (const part of data.serverContent.modelTurn.parts) {
          if (part.inlineData && part.inlineData.mimeType?.startsWith('audio/')) {
            const audioData = base64ToArrayBuffer(part.inlineData.data);
            playAudioChunk(audioData);
          }
        }
      }
    } catch (e) {
      console.error('[ParsLiveDub] Message parse error', e);
    }
  };
  
  websocket.onerror = (err) => {
    console.error('[ParsLiveDub] WebSocket error', err);
  };
  
  websocket.onclose = () => {
    console.log('[ParsLiveDub] WebSocket closed');
  };
}

function sendAudioChunk(pcm16) {
  if (!websocket || websocket.readyState !== WebSocket.OPEN) return;
  
  // Convert to base64
  const base64 = btoa(String.fromCharCode(...pcm16));
  
  const message = {
    realtimeInput: {
      mediaChunks: [{
        mimeType: 'audio/pcm;rate=16000',
        data: base64
      }]
    }
  };
  
  websocket.send(JSON.stringify(message));
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function playAudioChunk(arrayBuffer) {
  if (!audioContext) return;
  
  try {
    // Gemini usually returns 24kHz audio
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    
    const currentTime = audioContext.currentTime;
    if (nextPlayTime < currentTime) {
      nextPlayTime = currentTime;
    }
    source.start(nextPlayTime);
    nextPlayTime += audioBuffer.duration;
  } catch (e) {
    console.error('[ParsLiveDub] Playback error', e);
  }
}

function stopCapture() {
  isActive = false;
  
  if (websocket) {
    websocket.close();
    websocket = null;
  }
  
  if (processorNode) {
    processorNode.disconnect();
    processorNode = null;
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
    audioContext.close();
    audioContext = null;
  }
  
  nextPlayTime = 0;
  console.log('[ParsLiveDub] Capture stopped');
}
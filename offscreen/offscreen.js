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
  // v1.6.10 quality-first: previous WSOLA/OLA path added grain noise on
  // Female→Male ("Gender matched"). Detection still runs for UI stats;
  // audio is left clean until a proven artifact-free shifter exists.
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

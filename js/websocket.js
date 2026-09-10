/**
 * websocket.js — Cliente WebSocket & Audio Streaming
 * Mikit Multimedia · Network Layer
 *
 * Gestiona:
 * - Conexión persistente con el servidor Node.js
 * - Reconexión automática con backoff exponencial
 * - Streaming de audio binario desde ElevenLabs (chunks → AudioContext)
 * - Modo offline (respuestas pre-grabadas si no hay servidor)
 */

const WS_URL = location.hostname === 'localhost'
  ? 'ws://localhost:8080'
  : 'wss://mikit-ws.huggingface.co'; // Reemplazar con URL de producción

let ws          = null;
let reconnectDelay = 1000;
let audioCtx    = null;
let audioQueue  = [];
let isPlaying   = false;

// ── Inicialización de AudioContext (debe activarse por gesto del usuario) ─
function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

// ── Conexión WebSocket ────────────────────────
function connectWS() {
  ws = new WebSocket(WS_URL);
  ws.binaryType = 'arraybuffer'; // Para recibir chunks de audio MP3

  ws.onopen = () => {
    console.log('[WS] Conectado al servidor Mikit.');
    reconnectDelay = 1000; // Reset backoff
    addAgentMessage('sistema', 'Conexión establecida. ¿En qué puedo ayudarte hoy?');
    document.getElementById('agent-status').textContent = 'En línea · Marketing AI';
  };

  ws.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      // Chunk de audio MP3 binario desde ElevenLabs
      queueAudioChunk(event.data);
    } else {
      // Mensaje de texto JSON
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'text') {
          addAgentMessage('agent', msg.payload);
        } else if (msg.type === 'status') {
          document.getElementById('agent-status').textContent = msg.payload;
        }
      } catch (e) {
        console.warn('[WS] Mensaje no JSON:', event.data);
      }
    }
  };

  ws.onerror = (e) => {
    console.warn('[WS] Error de conexión. Usando modo offline.');
    document.getElementById('agent-status').textContent = 'Modo offline · IA Local';
  };

  ws.onclose = () => {
    // Reconexión automática con backoff exponencial
    document.getElementById('agent-status').textContent = 'Reconectando...';
    setTimeout(connectWS, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000); // Max 30s
  };
}

// ── Enviar mensaje al servidor ────────────────
function sendToServer(text) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'user_message', payload: text }));
  } else {
    // Fallback offline: usar respuestas locales
    handleOfflineResponse(text);
  }
}

// ── Cola de audio (streaming MP3) ────────────
function queueAudioChunk(arrayBuffer) {
  audioQueue.push(arrayBuffer);
  if (!isPlaying) playNextChunk();
}

function playNextChunk() {
  if (!audioCtx || audioQueue.length === 0) { isPlaying = false; return; }
  isPlaying = true;
  const chunk = audioQueue.shift();

  audioCtx.decodeAudioData(chunk, (buffer) => {
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.onended = playNextChunk; // Encadenar el siguiente chunk
    source.start(0);
  }, (err) => {
    console.warn('[Audio] Error decodificando chunk:', err);
    playNextChunk(); // Saltar chunk corrupto
  });
}

// ── Modo Offline: respuestas de marketing pre-cargadas ─
const OFFLINE_RESPONSES = [
  'Hola, soy el Asistente Mikit. Actualmente estoy en modo offline. Podemos hablar sobre estrategias de SEO, automatización de marketing o diseño de campañas.',
  'Mis especialidades son: automatización con n8n, CRM avanzado, Google Ads, generación de contenido IA y arquitectura web para conversión.',
  'Para consultas personalizadas, contáctame en: contacto@mikit.com',
];
let offlineIdx = 0;

function handleOfflineResponse(text) {
  setTimeout(() => {
    addAgentMessage('agent', OFFLINE_RESPONSES[offlineIdx % OFFLINE_RESPONSES.length]);
    offlineIdx++;
  }, 700);
}

// Intentar conectar cuando el motor inicia
// (Lo exponemos para que ui.js lo llame al abrir el panel)

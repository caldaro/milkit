/**
 * ui.js — Controlador de UI y Paneles
 * Mikit Multimedia · UI Layer
 *
 * Gestiona la apertura/cierre de paneles, renderizado de galería,
 * la lógica del chat y la entrada de voz (Web Speech API).
 */

// ── Portafolio para la Galería ────────────────
const GALLERY_ITEMS = [
  { icon: '⚡', title: 'Empanadas Matador', sub: 'Automatización n8n · Finanzas', type: 'marketing' },
  { icon: '🏠', title: 'Miami Real Group', sub: 'CRM Automático · Inmobiliario', type: 'marketing' },
  { icon: '🚘', title: 'Independent Sedan', sub: 'Multi-Marca · AI Visual', type: 'campaign' },
  { icon: '⚖️', title: 'Legal-Tech SPA App', sub: 'Consentimientos Digitales · SaaS', type: 'product' },
  { icon: '🛡️', title: 'DMV Cleaning B2B', sub: 'Stack Producción · SEO Local', type: 'web' },
  { icon: '🔧', title: 'Disaster Recovery', sub: 'MySQL · PHP · SysAdmin', type: 'devops' },
  { icon: '🐧', title: 'Linux Rescue Ops', sub: 'Kernel · Snapshots · HW Legacy', type: 'devops' },
  { icon: '🤖', title: 'Milkit 2.5D', sub: 'Raycasting · WebSocket · AI', type: 'meta' },
];

// ── Panel del Agente ──────────────────────────
let agentPanelOpen  = false;
let galleryPanelOpen = false;
let wsInitialized   = false;

function openAgentPanel() {
  if (agentPanelOpen) return;
  agentPanelOpen = true;
  document.getElementById('agent-panel').classList.remove('hidden');
  document.getElementById('chat-input').focus();

  // Inicializar WebSocket y AudioContext la primera vez (requiere gesto)
  initAudio();
  if (!wsInitialized) {
    wsInitialized = true;
    connectWS();
  }

  // Liberar pointer lock para poder escribir
  document.exitPointerLock();
}

function closeAgentPanel() {
  agentPanelOpen = false;
  document.getElementById('agent-panel').classList.add('hidden');
}

// ── Panel de Galería ──────────────────────────
function openGalleryPanel() {
  if (galleryPanelOpen) return;
  galleryPanelOpen = true;
  renderGallery();
  document.getElementById('gallery-panel').classList.remove('hidden');
  document.exitPointerLock();
}

function closeGalleryPanel() {
  galleryPanelOpen = false;
  document.getElementById('gallery-panel').classList.add('hidden');
}

function renderGallery() {
  const grid = document.getElementById('gallery-grid');
  grid.innerHTML = '';
  GALLERY_ITEMS.forEach(item => {
    const el = document.createElement('div');
    el.className = 'gallery-item';
    el.innerHTML = `<div class="gi-icon">${item.icon}</div>
                    <div><strong>${item.title}</strong></div>
                    <div style="font-size:0.65rem;color:#4a6070;">${item.sub}</div>`;
    el.onclick = () => handleGalleryClick(item);
    grid.appendChild(el);
  });
}

function handleGalleryClick(item) {
  // Cierra galería y abre el agente con contexto pre-cargado del proyecto
  closeGalleryPanel();
  openAgentPanel();
  const ctx = `Cuéntame más sobre el proyecto: ${item.title} — ${item.sub}`;
  addUserMessage(ctx);
  sendToServer(ctx);
}

// ── Chat ──────────────────────────────────────
function addAgentMessage(role, text) {
  const container = document.getElementById('chat-messages');
  const el = document.createElement('div');
  el.className = `msg ${role === 'agent' ? 'agent' : 'agent'}`; 
  el.textContent = text;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;

  // Eliminar indicador de "escribiendo..."
  const typing = container.querySelector('.typing');
  if (typing) typing.remove();
}

function addUserMessage(text) {
  const container = document.getElementById('chat-messages');
  const el = document.createElement('div');
  el.className = 'msg user';
  el.textContent = text;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;

  // Añadir indicador "escribiendo..."
  const typing = document.createElement('div');
  typing.className = 'msg typing';
  typing.textContent = 'Milkit Assistant está escribiendo...';
  container.appendChild(typing);
}

function sendMessage() {
  const input = document.getElementById('chat-input');
  const text  = input.value.trim();
  if (!text) return;

  addUserMessage(text);
  sendToServer(text);
  input.value = '';
}

// Enviar con Enter
document.getElementById('chat-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage();
});

// ── Voz (Web Speech API) ──────────────────────
let recognition    = null;
let micActive      = false;

function toggleMic() {
  if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    alert('Tu navegador no soporta reconocimiento de voz.');
    return;
  }

  if (micActive) {
    recognition.stop();
    return;
  }

  initAudio();
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.lang = 'es-CO';
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onstart = () => {
    micActive = true;
    document.getElementById('mic-btn').classList.add('active');
  };
  recognition.onend = () => {
    micActive = false;
    document.getElementById('mic-btn').classList.remove('active');
  };
  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    document.getElementById('chat-input').value = transcript;
    sendMessage();
  };
  recognition.start();
}

// ── ESC para cerrar paneles / reactivar pointer lock ─
document.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    if (agentPanelOpen)   closeAgentPanel();
    if (galleryPanelOpen) closeGalleryPanel();
    // Re-activar pointer lock al volver al juego
    if (!agentPanelOpen && !galleryPanelOpen) {
      document.getElementById('gameCanvas').requestPointerLock();
    }
  }
});

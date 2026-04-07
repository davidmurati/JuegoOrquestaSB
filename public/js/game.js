/**
 * game.js – Lógica principal del juego Orquesta Rock Band
 * 
 * Arquitectura:
 *  - Canvas para renderizar notas cayendo en 5 carriles
 *  - Web Audio API para síntesis de sonidos de golpe e hits
 *  - Sistema de tiempos basado en performance.now() sincronizado con partitura
 *  - Puntuación con multiplicador de combo y récord en localStorage
 */

'use strict';

// ===========================
// CONFIGURACIÓN DEL JUEGO
// ===========================
const CONFIG = {
  LANES: 5,
  LANE_KEYS: ['a', 's', 'd', 'f', 'g'],
  LANE_COLORS: ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#3498db'],
  LANE_COLORS_GLOW: ['rgba(231,76,60,0.6)', 'rgba(230,126,34,0.6)', 'rgba(241,196,15,0.6)', 'rgba(46,204,113,0.6)', 'rgba(52,152,219,0.6)'],
  NOTE_SPEED: 300,           // px por segundo (ajustado al BPM)
  HIT_Y_RATIO: 0.84,         // Zona de golpe en % del canvas (abajo)
  HIT_WINDOW_PERFECT: 70,    // ms para "PERFECTO"
  HIT_WINDOW_GOOD: 150,      // ms para "BIEN"
  SCORE_PERFECT: 100,
  SCORE_GOOD: 50,
  MISS_PENALTY: 0,
  NOTE_WIDTH_RATIO: 0.8,     // Ancho de nota relativo al carril
  NOTE_HEIGHT: 28,           // Altura de nota normal
  NOTE_HEIGHT_LONG: 150,     // Altura de nota larga (sostenida visual)
  NOTE_BORDER_RADIUS: 8,
  HIT_ZONE_HEIGHT: 14,       // Altura de la zona de golpe visual
  PARTICLES: true,
  RECORD_KEY: 'orquesta_rockband_record',
};

// ===========================
// LIBRERÍA DE CANCIONES (Dinámica)
// ===========================
let SONGS = {};
let selectedSongId = null;
let lastAnalyzedSongId = null;

function getRecordKey() {
  return CONFIG.RECORD_KEY + '_' + (selectedSongId || 'default');
}

async function fetchSongs() {
  try {
    const res = await fetch('/api/songs');
    const data = await res.json();
    
    SONGS = {};
    const dropdown = document.getElementById('song-dropdown');
    dropdown.innerHTML = ''; // Limpiar opciones

    if (data.length === 0) {
      dropdown.innerHTML = '<option disabled selected>No hay canciones en /Cancion/</option>';
      return;
    }

    data.forEach((song, index) => {
      SONGS[song.id] = song;
      const option = document.createElement('option');
      option.value = song.id;
      option.textContent = song.title;
      dropdown.appendChild(option);

      // Select the first one by default
      if (index === 0) {
        selectedSongId = song.id;
        dropdown.value = song.id;
      }
    });

    loadRecord();
  } catch (err) {
    console.error("Error cargando canciones del servidor:", err);
  }
}

// ===========================
// ESTADO DEL JUEGO
// ===========================
let state = {
  screen: 'menu',           // menu | game | pause | gameover
  mode: 'normal',           // normal | hard
  elapsed: 0,               // ms transcurridos, ahora ligado al Music.getCurrentTimeMs()
  notes: [],                // notas activas en pantalla
  noteQueue: [],            // cola de notas pendientes
  nextNoteIndex: 0,         // índice de la siguiente nota en la cola
  score: 0,
  combo: 0,
  maxCombo: 0,
  totalNotes: 0,
  hitCount: 0,
  missCount: 0,
  record: 0,
  particles: [],
  lanePressed: [false, false, false, false, false],
  laneFlash: [0, 0, 0, 0, 0],
  animId: null,
  running: false,
  accuracyPercent: 100,
  songFinished: false,
};

// ===========================
// CANVAS SETUP
// ===========================
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ===========================
// AUDIO HIT SOUNDS (Web Audio API)
// Usa un AudioContext separado para los sonidos de golpe
// ya que Music.js administra su propio contexto.
// ===========================
let hitAudioCtx = null;
function getHitAudioCtx() {
  if (!hitAudioCtx) hitAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return hitAudioCtx;
}

// Genera la nota correspondiente según el carril (frecuencias de la escala de Re)
const NOTE_FREQS = [220, 293.66, 369.99, 440, 587.33]; // A3, D4, F#4, A4, D5

function playHitSound(lane, quality) {
  const ctx_a = getHitAudioCtx();
  const freq = NOTE_FREQS[lane] || 440;

  const osc = ctx_a.createOscillator();
  const gain = ctx_a.createGain();
  const filter = ctx_a.createBiquadFilter();

  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, ctx_a.currentTime);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.98, ctx_a.currentTime + 0.3);

  filter.type = 'lowpass';
  filter.frequency.value = 2200;

  const vol = quality === 'perfect' ? 0.35 : quality === 'good' ? 0.25 : 0.1;
  gain.gain.setValueAtTime(vol, ctx_a.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx_a.currentTime + 0.45);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx_a.destination);
  osc.start(ctx_a.currentTime);
  osc.stop(ctx_a.currentTime + 0.5);
}

function playMissSound() {
  const ctx_a = getHitAudioCtx();
  const noise = ctx_a.createOscillator();
  const gain = ctx_a.createGain();
  noise.type = 'sawtooth';
  noise.frequency.value = 120;
  gain.gain.setValueAtTime(0.08, ctx_a.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx_a.currentTime + 0.3);
  noise.connect(gain);
  gain.connect(ctx_a.destination);
  noise.start();
  noise.stop(ctx_a.currentTime + 0.3);
}

// ===========================
// LAYOUT HELPERS
// ===========================
function getLaneLayout() {
  const totalLaneWidth = Math.min(canvas.width * 0.7, 600);
  const laneW = totalLaneWidth / CONFIG.LANES;
  const startX = (canvas.width - totalLaneWidth) / 2;
  const hitY = canvas.height * CONFIG.HIT_Y_RATIO;
  return { startX, laneW, hitY, totalLaneWidth };
}

function getLaneCenterX(lane) {
  const { startX, laneW } = getLaneLayout();
  return startX + lane * laneW + laneW / 2;
}

// ===========================
// RECORD
// ===========================
function loadRecord() {
  const r = localStorage.getItem(getRecordKey());
  state.record = r ? parseInt(r) : 0;
  updateRecordDisplay();
}

function checkAndSaveRecord(score) {
  if (score > state.record) {
    state.record = score;
    localStorage.setItem(getRecordKey(), score);
    return true;
  }
  return false;
}

function updateRecordDisplay() {
  const el = document.getElementById('menu-record');
  if (el) el.textContent = state.record.toLocaleString();
  const hud = document.getElementById('record-hud');
  if (hud) hud.textContent = state.record.toLocaleString();
}

// ===========================
// SCREEN MANAGEMENT
// ===========================
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const screen = document.getElementById('screen-' + name);
  if (screen) screen.classList.add('active');
  state.screen = name;
  
  if (name === 'menu' && window.CameraTracker) {
    CameraTracker.stop();
  }
}

// ===========================
// FLOATING NOTES (menu animation)
// ===========================
const noteSymbols = ['♩', '♪', '♫', '♬', '𝄞', '𝄢', '♭', '♮', '♯'];
let floatInterval = null;

function startFloatingNotes() {
  const container = document.getElementById('floating-notes');
  if (!container) return;
  floatInterval = setInterval(() => {
    const el = document.createElement('div');
    el.className = 'float-note';
    el.textContent = noteSymbols[Math.floor(Math.random() * noteSymbols.length)];
    el.style.left = (Math.random() * 95) + '%';
    el.style.fontSize = (1.2 + Math.random() * 1.8) + 'rem';
    el.style.opacity = 0.5 + Math.random() * 0.5;
    const dur = 6 + Math.random() * 8;
    el.style.animation = `floatUp ${dur}s linear forwards`;
    el.style.color = `hsl(${40 + Math.random() * 20}, 70%, ${55 + Math.random() * 25}%)`;
    container.appendChild(el);
    setTimeout(() => el.remove(), dur * 1000);
  }, 700);
}

function stopFloatingNotes() {
  if (floatInterval) clearInterval(floatInterval);
}

// ===========================
// GAME INIT
// ===========================

// Color activo del puntero de cámara ('red' | 'green')
let activePointerColor = 'red';

function selectPointerColor(color) {
  activePointerColor = color;

  const redEl   = document.getElementById('color-opt-red');
  const greenEl = document.getElementById('color-opt-green');
  if (!redEl || !greenEl) return;

  // Estilos del botón ACTIVO: fondo sólido, texto blanco, opacidad completa
  // Estilos del botón INACTIVO: fondo transparente, opacidad baja
  if (color === 'red') {
    redEl.style.background   = '#e74c3c';
    redEl.style.borderColor  = '#e74c3c';
    redEl.style.opacity      = '1';
    redEl.querySelector('span').style.background = '#fff';
    redEl.querySelectorAll('span')[1].style.color = '#fff';

    greenEl.style.background  = 'transparent';
    greenEl.style.borderColor = '#2ecc71';
    greenEl.style.opacity     = '0.5';
    greenEl.querySelector('span').style.background = '#2ecc71';
    greenEl.querySelectorAll('span')[1].style.color = '#2ecc71';
  } else {
    greenEl.style.background  = '#2ecc71';
    greenEl.style.borderColor = '#2ecc71';
    greenEl.style.opacity     = '1';
    greenEl.querySelector('span').style.background = '#fff';
    greenEl.querySelectorAll('span')[1].style.color = '#fff';

    redEl.style.background   = 'transparent';
    redEl.style.borderColor  = '#e74c3c';
    redEl.style.opacity      = '0.5';
    redEl.querySelector('span').style.background = '#e74c3c';
    redEl.querySelectorAll('span')[1].style.color = '#ff6b6b';
  }

  if (window.CameraTracker) CameraTracker.setColor(color);
}
window.selectPointerColor = selectPointerColor;

async function startCameraGame(mode) {
  const loadingScreen = document.getElementById('loading-overlay');
  const loadingText   = document.getElementById('loading-text');
  
  if (loadingScreen) {
    loadingScreen.style.display = 'flex';
    loadingScreen.classList.add('active');
  }

  try {
    if (loadingText) loadingText.textContent = "Conectando Cámara...";
    // Pasar el color elegido directamente — se aplica antes del loop
    await CameraTracker.start(activePointerColor, msg => {
      if (loadingText) loadingText.textContent = msg;
    });
    startGame(mode || 'normal');
  } catch (err) {
    alert("No se pudo iniciar la cámara. Verifica los permisos o usa HTTPS/localhost.");
    console.error(err);
    if (loadingScreen) {
      loadingScreen.style.display = 'none';
      loadingScreen.classList.remove('active');
    }
  }
}

async function startGame(mode) {
  getHitAudioCtx(); // Unlock hit audio context on user gesture
  stopFloatingNotes();
  state.mode = mode || 'normal';
  
  if (lastAnalyzedSongId !== selectedSongId) {
    const loadingScreen = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');
    const loadingBar = document.getElementById('loading-bar');
    const songObj = SONGS[selectedSongId];
    
    if (loadingScreen) {
      loadingScreen.style.display = 'flex';
      loadingScreen.classList.add('active');
    }

    try {
      if (songObj.hasBeatmap && songObj.beatmapUrl) {
        // 1) CACHÉ: Descargar la partitura ya procesada directamente
        if (loadingText) loadingText.textContent = `Cargando partitura de ${songObj.title}...`;
        const res = await fetch(songObj.beatmapUrl);
        const savedMap = await res.json();
        
        window.DYNAMIC_PARTITURA_NORMAL = savedMap.normal;
        window.DYNAMIC_PARTITURA_HARD = savedMap.hard;
        lastAnalyzedSongId = selectedSongId;
      } else {
        // 2) NUEVA PISTA: Analizar al vuelo por primera vez
        if (loadingText) loadingText.textContent = `Afinando ${songObj.title} (Primera vez)...`;
        const result = await AudioAnalyzer.analyzeMusicUrl(
          songObj.file, 
          (msg) => {
            if (loadingText) loadingText.textContent = msg;
            if (loadingBar) {
              let currentW = parseFloat(loadingBar.style.width) || 0;
              loadingBar.style.width = Math.min(currentW + 20, 95) + '%';
            }
          }
        );

        if (result) {
          window.DYNAMIC_PARTITURA_NORMAL = result.normal;
          window.DYNAMIC_PARTITURA_HARD = result.hard;
          lastAnalyzedSongId = selectedSongId;
          
          // Enviar la partitura al servidor para guardarla físicamente
          try {
            if (loadingText) loadingText.textContent = "Guardando partitura en caché...";
            await fetch('/api/save-beatmap', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                folder: songObj.folder,
                partitura: result
              })
            });
            songObj.hasBeatmap = true;
            songObj.beatmapUrl = `/assets/cancion/${songObj.folder}/Pista/partitura.json`;
          } catch(e) {
            console.error("Error al guardar beatmap en el servidor:", e);
          }
        }
      }
    } catch (e) {
      console.error("Fallo al preparar audio/partitura:", e);
    } finally {
      if (loadingScreen) {
        loadingScreen.style.display = 'none';
        loadingScreen.classList.remove('active');
        if (loadingBar) loadingBar.style.width = '100%';
      }
    }
  }

  resetGameState();
  
  const partitura = (mode === 'hard') 
    ? (window.DYNAMIC_PARTITURA_HARD || PARTITURA_HARD)
    : (window.DYNAMIC_PARTITURA_NORMAL || PARTITURA_NORMAL);

  // Calcular tiempo de anticipación: cuánto tiempo tarda una nota en caer
  const { hitY } = getLaneLayout();
  const fallTime = (hitY / CONFIG.NOTE_SPEED) * 1000; // ms

  // Preparar cola de notas: cada nota se spawn `fallTime` ms ANTES de su tiempo objetivo
  state.noteQueue = partitura.map((n, idx) => ({
    ...n,
    id: idx,
    spawnTime: n.time - fallTime,
    hit: false,
    missed: false,
  })).filter(n => n.spawnTime >= -500);

  state.totalNotes = state.noteQueue.length;
  state.nextNoteIndex = 0;
  state.running = true;
  state.songFinished = false;

  // Update song title
  document.getElementById('song-title').textContent =
    (mode === 'hard' ? '🔥 DIFÍCIL – ' : '') + SONGS[selectedSongId].title;

  showScreen('game');
  updateHUD();
  if (state.animId) cancelAnimationFrame(state.animId);

  // Cargar pista en el contexto de audio y reproducir
  Music.load(SONGS[selectedSongId].file);
  Music.start(0);

  gameLoop();
}

function resetGameState() {
  state.score = 0;
  state.combo = 0;
  state.maxCombo = 0;
  state.hitCount = 0;
  state.missCount = 0;
  state.notes = [];
  state.noteQueue = [];
  state.particles = [];
  state.elapsed = 0;
  state.accuracyPercent = 100;
  state.lanePressed = [false, false, false, false, false];
  state.laneFlash = [0, 0, 0, 0, 0];
  state.running = false;
  state.songFinished = false;
}

// ===========================
// PAUSE / RESUME
// ===========================
function pauseGame() {
  if (!state.running) return;
  state.running = false;
  // Pausar música exactamente
  Music.pause();
  document.getElementById('pause-score-val').textContent = state.score.toLocaleString();
  showScreen('pause');
}

function resumeGame() {
  if (state.running) return;
  state.running = true;
  // Reanudar música (el tiempo de audio se preserva automáticamente)
  Music.resume();
  showScreen('game');
  gameLoop();
}

function restartGame() {
  if (state.animId) cancelAnimationFrame(state.animId);
  Music.stop();
  startGame(state.mode);
}

function goToMenu() {
  if (state.animId) cancelAnimationFrame(state.animId);
  state.running = false;
  // Detener música al volver al menú
  Music.stop();
  updateRecordDisplay();
  showScreen('menu');
  startFloatingNotes();
}

function exitGame() {
  window.close();
  // fallback
  document.body.innerHTML = '<div style="color:#c9a84c;font-size:2rem;text-align:center;margin-top:40vh;font-family:serif;">¡Hasta pronto! Puedes cerrar esta ventana.</div>';
}

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// ===========================
// GAME LOOP
// ===========================
function gameLoop() {
  if (!state.running) return;

  // Sincronización perfecta: El juego usa el tiempo devuelto por el archivo de audio
  state.elapsed = Music.getCurrentTimeMs();

  // Spawn notes that should now appear
  while (
    state.nextNoteIndex < state.noteQueue.length &&
    state.noteQueue[state.nextNoteIndex].spawnTime <= state.elapsed
  ) {
    const noteData = state.noteQueue[state.nextNoteIndex];
    spawnNote(noteData);
    state.nextNoteIndex++;
  }

  // Update particles
  updateParticles();

  // Draw everything
  drawFrame();

  // Check for missed notes
  checkMissedNotes();

  const songObj = SONGS[selectedSongId];
  const customEndTime = songObj.metadata && songObj.metadata.endTime;
  const musicDuration = Music.getDurationMs();
  const effectiveDuration = customEndTime ? customEndTime : (musicDuration > 0 ? musicDuration : 190000);

  // Update time UI
  const timeDisplay = document.getElementById('time-display');
  const timeTotal = document.getElementById('time-total');
  if (timeDisplay && timeTotal) {
    timeDisplay.textContent = formatTime(state.elapsed);
    timeTotal.textContent = formatTime(effectiveDuration);
  }

  // Check if song is done
  if (!state.songFinished) {
    // Termina si el audio llegó a su fin (o a su endTime predeterminado) y ya no hay notas
    if (state.elapsed >= effectiveDuration - 100) {
      if (state.notes.length === 0 && state.nextNoteIndex >= state.noteQueue.length) {
        state.songFinished = true;
        endGame();
        return;
      }
    }
  }

  state.animId = requestAnimationFrame(gameLoop);
}

// ===========================
// NOTE SPAWNING
// ===========================
function spawnNote(noteData) {
  const { startX, laneW } = getLaneLayout();
  const x = startX + noteData.lane * laneW;
  const h = noteData.type === 'long' ? CONFIG.NOTE_HEIGHT_LONG : CONFIG.NOTE_HEIGHT;

  state.notes.push({
    id: noteData.id,
    lane: noteData.lane,
    targetTime: noteData.time,
    type: noteData.type,
    x: x,
    y: -h,
    w: laneW * CONFIG.NOTE_WIDTH_RATIO,
    h: h,
    color: CONFIG.LANE_COLORS[noteData.lane],
    glow: CONFIG.LANE_COLORS_GLOW[noteData.lane],
    hit: false,
    missed: false,
    hitAnim: 0,
  });
}

// ===========================
// DRAWING
// ===========================
function drawFrame() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const { startX, laneW, hitY, totalLaneWidth } = getLaneLayout();
  const now = performance.now();

  // Draw dark game area overlay (lanes background)
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(startX - 2, 0, totalLaneWidth + 4, canvas.height);

  // Draw lane separators
  for (let i = 0; i <= CONFIG.LANES; i++) {
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(startX + i * laneW, 0);
    ctx.lineTo(startX + i * laneW, canvas.height);
    ctx.stroke();
  }

  // Draw lane flash (when key pressed)
  for (let i = 0; i < CONFIG.LANES; i++) {
    const flash = state.laneFlash[i];
    if (flash > 0) {
      const alpha = Math.min(flash / 10, 0.18);
      ctx.fillStyle = CONFIG.LANE_COLORS[i].replace(')', `,${alpha})`).replace('rgb', 'rgba');
      const gradient = ctx.createLinearGradient(0, hitY - 80, 0, canvas.height);
      gradient.addColorStop(0, 'transparent');
      gradient.addColorStop(1, CONFIG.LANE_COLORS_GLOW[i]);
      ctx.fillStyle = gradient;
      ctx.fillRect(startX + i * laneW, hitY - 80, laneW, canvas.height - hitY + 80);
      state.laneFlash[i] = Math.max(0, flash - 1);
    }
  }

  // Draw hit zone line
  const hitZoneGradient = ctx.createLinearGradient(startX, hitY, startX + totalLaneWidth, hitY);
  for (let i = 0; i < CONFIG.LANES; i++) {
    const stop = i / (CONFIG.LANES - 1);
    hitZoneGradient.addColorStop(stop, CONFIG.LANE_COLORS[i]);
  }
  ctx.strokeStyle = hitZoneGradient;
  ctx.lineWidth = 3;
  ctx.shadowBlur = 10;
  ctx.shadowColor = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.moveTo(startX, hitY);
  ctx.lineTo(startX + totalLaneWidth, hitY);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Draw hit zone buttons (circle targets)
  for (let i = 0; i < CONFIG.LANES; i++) {
    const cx = startX + i * laneW + laneW / 2;
    const pressed = state.lanePressed[i];

    // Outer ring
    ctx.beginPath();
    ctx.arc(cx, hitY, laneW * 0.36, 0, Math.PI * 2);
    ctx.strokeStyle = CONFIG.LANE_COLORS[i];
    ctx.lineWidth = pressed ? 4 : 2.5;
    ctx.shadowBlur = pressed ? 20 : 8;
    ctx.shadowColor = CONFIG.LANE_COLORS[i];
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Inner fill
    ctx.beginPath();
    ctx.arc(cx, hitY, laneW * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = pressed
      ? CONFIG.LANE_COLORS[i]
      : `rgba(0,0,0,0.5)`;
    ctx.fill();
  }

  // Update and draw notes
  const deltaRatio = CONFIG.NOTE_SPEED / 1000; // px per ms
  state.notes = state.notes.filter(note => {
    const msToTarget = note.targetTime - state.elapsed;
    const distFromHit = msToTarget * deltaRatio; // positive = above hit zone
    note.y = hitY - distFromHit - note.h / 2;

    if (note.hit) {
      note.hitAnim += 2;
      if (note.hitAnim > 20) return false; // Remove after 20 frames
      const alpha = 1 - note.hitAnim / 20;
      drawNote(note, startX, laneW, alpha, note.hitAnim * 0.5);
    } else if (note.missed) {
      note.hitAnim += 2;
      if (note.hitAnim > 20) return false;
      const alpha = 1 - note.hitAnim / 20;
      drawNote(note, startX, laneW, alpha * 0.4, 0, true);
    } else {
      drawNote(note, startX, laneW, 1, 0);
    }
    return true;
  });

  // Draw particles
  drawParticles();
}

function drawNote(note, startX, laneW, alpha, expandPx, dimmed) {
  const nx = startX + note.lane * laneW + (laneW - note.w) / 2 - expandPx;
  const nw = note.w + expandPx * 2;
  const nh = note.h;
  const ny = note.y;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Glow effect
  ctx.shadowBlur = dimmed ? 0 : 18;
  ctx.shadowColor = note.glow;

  // Gradient fill
  const grad = ctx.createLinearGradient(nx, ny, nx, ny + nh);
  if (dimmed) {
    grad.addColorStop(0, 'rgba(100,100,100,0.5)');
    grad.addColorStop(1, 'rgba(60,60,60,0.3)');
  } else {
    const baseColor = note.color;
    grad.addColorStop(0, lightenColor(baseColor, 60));
    grad.addColorStop(0.3, baseColor);
    grad.addColorStop(1, darkenColor(baseColor, 40));
  }

  // Draw rounded rect
  roundRect(ctx, nx, ny, nw, nh, CONFIG.NOTE_BORDER_RADIUS);
  ctx.fillStyle = grad;
  ctx.fill();

  // Glossy top highlight
  if (!dimmed) {
    ctx.shadowBlur = 0;
    const gloss = ctx.createLinearGradient(nx, ny, nx, ny + nh * 0.4);
    gloss.addColorStop(0, 'rgba(255,255,255,0.35)');
    gloss.addColorStop(1, 'rgba(255,255,255,0)');
    roundRect(ctx, nx + 2, ny + 2, nw - 4, nh * 0.4, CONFIG.NOTE_BORDER_RADIUS - 2);
    ctx.fillStyle = gloss;
    ctx.fill();
  }

  // Border
  ctx.strokeStyle = dimmed ? 'rgba(100,100,100,0.3)' : 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, nx, ny, nw, nh, CONFIG.NOTE_BORDER_RADIUS);
  ctx.stroke();

  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function lightenColor(hex, amount) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, (num >> 16) + amount);
  const g = Math.min(255, ((num >> 8) & 0xff) + amount);
  const b = Math.min(255, (num & 0xff) + amount);
  return `rgb(${r},${g},${b})`;
}

function darkenColor(hex, amount) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, (num >> 16) - amount);
  const g = Math.max(0, ((num >> 8) & 0xff) - amount);
  const b = Math.max(0, (num & 0xff) - amount);
  return `rgb(${r},${g},${b})`;
}

// ===========================
// PARTICLES
// ===========================
function spawnParticles(lane, quality) {
  const { startX, laneW, hitY } = getLaneLayout();
  const cx = startX + lane * laneW + laneW / 2;
  const count = quality === 'perfect' ? 18 : 10;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const speed = 2 + Math.random() * 4;
    state.particles.push({
      x: cx, y: hitY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 2,
      life: 1,
      decay: 0.04 + Math.random() * 0.04,
      size: 3 + Math.random() * 5,
      color: CONFIG.LANE_COLORS[lane],
    });
  }
  // Musical note symbol particle
  if (quality === 'perfect') {
    const symbols = ['♪', '♫', '♬'];
    state.particles.push({
      x: cx, y: hitY - 20,
      vx: (Math.random() - 0.5) * 2,
      vy: -4,
      life: 1,
      decay: 0.025,
      size: 22,
      color: CONFIG.LANE_COLORS[lane],
      symbol: symbols[Math.floor(Math.random() * symbols.length)],
    });
  }
}

function updateParticles() {
  state.particles.forEach(p => {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.1; // gravity
    p.life -= p.decay;
  });
  state.particles = state.particles.filter(p => p.life > 0);
}

function drawParticles() {
  state.particles.forEach(p => {
    ctx.save();
    ctx.globalAlpha = p.life;
    if (p.symbol) {
      ctx.fillStyle = p.color;
      ctx.font = `${p.size}px serif`;
      ctx.textAlign = 'center';
      ctx.shadowBlur = 10;
      ctx.shadowColor = p.color;
      ctx.fillText(p.symbol, p.x, p.y);
    } else {
      ctx.fillStyle = p.color;
      ctx.shadowBlur = 8;
      ctx.shadowColor = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  });
}

// ===========================
// HIT DETECTION
// ===========================
function handleKeyPress(lane) {
  if (!state.running || state.screen !== 'game') return;

  state.lanePressed[lane] = true;
  state.laneFlash[lane] = 15;

  // Flash the key label
  const keyEl = document.getElementById('key-' + CONFIG.LANE_KEYS[lane]);
  if (keyEl) {
    keyEl.classList.add('pressed');
    setTimeout(() => keyEl.classList.remove('pressed'), 120);
  }

  // Find the closest unhit note in this lane
  const hitY = canvas.height * CONFIG.HIT_Y_RATIO;
  let best = null;
  let bestDiff = Infinity;

  for (const note of state.notes) {
    if (note.lane !== lane || note.hit || note.missed) continue;
    const diff = Math.abs(note.targetTime - state.elapsed);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = note;
    }
  }

  if (best && bestDiff <= CONFIG.HIT_WINDOW_GOOD) {
    const quality = bestDiff <= CONFIG.HIT_WINDOW_PERFECT ? 'perfect' : 'good';
    registerHit(best, quality);
  }
  // else: no note nearby = no penalty (notes will auto-miss when they pass)
}

function registerHit(note, quality) {
  note.hit = true;
  note.hitAnim = 0;

  const points = quality === 'perfect' ? CONFIG.SCORE_PERFECT : CONFIG.SCORE_GOOD;
  state.combo++;
  if (state.combo > state.maxCombo) state.maxCombo = state.combo;

  // Combo multiplier capped at x4
  const multiplier = Math.min(Math.ceil(state.combo / 10), 4);
  state.score += points * multiplier;
  state.hitCount++;

  playHitSound(note.lane, quality);
  spawnParticles(note.lane, quality);

  showHitFeedback(quality === 'perfect' ? '✨ PERFECTO' : '👍 BIEN', quality);
  updateHUD();
}

function checkMissedNotes() {
  const { hitY } = getLaneLayout();
  for (const note of state.notes) {
    if (note.hit || note.missed) continue;
    // Note passed the hit zone by more than the good window
    if (state.elapsed > note.targetTime + CONFIG.HIT_WINDOW_GOOD + 100) {
      note.missed = true;
      note.hitAnim = 0;
      state.combo = 0;
      state.missCount++;
      playMissSound();
      showHitFeedback('MISS', 'miss');
      updateHUD();
    }
  }
}

// ===========================
// UI FEEDBACK
// ===========================
let feedbackTimeout = null;
function showHitFeedback(text, cls) {
  const el = document.getElementById('hit-feedback');
  if (!el) return;
  if (feedbackTimeout) clearTimeout(feedbackTimeout);
  el.textContent = text;
  el.className = 'hit-feedback ' + cls;
  feedbackTimeout = setTimeout(() => {
    el.className = 'hit-feedback';
    el.textContent = '';
  }, 750);
}

function updateHUD() {
  document.getElementById('score-display').textContent = state.score.toLocaleString();
  const combo = state.combo;
  const mult = Math.min(Math.ceil(combo / 10), 4);
  const comboEl = document.getElementById('combo-display');
  if (comboEl) {
    comboEl.textContent = combo > 1 ? `x${mult} (${combo})` : 'x1';
    comboEl.style.color = combo >= 20 ? '#f0d080' : combo >= 10 ? '#2ecc71' : 'rgba(255,255,255,0.8)';
  }

  // Accuracy bar
  const total = state.hitCount + state.missCount;
  state.accuracyPercent = total > 0 ? Math.round((state.hitCount / total) * 100) : 100;
  const fill = document.getElementById('accuracy-fill');
  if (fill) fill.style.width = state.accuracyPercent + '%';

  updateRecordDisplay();
}

// ===========================
// GAME END
// ===========================
function endGame() {
  state.running = false;
  if (state.animId) cancelAnimationFrame(state.animId);
  // Detener música al finalizar el juego
  Music.stop();

  const total = state.hitCount + state.missCount;
  const accuracy = total > 0 ? Math.round((state.hitCount / total) * 100) : 0;
  const isNewRecord = checkAndSaveRecord(state.score);

  document.getElementById('final-score').textContent = state.score.toLocaleString();
  document.getElementById('final-record').textContent = state.record.toLocaleString();
  document.getElementById('final-hits').textContent = state.hitCount;
  document.getElementById('final-accuracy').textContent = accuracy + '%';

  const badge = document.getElementById('new-record-badge');
  if (badge) badge.classList.toggle('hidden', !isNewRecord);

  const title = document.getElementById('gameover-title');
  if (title) {
    if (accuracy >= 90) title.textContent = '🌟 ¡Actuación Magistral!';
    else if (accuracy >= 70) title.textContent = '🎼 ¡Gran Concierto!';
    else if (accuracy >= 50) title.textContent = '🎵 Buen Intento';
    else title.textContent = '🎭 Concierto Finalizado';
  }

  showScreen('gameover');
}

// ===========================
// KEYBOARD INPUT
// ===========================
const KEY_MAP = { a: 0, s: 1, d: 2, f: 3, g: 4 };

document.addEventListener('keydown', (e) => {
  const lowerKey = e.key.toLowerCase();
  if (lowerKey === 'escape') {
    if (state.screen === 'game' && state.running) pauseGame();
    else if (state.screen === 'pause') resumeGame();
    return;
  }
  if (lowerKey === 'r' && (state.screen === 'game' || state.screen === 'pause')) {
    restartGame();
    return;
  }
  const lane = KEY_MAP[lowerKey];
  if (lane !== undefined && !e.repeat) {
    handleKeyPress(lane);
  }
});

document.addEventListener('keyup', (e) => {
  const lane = KEY_MAP[e.key.toLowerCase()];
  if (lane !== undefined) {
    state.lanePressed[lane] = false;
  }
});

// ===========================
// MOBILE / TOUCH SUPPORT (lane buttons)
// ===========================
document.querySelectorAll('.lane-key').forEach((el, i) => {
  el.style.pointerEvents = 'auto';
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handleKeyPress(i);
  });
});

// ===========================
// INIT
// ===========================
window.addEventListener('DOMContentLoaded', () => {
  fetchSongs();
  showScreen('menu');
  startFloatingNotes();
});

// ===========================
// SELECCIÓN DE CANCIÓN UI
// ===========================
function selectSong(id) {
  if (SONGS[id]) {
    selectedSongId = id;
    loadRecord(); // Actualiza el récord visual de la canción
  }
}

// Expose functions to HTML onclick handlers
window.selectSong = selectSong;
window.startGame = startGame;
window.startCameraGame = startCameraGame;
window.pauseGame = pauseGame;
window.resumeGame = resumeGame;
window.restartGame = restartGame;
window.goToMenu = goToMenu;
window.exitGame = exitGame;

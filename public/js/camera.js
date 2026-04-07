/**
 * camera.js
 *
 * Detección de puntero por color (HSV + dominancia RGB) en tiempo real.
 * Soporta detección de ROJO o VERDE según la elección del usuario.
 *
 * API pública:
 *   CameraTracker.setColor('red' | 'green')  ← llama antes de start()
 *   CameraTracker.start(onProgress)
 *   CameraTracker.stop()
 *   CameraTracker.toggleDebug()              ← o tecla D durante el juego
 */

'use strict';

const CameraTracker = (() => {
  let isRunning   = false;
  let videoElement;
  let offCanvas;
  let offCtx;
  let pointer;
  let animFrameId;

  let currentLane = -1;
  let pressedLane = -1;

  // ─── PANEL DE DEBUG ────────────────────────────────────────────────────────
  let debugMode   = false;
  let debugCanvas = null;
  let debugCtx    = null;

  // ─── PERFILES DE COLOR ────────────────────────────────────────────────────
  const COLOR_PROFILES = {
    red: {
      name:           'rojo',
      // Hue en HSV: [0°–H_HIGH1] + [H_LOW2–360°]  (rojo ocupa los dos extremos)
      H_HIGH1:        20,
      H_LOW2:         340,
      S_MIN:          0.40,
      V_MIN:          0.20,
      // Dominancia RGB: R > G+RG  y  R > B+RB
      DOM_CH1_CH2:    20,   // R - G
      DOM_CH1_CH3:    25,   // R - B
      // Canal dominante (índice 0=R, 1=G, 2=B)
      dominant:       0,
      // Visual del puntero en pantalla
      colorUp:        '#ff6666',
      colorDown:      '#ff3333',
      shadowUp:       'rgba(255,80,80,0.8)',
      shadowDown:     'rgba(255,50,50,1)',
      debugHighlight: [0, 255, 80],    // color de resalte en debug (RGB)
      debugBorder:    '#ff4444',
    },
    green: {
      name:           'verde',
      // Hue en HSV: [H_LOW1–H_HIGH1] (verde ocupa el centro del espectro)
      H_LOW1:         85,
      H_HIGH1:        155,
      H_LOW2:         null,  // sin segundo rango
      S_MIN:          0.40,
      V_MIN:          0.20,
      // Dominancia RGB: G > R+RG  y  G > B+RB
      DOM_CH1_CH2:    20,   // G - R
      DOM_CH1_CH3:    20,   // G - B
      dominant:       1,
      colorUp:        '#55ee88',
      colorDown:      '#22cc55',
      shadowUp:       'rgba(50,200,80,0.8)',
      shadowDown:     'rgba(30,180,60,1)',
      debugHighlight: [255, 80, 0],
      debugBorder:    '#22cc55',
    },
  };

  let profile = COLOR_PROFILES.red;   // perfil activo

  // ─── AJUSTES FIJOS ────────────────────────────────────────────────────────
  const MIN_COLOR_PIXELS  = 50;
  const Y_THRESHOLD       = 0.55;
  const ACTIVE_ZONE_LEFT  = 0.10;
  const ACTIVE_ZONE_RIGHT = 0.90;
  const PROC_W = 160;
  const PROC_H = 120;
  const KEYS   = ['a', 's', 'd', 'f', 'g'];

  // ─── HELPERS ──────────────────────────────────────────────────────────────
  function triggerKeyDown(k) { document.dispatchEvent(new KeyboardEvent('keydown', { key: k })); }
  function triggerKeyUp(k)   { document.dispatchEvent(new KeyboardEvent('keyup',   { key: k })); }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    const s = max === 0 ? 0 : d / max;
    const v = max;
    if (d !== 0) {
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return { h: h * 360, s, v };
  }

  /** Comprueba si el píxel RGB pertenece al color activo (rojo o verde). */
  function isTargetPixel(r, g, b) {
    const p = profile;
    const ch = [r, g, b];
    const dom = ch[p.dominant];

    // Capa 1 — dominancia RGB rápida
    const other1 = ch[(p.dominant + 1) % 3];
    const other2 = ch[(p.dominant + 2) % 3];
    if (dom - other1 < p.DOM_CH1_CH2) return false;
    if (dom - other2 < p.DOM_CH1_CH3) return false;

    // Capa 2 — HSV
    const { h, s, v } = rgbToHsv(r, g, b);
    if (s < p.S_MIN || v < p.V_MIN) return false;

    // Rango de matiz
    if (p.H_LOW2 !== null) {
      // Dos rangos (rojo)
      return h <= p.H_HIGH1 || h >= p.H_LOW2;
    } else {
      // Un rango continuo (verde)
      return h >= p.H_LOW1 && h <= p.H_HIGH1;
    }
  }

  // ─── DETECCIÓN PRINCIPAL ──────────────────────────────────────────────────
  function detectCentroid() {
    offCtx.drawImage(videoElement, 0, 0, PROC_W, PROC_H);
    const imageData = offCtx.getImageData(0, 0, PROC_W, PROC_H);
    const data = imageData.data;

    let sumX = 0, sumY = 0, count = 0;
    let debugData = null;
    if (debugMode && debugCtx) debugData = new Uint8ClampedArray(data);

    for (let y = 0; y < PROC_H; y++) {
      for (let x = 0; x < PROC_W; x++) {
        const idx = (y * PROC_W + x) * 4;
        if (isTargetPixel(data[idx], data[idx + 1], data[idx + 2])) {
          sumX += x; sumY += y; count++;
          if (debugData) {
            const [dr, dg, db] = profile.debugHighlight;
            debugData[idx] = dr; debugData[idx + 1] = dg; debugData[idx + 2] = db;
          }
        }
      }
    }

    // Renderizar debug
    if (debugMode && debugCtx && debugData) {
      const dw = debugCanvas.width, dh = debugCanvas.height;
      offCtx.putImageData(new ImageData(debugData, PROC_W, PROC_H), 0, 0);
      debugCtx.drawImage(offCanvas, 0, 0, dw, dh);

      debugCtx.font = 'bold 13px monospace';
      debugCtx.fillStyle = count >= MIN_COLOR_PIXELS ? '#00ff50' : '#ff4444';
      debugCtx.fillText(`${profile.name}: ${count} / min ${MIN_COLOR_PIXELS}`, 6, 18);

      if (count >= MIN_COLOR_PIXELS) {
        const cx = (sumX / count / PROC_W) * dw;
        const cy = (sumY / count / PROC_H) * dh;
        debugCtx.strokeStyle = '#fff';
        debugCtx.lineWidth = 2;
        debugCtx.beginPath(); debugCtx.arc(cx, cy, 8, 0, Math.PI * 2); debugCtx.stroke();
        debugCtx.beginPath();
        debugCtx.moveTo(cx - 12, cy); debugCtx.lineTo(cx + 12, cy);
        debugCtx.moveTo(cx, cy - 12); debugCtx.lineTo(cx, cy + 12);
        debugCtx.stroke();
      }

      const yLine = Y_THRESHOLD * dh;
      debugCtx.strokeStyle = 'rgba(255,200,0,0.8)';
      debugCtx.lineWidth = 1;
      debugCtx.setLineDash([4, 3]);
      debugCtx.beginPath(); debugCtx.moveTo(0, yLine); debugCtx.lineTo(dw, yLine); debugCtx.stroke();
      debugCtx.setLineDash([]);
      debugCtx.fillStyle = 'rgba(255,200,0,0.95)';
      debugCtx.font = '11px monospace';
      debugCtx.fillText('GOLPE', 4, yLine - 3);
    }

    if (count < MIN_COLOR_PIXELS) return null;
    return { x: sumX / count / PROC_W, y: sumY / count / PROC_H };
  }

  // ─── LOOP PRINCIPAL ───────────────────────────────────────────────────────
  function loop() {
    if (!isRunning) return;
    const centroid = detectCentroid();

    if (centroid) {
      const mappedX = 1.0 - centroid.x;
      const mappedY = centroid.y;

      pointer.style.display = 'block';
      pointer.style.left = `${mappedX * 100}vw`;
      pointer.style.top  = `${mappedY * 100}vh`;

      const normalizedX = (mappedX - ACTIVE_ZONE_LEFT) / (ACTIVE_ZONE_RIGHT - ACTIVE_ZONE_LEFT);
      const clampedX    = Math.max(0, Math.min(1, normalizedX));
      let lane = Math.floor(clampedX * 5);
      if (lane > 4) lane = 4;
      currentLane = lane;

      if (pressedLane !== -1 && pressedLane !== currentLane) {
        triggerKeyUp(KEYS[pressedLane]);
        pressedLane = -1;
      }

      if (mappedY > Y_THRESHOLD) {
        pointer.style.transform  = 'translate(-50%, -50%) scale(0.8)';
        pointer.style.background = profile.colorDown;
        pointer.style.boxShadow  = `0 0 30px 12px ${profile.shadowDown}`;
        if (pressedLane === -1) { pressedLane = currentLane; triggerKeyDown(KEYS[pressedLane]); }
      } else {
        pointer.style.transform  = 'translate(-50%, -50%) scale(1.2)';
        pointer.style.background = profile.colorUp;
        pointer.style.boxShadow  = `0 0 15px 5px ${profile.shadowUp}`;
        if (pressedLane !== -1) { triggerKeyUp(KEYS[pressedLane]); pressedLane = -1; }
      }
    } else {
      pointer.style.display = 'none';
      if (pressedLane !== -1) { triggerKeyUp(KEYS[pressedLane]); pressedLane = -1; }
    }

    animFrameId = requestAnimationFrame(loop);
  }

  // ─── DEBUG PANEL ──────────────────────────────────────────────────────────
  function createDebugPanel() {
    if (debugCanvas) return;
    debugCanvas = document.createElement('canvas');
    debugCanvas.id = 'camera-debug-canvas';
    debugCanvas.width = 200; debugCanvas.height = 150;
    Object.assign(debugCanvas.style, {
      position: 'fixed', bottom: '80px', right: '12px',
      width: '200px', height: '150px',
      border: `2px solid ${profile.debugBorder}`,
      borderRadius: '8px', zIndex: '9999', background: '#000',
      boxShadow: `0 0 12px ${profile.shadowDown}`,
    });
    document.body.appendChild(debugCanvas);
    debugCtx = debugCanvas.getContext('2d');

    const label = document.createElement('div');
    label.id = 'camera-debug-label';
    Object.assign(label.style, {
      position: 'fixed', bottom: '235px', right: '12px',
      color: profile.debugBorder, fontFamily: 'monospace', fontSize: '11px',
      zIndex: '9999', background: 'rgba(0,0,0,0.7)', padding: '2px 6px', borderRadius: '4px',
    });
    label.textContent = `🎯 Debug (${profile.name})  [D]=ocultar`;
    document.body.appendChild(label);
  }

  function removeDebugPanel() {
    const c = document.getElementById('camera-debug-canvas');
    const l = document.getElementById('camera-debug-label');
    if (c) c.remove(); if (l) l.remove();
    debugCanvas = null; debugCtx = null;
  }

  function toggleDebug() {
    debugMode = !debugMode;
    if (debugMode) createDebugPanel(); else removeDebugPanel();
  }

  // ─── INIT ─────────────────────────────────────────────────────────────────
  function init() {
    videoElement = document.getElementById('input-video');
    pointer      = document.getElementById('hand-pointer');

    offCanvas = document.createElement('canvas');
    offCanvas.width = PROC_W; offCanvas.height = PROC_H;
    offCtx = offCanvas.getContext('2d', { willReadFrequently: true });

    document.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'd' && isRunning) toggleDebug();
    });
  }

  // ─── API PÚBLICA ──────────────────────────────────────────────────────────
  return {
    /** Seleccionar color antes de start(): 'red' o 'green' */
    setColor(colorName) {
      if (COLOR_PROFILES[colorName]) {
        profile = COLOR_PROFILES[colorName];
        // Actualizar borde del puntero visual para que coincida con el color
        const p = document.getElementById('hand-pointer');
        if (p) p.style.background = profile.colorUp;
      }
    },

    start: async (color, onProgress) => {
      // Aplicar el perfil de color ANTES de todo — garantizado
      if (color && COLOR_PROFILES[color]) {
        profile = COLOR_PROFILES[color];
      }
      console.log('[Camera] Perfil activo:', profile.name);

      if (isRunning) {
        // Si ya estaba corriendo (ej. segunda partida), solo actualizar el color
        return true;
      }
      if (!videoElement) init();
      if (onProgress) onProgress('Iniciando cámara web...');

      return new Promise((resolve, reject) => {
        navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false })
          .then(stream => {
            videoElement.srcObject = stream;
            videoElement.play();
            videoElement.onloadedmetadata = () => {
              isRunning = true;
              if (onProgress) onProgress(`¡Cámara lista! Usa un objeto ${profile.name.toUpperCase()}.  [D]=debug`);
              loop();
              resolve(true);
            };
          })
          .catch(err => { console.error('Camera error:', err); reject(err); });
      });
    },

    stop: () => {
      isRunning = false;
      if (animFrameId) cancelAnimationFrame(animFrameId);
      if (videoElement && videoElement.srcObject) {
        videoElement.srcObject.getTracks().forEach(t => t.stop());
        videoElement.srcObject = null;
      }
      if (pointer) pointer.style.display = 'none';
      if (pressedLane !== -1) { triggerKeyUp(KEYS[pressedLane]); pressedLane = -1; }
      if (debugMode) { removeDebugPanel(); debugMode = false; }
    },

    toggleDebug,
  };
})();

/**
 * music.js – Reproductor de la canción real (lacrimosa.m4a)
 * 
 * Se encarga de cargar y reproducir el archivo m4a.
 * Expone getCurrentTimeMs() para que el juego se sincronice PERFECTAMENTE
 * con la pista de audio (así la partitura sigue a la música real).
 */

'use strict';

const Music = (() => {
  let audio = new Audio();
  audio.preload = 'auto'; // Forzar precarga
  
  let isReady = false;

  audio.addEventListener('canplaythrough', () => {
    isReady = true;
    console.log("Audio real cargado y listo para reproducir.");
  });

  return {
    load: (url) => {
      isReady = false;
      audio.src = url;
      audio.load();
    },
    start: (offsetMs = 0) => {
      audio.currentTime = offsetMs / 1000;
      audio.play().catch(e => console.warn("Error al reproducir audio:", e));
    },
    pause: () => {
      audio.pause();
    },
    resume: () => {
      audio.play().catch(e => console.warn("Error al reproducir audio:", e));
    },
    stop: () => {
      audio.pause();
      audio.currentTime = 0;
    },
    getCurrentTimeMs: () => {
      return audio.currentTime * 1000;
    },
    getDurationMs: () => {
      return (audio.duration || 0) * 1000;
    },
    isReady: () => isReady,
    setVolume: (v) => {
      audio.volume = v;
    }
  };
})();

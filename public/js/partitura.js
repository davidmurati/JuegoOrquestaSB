/**
 * partitura.js
 * 
 * Generación estática de la partitura de Lacrimosa (Requiem - Mozart).
 * Basado en el PDF y en la métrica de 12/8 a tempo lento (aprox. 48 BPM).
 */

const SONG_TITLE = "Requiem en Re Menor - Lacrimosa";
const SONG_DURATION = 190000; // ~3m 10s total
const OFFSET_MS = 800; // Tiempo de silencio antes de la primera nota

// Lacrimosa se dirige a unos 48-50 BPM, compás 12/8
// Cada pulso (corchea con puntillo) dura:
const BPM = 49;
const BEAT_MS = 60000 / BPM;    // ~1224 ms por negra con puntillo
const EIGHTH_MS = BEAT_MS / 3;  // ~408 ms por corchea

const PARTITURA_NORMAL = [];
const PARTITURA_HARD = [];

function addNote(ms, lane, length = 'normal') {
  const time = Math.floor(OFFSET_MS + ms);
  // normal mode gets simpler notes
  if (Math.random() > 0.3 || length === 'long') {
    PARTITURA_NORMAL.push({ time, lane: lane === 0 || lane === 4 ? 2 : lane, type: length });
  }
  PARTITURA_HARD.push({ time, lane, type: length });
}

// ==========================================
// COREOGRAFÍA BASADA EN LA PARTITURA (PDF)
// ==========================================

// --- COMPASES 1-2 (Intro Violines 1 y 2) ---
// Las cuerdas hacen un diseño de contratiempos (corchea, silencio de corchea)
let currentMs = 0;
for (let measure = 1; measure <= 2; measure++) {
  for (let beat = 0; beat < 12; beat++) {
    // Violines tocan en los contratiempos de las corcheas
    if (beat % 2 === 1) {
      // Alternando carriles agudos y medios
      const lane = beat % 3 === 0 ? 3 : (beat > 6 ? 4 : 2);
      addNote(currentMs + beat * EIGHTH_MS, lane);
    }
  }
  currentMs += 12 * EIGHTH_MS; // Avanzar 1 compás (12 corcheas)
}

// --- COMPACES 3-4 (Entrada del Coro: "Lacrimosa") ---
// Sopranos y bajos entran majestuosos, las cuerdas siguen su patrón.
for (let measure = 3; measure <= 4; measure++) {
  // Patrón de violines (acompañamiento) - Lo ponemos en carriles 3,4
  for (let beat = 0; beat < 12; beat++) {
    if (beat % 2 === 1) addNote(currentMs + beat * EIGHTH_MS, 4);
  }

  // Coro (La-cri-mo-sa) carriles 0, 1, 2
  // "La-" (2 corcheas)
  addNote(currentMs + 0, 0, 'long'); 
  // "-cri-" (2 corcheas)
  addNote(currentMs + 2 * EIGHTH_MS, 1, 'long');
  // "-mo-" (1 corchea + semicorchea)
  addNote(currentMs + 5 * EIGHTH_MS, 2);
  // "-sa" (Largo)
  addNote(currentMs + 6 * EIGHTH_MS, 0, 'long');

  currentMs += 12 * EIGHTH_MS;
}

// --- COMPASES 5-8 ("dies illa, qua resurget...") ---
// Aquí la música se vuelve progresivamente más intensa
for (let measure = 5; measure <= 8; measure++) {
  // Bajo continuo / Cuerdas
  for (let beat = 0; beat < 12; beat++) {
    addNote(currentMs + beat * EIGHTH_MS, beat % 5);
  }

  // Énfasis del coro en los pulsos fuertes
  addNote(currentMs + 0, 2, 'long');
  addNote(currentMs + 3 * EIGHTH_MS, 2, 'long');
  addNote(currentMs + 6 * EIGHTH_MS, 2, 'long');
  addNote(currentMs + 9 * EIGHTH_MS, 2, 'long');

  currentMs += 12 * EIGHTH_MS;
}

// --- CLÍMAX / CRESCENDO (Compases 9+) ---
for (let measure = 9; measure <= 16; measure++) {
  // Cascadas de notas bajando por la escala
  for (let beat = 0; beat < 12; beat++) {
    addNote(currentMs + beat * EIGHTH_MS, 4 - (beat % 5));
    // Dificultad adicional para hard en contratiempos
    if (measure > 12 && beat % 2 === 0) {
      addNote(currentMs + beat * EIGHTH_MS + (EIGHTH_MS/2), (beat % 3) + 1);
    }
  }

  // Acordes grandes cada inicio de compás
  addNote(currentMs, 0, 'long');
  addNote(currentMs, 4, 'long');

  // Crescendo rítmico
  if (measure % 2 === 0) {
      addNote(currentMs + 6 * EIGHTH_MS, 1, 'long');
      addNote(currentMs + 6 * EIGHTH_MS, 3, 'long');
  }

  currentMs += 12 * EIGHTH_MS;
}

// --- DESARROLLO (Compases 17-24) ---
for (let measure = 17; measure <= 24; measure++) {
  // Patrón arpegiado
  for (let beat = 0; beat < 12; beat += 2) {
    addNote(currentMs + beat * EIGHTH_MS, 0);
    addNote(currentMs + (beat+1) * EIGHTH_MS, 2);
    addNote(currentMs + (beat+1) * EIGHTH_MS, 4);
  }
  
  // Voces
  addNote(currentMs + 0, 1, 'long');
  addNote(currentMs + 3 * EIGHTH_MS, 3, 'long');
  addNote(currentMs + 6 * EIGHTH_MS, 1, 'long');
  addNote(currentMs + 9 * EIGHTH_MS, 3, 'long');

  currentMs += 12 * EIGHTH_MS;
}

// --- GRAN FINAL "Amen" ---
for (let measure = 25; measure <= 30; measure++) {
  for (let beat = 0; beat < 12; beat++) {
    addNote(currentMs + beat * EIGHTH_MS, beat % 5);
    addNote(currentMs + beat * EIGHTH_MS + (EIGHTH_MS/2), (beat+2) % 5);
  }
  addNote(currentMs, 0, 'long');
  addNote(currentMs + 6 * EIGHTH_MS, 4, 'long');
  currentMs += 12 * EIGHTH_MS;
}

// Ultimo acorde largo (Amen final)
addNote(currentMs + 0, 0, 'long');
addNote(currentMs + 0, 1, 'long');
addNote(currentMs + 0, 2, 'long');
addNote(currentMs + 0, 3, 'long');
addNote(currentMs + 0, 4, 'long');

// Ordernar ambas partituras cronológicamente
PARTITURA_NORMAL.sort((a,b) => a.time - b.time);
PARTITURA_HARD.sort((a,b) => a.time - b.time);

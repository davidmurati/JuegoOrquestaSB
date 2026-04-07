/**
 * analyzer.js (Versión 2.0 Multibanda - Detección de Transitorios de Audio Real)
 * 
 * Lee lacrimosa.m4a y detecta los ataques de los instrumentos (transitorios)
 * usando un OfflineAudioContext y Filtros Biquad, mapeando las diferentes 
 * frecuencias a los 5 carriles del juego (Bajos -> A, Medios -> D, Altos -> G).
 */

'use strict';

const AudioAnalyzer = (() => {
  let isAnalyzing = false;

  // Parámetros de detección de Onsets (ataques)
  const WINDOW_SIZE_MS = 20;   // Ventanas de 20ms
  const HOP_SIZE_MS = 10;      // Avance de 10ms
  
  // Función para procesar un canal filtrado offline y extraer sus picos (onsets)
  async function extractOnsetsForBand(audioBuffer, filterType, frequency, thresholdMultiplier, minSpacingMs) {
    const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(
      1, audioBuffer.length, audioBuffer.sampleRate
    );

    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;

    const filter = offlineCtx.createBiquadFilter();
    filter.type = filterType;
    if (filterType === 'bandpass') {
      filter.frequency.value = frequency.center;
      filter.Q.value = frequency.q;
    } else {
      filter.frequency.value = frequency;
    }

    source.connect(filter);
    filter.connect(offlineCtx.destination);
    source.start(0);

    const filteredBuffer = await offlineCtx.startRendering();
    const data = filteredBuffer.getChannelData(0);
    const sampleRate = filteredBuffer.sampleRate;
    
    const windowSamples = Math.floor((WINDOW_SIZE_MS / 1000) * sampleRate);
    const hopSamples = Math.floor((HOP_SIZE_MS / 1000) * sampleRate);

    // 1. Calcular de Energía RMS por ventana
    const energyEnv = [];
    for (let i = 0; i < data.length - windowSamples; i += hopSamples) {
      let sum = 0;
      for (let j = 0; j < windowSamples; j++) {
        sum += data[i + j] * data[i + j];
      }
      energyEnv.push(Math.sqrt(sum / windowSamples));
    }

    // 2. Calcular Flujo Espectral / Diferencial Delta (Novedad de Energía)
    const deltas = [0];
    for (let i = 1; i < energyEnv.length; i++) {
      const diff = energyEnv[i] - energyEnv[i - 1];
      deltas.push(diff > 0 ? diff : 0); // Solo guardar crecimientos abruptos de energía (ataques)
    }

    // 3. Peak Picking adaptativo
    const onsets = [];
    const neighborhood = 15; // Revisar picos locales en ~300ms de ventana
    let lastTime = -1000;

    for (let i = neighborhood; i < deltas.length - neighborhood; i++) {
      const currentVal = deltas[i];
      if (currentVal < 0.001) continue; // Noise floor

      let localSum = 0;
      let isLocalPeak = true;

      for (let j = i - neighborhood; j <= i + neighborhood; j++) {
        if (deltas[j] > currentVal) isLocalPeak = false;
        localSum += deltas[j];
      }

      if (isLocalPeak) {
        const localMean = localSum / (neighborhood * 2 + 1);
        if (currentVal > localMean * thresholdMultiplier) {
          const timeMs = i * HOP_SIZE_MS;
          if (timeMs - lastTime >= minSpacingMs) {
            onsets.push(timeMs);
            lastTime = timeMs;
          }
        }
      }
    }

    return onsets;
  }

  return {
    analyzeMusicUrl: async (url, onProgress) => {
      if (isAnalyzing) return null;
      isAnalyzing = true;

      try {
        if (onProgress) onProgress("Descargando partitura orquestal viva...");
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();

        if (onProgress) onProgress("Decodificando ondas acústicas...");
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

        if (onProgress) onProgress("Aislando bajos (Contrabajos, Timbales)...");
        // LOW BAND (Bajos < 250Hz). Carriles A (0) o S (1)
        const lowOnsets = await extractOnsetsForBand(audioBuffer, 'lowpass', 250, 2.5, 300);

        if (onProgress) onProgress("Aislando medios (Coro, Violonchelos)...");
        // MID BAND (Medios 250 - 2000Hz). Carriles D (2) o F (3)
        const midOnsets = await extractOnsetsForBand(audioBuffer, 'bandpass', {center: 1000, q: 1}, 2.0, 250);

        if (onProgress) onProgress("Aislando agudos (Violines, Flautas)...");
        // HIGH BAND (Altos > 2000Hz). Carril G (4)
        const highOnsets = await extractOnsetsForBand(audioBuffer, 'highpass', 2000, 2.0, 200);

        if (onProgress) onProgress("Coreografiando notas finales...");

        const partituraHard = [];
        const partituraNormal = [];

        // Distribuir notas (Bajos: A, Medios: S/D, Agudos: F/G)
        lowOnsets.forEach(time => partituraHard.push({ time: Math.floor(time), lane: 0, type: 'normal' }));
        midOnsets.forEach(time => partituraHard.push({ time: Math.floor(time), lane: Math.random() > 0.5 ? 1 : 2, type: 'normal' }));
        highOnsets.forEach(time => partituraHard.push({ time: Math.floor(time), lane: Math.random() > 0.5 ? 3 : 4, type: 'normal' }));

        // Ordenar cronológicamente
        partituraHard.sort((a, b) => a.time - b.time);

        // Modo Hard: Reducir dificultad y agrupar ráfagas en notas largas (sostenidas)
        let filteredHard = [];
        let indexH = 0;
        while (indexH < partituraHard.length) {
          let currentNote = partituraHard[indexH];
          
          // Detectar ráfaga (3+ notas con <260ms de separación entre ellas consecutivamente)
          let burstEndIndex = indexH;
          for (let checkDiff = indexH + 1; checkDiff < partituraHard.length; checkDiff++) {
            if (partituraHard[checkDiff].time - partituraHard[checkDiff-1].time < 260) {
              burstEndIndex = checkDiff;
            } else {
              break;
            }
          }
          
          const burstSize = burstEndIndex - indexH + 1;
          if (burstSize >= 3) {
            // Reemplazar la ráfaga por una nota sostenida
            currentNote.type = 'long';
            filteredHard.push(currentNote);
            indexH = burstEndIndex + 1; // saltar toda la ráfaga
          } else {
            // Nota normal. Filtramos para que la dificultad Hard no tenga notas separadas por < 140ms
            if (filteredHard.length === 0 || currentNote.time - filteredHard[filteredHard.length-1].time >= 140) {
              currentNote.type = 'normal';
              filteredHard.push(currentNote);
            }
            indexH++;
          }
        }

        // Modo Normal: Más fácil, también con notas largas para tramos densos
        partituraNormal.length = 0; // vaciar array original si es necesario, o usar temp
        let tempNormal = [];
        let indexN = 0;
        while (indexN < filteredHard.length) {
           let n = filteredHard[indexN];
           
           // Agrupar mini-ráfagas en Normal (2+ notas < 450ms)
           let miniBurstEnd = indexN;
           for (let check = indexN + 1; check < filteredHard.length; check++) {
               if (filteredHard[check].time - filteredHard[check-1].time < 450) {
                   miniBurstEnd = check;
               } else {
                   break;
               }
           }
           const burstSizeNormal = miniBurstEnd - indexN + 1;
           
           // Simplificar carriles oscuros (reducir a los 3 centrales)
           let safeLane = n.lane;
           if (safeLane === 0) safeLane = 1;
           if (safeLane === 4) safeLane = 3; 
           
           if (burstSizeNormal >= 2) {
               tempNormal.push({ time: n.time, lane: safeLane, type: 'long' });
               indexN = miniBurstEnd + 1;
           } else {
               if (tempNormal.length === 0 || n.time - tempNormal[tempNormal.length-1].time > 550) {
                   tempNormal.push({ time: n.time, lane: safeLane, type: 'normal' });
               }
               indexN++;
           }
        }
        
        // Asignar al array final
        partituraNormal.push(...tempNormal);

        isAnalyzing = false;
        return {
          normal: partituraNormal,
          hard: filteredHard
        };

      } catch (err) {
        console.error("Error analizando audio:", err);
        isAnalyzing = false;
        return null; // fallback a estático en game.js
      }
    }
  };
})();

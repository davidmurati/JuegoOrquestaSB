const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Configurar parser para bodies JSON grandes (las partituras pueden ser pesadas)
app.use(express.json({ limit: '10mb' }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve game assets (images from Imagenes folder)
app.use('/assets/images', express.static(path.join(__dirname, 'Imagenes')));

// Serve song data
app.use('/assets/cancion', express.static(path.join(__dirname, 'Cancion')));

// =======================
// REST API
// =======================

// 1. Escanear carpetas de canciones (Autodescubrimiento)
app.get('/api/songs', (req, res) => {
  const cancionDir = path.join(__dirname, 'Cancion');
  if (!fs.existsSync(cancionDir)) return res.json([]);

  const folders = fs.readdirSync(cancionDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  const catalog = [];

  for (const folder of folders) {
    const folderPath = path.join(cancionDir, folder);
    const id = folder.toLowerCase();
    
    // Objeto Base
    let songObj = {
      id: id,
      folder: folder,
      title: folder,
      file: null,
      hasBeatmap: false,
      metadata: {}
    };

    // Buscar archivo de Audio en la subcarpeta 'Sonido'
    const sonidoDir = path.join(folderPath, 'Sonido');
    if (fs.existsSync(sonidoDir)) {
      const audioFiles = fs.readdirSync(sonidoDir).filter(f => {
        const lower = f.toLowerCase();
        return lower.endsWith('.m4a') || lower.endsWith('.mp3') || lower.endsWith('.wav');
      });
      if (audioFiles.length > 0) {
        songObj.file = `/assets/cancion/${folder}/Sonido/${audioFiles[0]}`;
        // Intentar adivinar título desde el nombre si no hay metadata
        songObj.title = audioFiles[0].replace(/\.(m4a|mp3|wav)$/i, '');
      }
    }

    // Buscar si ya tiene Beatmap en 'Pista'
    const pistaDir = path.join(folderPath, 'Pista');
    if (fs.existsSync(pistaDir) && fs.existsSync(path.join(pistaDir, 'partitura.json'))) {
      songObj.hasBeatmap = true;
      songObj.beatmapUrl = `/assets/cancion/${folder}/Pista/partitura.json`;
    }

    // Leer metadatos opcionales (para saltar aplausos, custom titles, etc)
    const metadataPath = path.join(folderPath, 'metadata.json');
    if (fs.existsSync(metadataPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        songObj.metadata = meta;
        if (meta.title) songObj.title = meta.title;
      } catch (e) { console.error(`Error leyendo metadata de ${folder}`, e); }
    }

    // Sólo agregar al catálogo si tiene archivo de sonido jugable
    if (songObj.file) {
      catalog.push(songObj);
    }
  }

  res.json(catalog);
});

// 2. Guardar Beatmaps generados por el cliente
app.post('/api/save-beatmap', (req, res) => {
  const { folder, partitura } = req.body;
  if (!folder || !partitura) {
    return res.status(400).json({ error: "Faltan datos" });
  }

  const pistaDir = path.join(__dirname, 'Cancion', folder, 'Pista');
  
  // Asegurarnos de que el directorio Pista exista
  if (!fs.existsSync(pistaDir)) {
    fs.mkdirSync(pistaDir, { recursive: true });
  }

  const outputPath = path.join(pistaDir, 'partitura.json');
  try {
    fs.writeFileSync(outputPath, JSON.stringify(partitura));
    res.json({ success: true, message: "Pista guardada en el Servidor." });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "No se pudo escribir el beatmap." });
  }
});

// =======================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🎼 Juego Orquesta Rock Band corriendo en http://localhost:${PORT}`);
  console.log('Presiona Ctrl+C para detener el servidor.');
});

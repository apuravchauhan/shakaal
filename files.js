'use strict';

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');

const router     = express.Router();
const UPLOAD_DIR = path.join(os.homedir(), 'data-upload');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext  = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${base}_${Date.now()}${ext}`);
  },
});
const upload = multer({ storage });

router.get('/data', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'data.html'));
});

router.get('/api/files', (_req, res) => {
  try {
    const files = fs.readdirSync(UPLOAD_DIR)
      .map(name => {
        const stat = fs.statSync(path.join(UPLOAD_DIR, name));
        return { name, size: stat.size, modified: stat.mtimeMs };
      })
      .sort((a, b) => b.modified - a.modified);
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/files/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filepath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Not found' });
  res.download(filepath, filename);
});

router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' });
  console.log(`[upload] saved ${req.file.filename} → ${UPLOAD_DIR}`);
  res.json({ ok: true, filename: req.file.filename });
});

module.exports = router;

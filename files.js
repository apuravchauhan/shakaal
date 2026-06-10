'use strict';

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');

const router     = express.Router();
const UPLOAD_DIR = path.join(os.homedir(), 'data-upload');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Resolve a client-supplied relative path inside UPLOAD_DIR, rejecting traversal.
function safePath(rel) {
  const target = path.resolve(UPLOAD_DIR, rel || '');
  if (target !== UPLOAD_DIR && !target.startsWith(UPLOAD_DIR + path.sep)) return null;
  return target;
}

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = safePath(req.query.path);
    cb(null, dir && fs.existsSync(dir) ? dir : UPLOAD_DIR);
  },
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

router.get('/api/files', (req, res) => {
  try {
    const dir = safePath(req.query.path);
    if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      return res.status(400).json({ error: 'Bad path' });
    }
    const files = fs.readdirSync(dir)
      .map(name => {
        const stat = fs.statSync(path.join(dir, name));
        return { name, isDir: stat.isDirectory(), size: stat.size, modified: stat.mtimeMs };
      })
      .sort((a, b) => (b.isDir - a.isDir) || (b.modified - a.modified));
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/download', (req, res) => {
  const filepath = safePath(req.query.path);
  if (!filepath || !fs.existsSync(filepath) || fs.statSync(filepath).isDirectory()) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.download(filepath, path.basename(filepath));
});

router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' });
  console.log(`[upload] saved ${req.file.filename} → ${UPLOAD_DIR}`);
  res.json({ ok: true, filename: req.file.filename });
});

module.exports = router;

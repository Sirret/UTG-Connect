import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { requireAuth } from '../auth.js';
import { bad, wrap } from '../util.js';

export const uploadsRoutes = Router();

fs.mkdirSync(config.uploadsDir, { recursive: true });

// Images everywhere; documents too, since a council post is the one place
// that's allowed to attach a PDF/doc alongside — or instead of — a photo.
const ALLOWED = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadsDir),
  filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${ALLOWED[file.mimetype] || ''}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, Boolean(ALLOWED[file.mimetype])),
});

uploadsRoutes.post(
  '/',
  requireAuth,
  upload.single('file'),
  wrap((req, res) => {
    if (!req.file) throw bad('Attach an image (jpg/png/webp/gif) or a PDF/Word document, up to 8MB');
    res.status(201).json({
      url: `/uploads/${req.file.filename}`,
      name: req.file.originalname,
      size: req.file.size,
    });
  }),
);

// multer's own errors (file too large, wrong field name) arrive here rather
// than through the wrap()/HttpError path, so they need their own handler.
uploadsRoutes.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 8MB)' : err.message });
  }
  next(err);
});

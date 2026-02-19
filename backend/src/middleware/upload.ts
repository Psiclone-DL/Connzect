import multer from 'multer';
import path from 'path';
import fs from 'fs';

const uploadsPath = path.resolve(process.cwd(), 'uploads');

if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, uploadsPath);
  },
  filename: (_req, file, callback) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname).toLowerCase();
    callback(null, `${uniqueSuffix}${ext}`);
  }
});

const allowedImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!allowedImageTypes.has(file.mimetype)) {
      callback(new Error('Unsupported file type'));
      return;
    }
    callback(null, true);
  }
});

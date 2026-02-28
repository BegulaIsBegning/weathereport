import express from 'express';
import { createServer as createViteServer } from 'vite';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import cookieParser from 'cookie-parser';
import { v4 as uuidv4 } from 'uuid';
import db from './src/db';
import crypto from 'crypto';

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Configure Multer for photo uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cookieParser());
  app.use('/uploads', express.static(uploadsDir));

  // --- Middleware ---
  const requireAuth = (req: any, res: any, next: any) => {
    const userId = req.cookies.session_id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND is_verified = 1').get(userId);
    if (!user) return res.status(401).json({ error: 'User not found or not verified' });
    
    req.user = user;
    next();
  };

  // --- Auth Routes ---

  // 1. Init Login: User enters username, gets a code
  app.post('/api/auth/init', (req, res) => {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username required' });

    // Generate a simple 6-char code
    const code = crypto.randomBytes(3).toString('hex').toUpperCase();
    const id = uuidv4();

    // Upsert user (if exists, update code; if not, create)
    const existing = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
    
    if (existing) {
      db.prepare('UPDATE users SET verification_code = ?, is_verified = 0 WHERE id = ?').run(code, existing.id);
      res.json({ code, username, id: existing.id });
    } else {
      db.prepare('INSERT INTO users (id, username, verification_code, is_verified) VALUES (?, ?, ?, 0)').run(id, username, code);
      res.json({ code, username, id });
    }
  });

  // 2. Webhook: Plugin sends { username, code } to verify
  app.post('/api/verify', (req, res) => {
    const { username, code } = req.body;
    console.log('Webhook received:', { username, code });

    if (!username || !code) return res.status(400).json({ error: 'Missing data' });

    const user = db.prepare('SELECT * FROM users WHERE username = ? AND verification_code = ?').get(username, code) as any;

    if (!user) {
      return res.status(404).json({ error: 'Invalid username or code' });
    }

    // Mark verified
    db.prepare('UPDATE users SET is_verified = 1, verification_code = NULL WHERE id = ?').run(user.id);
    
    console.log(`User ${username} verified!`);
    res.json({ success: true, message: 'Player verified successfully' });
  });

  // 3. Status Check: Frontend polls this to see if verified
  app.get('/api/auth/status', (req, res) => {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: 'Username required' });

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
    
    if (user && user.is_verified) {
      // Set long-lived session cookie
      res.cookie('session_id', user.id, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 365 * 24 * 60 * 60 * 1000 // 1 year
      });
      return res.json({ verified: true, user });
    }

    res.json({ verified: false });
  });

  // 4. Me: Get current session
  app.get('/api/me', (req, res) => {
    const userId = req.cookies.session_id;
    if (!userId) return res.json({ user: null });
    
    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
    res.json({ user: user || null });
  });

  // 5. Logout
  app.post('/api/logout', (req, res) => {
    res.clearCookie('session_id');
    res.json({ success: true });
  });

  // --- Report Routes ---

  // Get Reports (Public)
  app.get('/api/reports', (req, res) => {
    const reports = db.prepare(`
      SELECT reports.*, users.username as author_name 
      FROM reports 
      LEFT JOIN users ON reports.user_id = users.id 
      ORDER BY created_at DESC
    `).all();
    res.json(reports);
  });

  // Submit Report (Protected)
  app.post('/api/reports', requireAuth, upload.single('photo'), (req: any, res: any) => {
    try {
      const {
        city,
        time,
        effective_until,
        type,
        clouds,
        moisture,
        kind_of_act,
        damage_classification,
        title
      } = req.body;

      const photo_url = req.file ? `/uploads/${req.file.filename}` : null;
      const id = uuidv4();

      db.prepare(`
        INSERT INTO reports (
          id, user_id, title, city, time, effective_until, type, clouds, 
          moisture, kind_of_act, damage_classification, photo_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, req.user.id, title, city, time, effective_until, type, clouds || null,
        moisture, kind_of_act, damage_classification, photo_url
      );

      res.json({ success: true, id });
    } catch (err) {
      console.error('Submit error:', err);
      res.status(500).json({ error: 'Failed to save report' });
    }
  });

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

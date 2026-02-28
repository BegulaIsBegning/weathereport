import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Ensure data directory exists
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

const db = new Database(path.join(dataDir, 'weathercraft.db'));

// Initialize tables
db.exec(`
  -- Users Table (for linked accounts)
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE,
    verification_code TEXT,
    is_verified INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Reports Table
  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    city TEXT NOT NULL,
    time TEXT NOT NULL,
    effective_until TEXT NOT NULL,
    type TEXT NOT NULL,
    clouds TEXT, -- Optional
    moisture TEXT NOT NULL,
    kind_of_act TEXT NOT NULL, -- Tornado, Squall, etc.
    damage_classification TEXT NOT NULL,
    photo_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

export default db;

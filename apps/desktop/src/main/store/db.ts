// apps/desktop/src/main/store/db.ts

import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { runMigrations } from './migrations';

let _db: Database.Database | null = null;

/**
 * Get the database file path based on environment.
 */
export function getDatabasePath(): string {
  const dbName = app.isPackaged ? 'openwork.db' : 'openwork-dev.db';
  const dbPath = path.join(app.getPath('userData'), dbName);

  // On Windows, warn if path is approaching MAX_PATH limit (260 characters)
  // This gives users time to address the issue before problems occur
  if (process.platform === 'win32' && dbPath.length > 250) {
    console.warn('[DB] Database path is very long, may cause issues on Windows:', dbPath);
    console.warn('[DB] Consider moving app data to a shorter path or using username alias');
  }

  return dbPath;
}

/**
 * Get or create the database connection.
 * Migrations are NOT run here - call runMigrations() separately after getting the database.
 */
export function getDatabase(): Database.Database {
  if (!_db) {
    const dbPath = getDatabasePath();
    console.log('[DB] Opening database at:', dbPath);

    _db = new Database(dbPath);

    // On Windows, configure WAL mode with safer settings to handle file locking
    if (process.platform === 'win32') {
      // Set busy timeout for Windows (5 seconds) to handle concurrent access
      _db.pragma('busy_timeout = 5000');
      _db.pragma('journal_mode = WAL');
      // Use NORMAL synchronous mode for better Windows performance while maintaining safety
      _db.pragma('synchronous = NORMAL');
      console.log('[DB] Configured WAL mode for Windows with busy_timeout=5000, synchronous=NORMAL');
    } else {
      // Unix/macOS - standard WAL configuration
      _db.pragma('journal_mode = WAL');
    }

    _db.pragma('foreign_keys = ON');
  }
  return _db;
}

/**
 * Close the database connection.
 * Call this on app shutdown.
 */
export function closeDatabase(): void {
  if (_db) {
    console.log('[DB] Closing database connection');
    _db.close();
    _db = null;
  }
}

/**
 * Reset the database by backing up and removing the current file.
 * Used for recovery from corruption.
 */
export function resetDatabase(): void {
  closeDatabase();

  const dbPath = getDatabasePath();
  if (fs.existsSync(dbPath)) {
    const backupPath = `${dbPath}.corrupt.${Date.now()}`;
    console.log('[DB] Backing up corrupt database to:', backupPath);
    fs.renameSync(dbPath, backupPath);
  }

  // Also remove WAL and SHM files if they exist
  // On Windows, these files may be locked by antivirus or other processes
  const walPath = `${dbPath}-wal`;
  const shmPath = `${dbPath}-shm`;

  // Helper function to delete files with retry logic for Windows file locking
  const deleteWithRetry = (filePath: string, description: string): void => {
    if (!fs.existsSync(filePath)) return;

    const maxRetries = process.platform === 'win32' ? 5 : 1;
    for (let i = 0; i < maxRetries; i++) {
      try {
        fs.unlinkSync(filePath);
        console.log(`[DB] Deleted ${description}: ${filePath}`);
        return;
      } catch (err) {
        const errorCode = (err as NodeJS.ErrnoException).code;
        if (i === maxRetries - 1) {
          console.warn(`[DB] Could not delete ${description} after ${maxRetries} attempts:`, errorCode);
        } else {
          // Wait a bit and retry (exponential backoff)
          const delay = 100 * (i + 1);
          console.log(`[DB] Retry ${i + 1}/${maxRetries} for ${description} after ${delay}ms`);
          // Synchronous delay is not ideal, but this is a rare recovery operation
          const start = Date.now();
          while (Date.now() - start < delay) {
            // Busy wait
          }
        }
      }
    }
  };

  deleteWithRetry(walPath, 'WAL file');
  deleteWithRetry(shmPath, 'SHM file');
}

/**
 * Check if the database file exists.
 */
export function databaseExists(): boolean {
  return fs.existsSync(getDatabasePath());
}

/**
 * Initialize the database and run migrations.
 * Call this on app startup before any database access.
 * Throws FutureSchemaError if the database is from a newer app version.
 */
export function initializeDatabase(): void {
  const db = getDatabase();
  runMigrations(db);
  console.log('[DB] Database initialized and migrations complete');
}

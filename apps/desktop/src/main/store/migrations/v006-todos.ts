// apps/desktop/src/main/store/migrations/v006-todos.ts

import type { Database } from 'better-sqlite3';
import type { Migration } from './index';

export const migration: Migration = {
  version: 6,
  up(db: Database): void {
    // Add todos column to tasks table (JSON array)
    db.exec(`
      ALTER TABLE tasks ADD COLUMN todos TEXT DEFAULT NULL;
    `);
  },
};

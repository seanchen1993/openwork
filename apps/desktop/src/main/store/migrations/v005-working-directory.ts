// apps/desktop/src/main/store/migrations/v005-working-directory.ts

import type { Database } from 'better-sqlite3';
import type { Migration } from './index';

export const migration: Migration = {
  version: 5,
  up(db: Database): void {
    // Add working_directory column to tasks table
    db.exec(`
      ALTER TABLE tasks ADD COLUMN working_directory TEXT DEFAULT NULL;
    `);
  },
};

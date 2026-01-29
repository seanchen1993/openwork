#!/usr/bin/env node

/**
 * Custom packaging script for Electron app with pnpm workspaces.
 * Temporarily removes workspace symlinks that cause electron-builder issues.
 * On Windows, skips native module rebuild (uses prebuilt binaries).
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const isWindows = process.platform === 'win32';
const nodeModulesPath = path.join(__dirname, '..', 'node_modules');
const accomplishPath = path.join(nodeModulesPath, '@accomplish');

// Save symlink target for restoration
let symlinkTarget = null;
const sharedPath = path.join(accomplishPath, 'shared');

try {
  // Check if @accomplish/shared symlink exists
  if (fs.existsSync(sharedPath)) {
    const stats = fs.lstatSync(sharedPath);
    if (stats.isSymbolicLink()) {
      symlinkTarget = fs.readlinkSync(sharedPath);
      console.log('Temporarily removing workspace symlink:', sharedPath);
      fs.unlinkSync(sharedPath);

      // Remove empty @accomplish directory if it exists
      try {
        fs.rmdirSync(accomplishPath);
      } catch {
        // Directory not empty or doesn't exist, ignore
      }
    }
  }

  // Get command line args (everything after 'node scripts/package.js')
  const args = process.argv.slice(2).join(' ');

  // On Windows, skip native module rebuild (use prebuilt binaries)
  // This avoids issues with node-pty's winpty.gyp batch file handling
  const npmRebuildFlag = isWindows ? ' --config.npmRebuild=false' : '';

  // On CI Windows builds, use portable target to avoid NSIS hanging issues
  // NSIS has known compatibility issues with GitHub Actions runners
  // See: https://github.com/electron-userland/electron-builder/issues/8613
  const isCi = process.env.CI === 'true';
  const winTargetFlag = isWindows && isCi ? ' --config.win.target=portable' : '';

  // Use npx to run electron-builder to ensure it's found in node_modules
  const command = `npx electron-builder ${args}${npmRebuildFlag}${winTargetFlag}`;

  console.log('Running:', command);
  if (isWindows) {
    console.log('(Skipping native module rebuild on Windows - using prebuilt binaries)');
    if (winTargetFlag) {
      console.log('(Using portable target on CI to avoid NSIS issues)');
    }
  }

  execSync(command, {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
  });

} finally {
  // Restore the symlink
  if (symlinkTarget) {
    console.log('Restoring workspace symlink');

    // Recreate @accomplish directory if needed
    if (!fs.existsSync(accomplishPath)) {
      fs.mkdirSync(accomplishPath, { recursive: true });
    }

    // On Windows, use junction instead of symlink (doesn't require admin privileges)
    // The target needs to be an absolute path for junctions
    const absoluteTarget = path.isAbsolute(symlinkTarget)
      ? symlinkTarget
      : path.resolve(path.dirname(sharedPath), symlinkTarget);

    if (isWindows) {
      fs.symlinkSync(absoluteTarget, sharedPath, 'junction');
    } else {
      fs.symlinkSync(symlinkTarget, sharedPath);
    }
  }
}

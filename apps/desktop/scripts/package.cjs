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

  // On CI Windows builds, fully disable signing to avoid hanging signtool prompts
  // This is the root cause of NSIS hanging - without signing, NSIS works fine
  const isCi = process.env.CI === 'true';

  // On Windows CI, use portable target instead of NSIS to avoid NSIS hanging issues
  // Portable creates a single exe file that doesn't require installation
  // The user can still manually create a shortcut if needed
  let targetFlag = '';
  if (isWindows && isCi) {
    // Check if user explicitly requested nsis target
    const hasNsisTarget = args.includes('--nsis') || args.includes('nsis');
    if (!hasNsisTarget) {
      // Force portable target on CI (single exe, no NSIS required)
      targetFlag = ' --config.win.target=portable --config.win.artifactName=${productName}-${version}-${os}-${arch}.${ext}';
    }
  }

  const skipSigningFlag = isWindows && isCi
    ? ' --config.win.sign=false --config.win.signAndEditExecutable=false --config.win.verifyUpdateCodeSignature=false'
    : '';

  // Disable NSIS installer icon on CI to potentially speed up build
  const nsisFlags = isWindows && isCi
    ? ' --config.nsis.perMachine=false --config.nsis.createDesktopShortcut=false --config.nsis.createStartMenuShortcut=false'
    : '';

  // Use npx to run electron-builder to ensure it's found in node_modules
  const command = `npx electron-builder ${args}${npmRebuildFlag}${targetFlag}${skipSigningFlag}${nsisFlags}`;

  const builderEnv = {
    ...process.env,
    ...(isWindows && isCi ? { ELECTRON_BUILDER_LOG_LEVEL: 'debug' } : {}),
  };

  console.log('Running:', command);
  if (isWindows) {
    console.log('(Skipping native module rebuild on Windows - using prebuilt binaries)');
    if (targetFlag) {
      console.log('(Using portable target on CI to avoid NSIS hanging - creates single exe)');
    }
    if (skipSigningFlag) {
      console.log('(Skipping Windows signing on CI to prevent hanging)');
    }
    if (isCi) {
      console.log(`(Extended timeout: ${Math.round(buildTimeout / 60000)} minutes for CI build)`);
    }
  }

  const startTime = Date.now();
  console.log(`[package] electron-builder start: ${new Date(startTime).toISOString()}`);
  // Use longer timeout on Windows CI for NSIS build (can take 15-20 minutes)
  const buildTimeout = (isWindows && isCi) ? 1800000 : 600000; // 30 min CI, 10 min local
  execSync(command, {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
    env: builderEnv,
    timeout: buildTimeout,
  });
  const endTime = Date.now();
  console.log(`[package] electron-builder end: ${new Date(endTime).toISOString()}`);
  console.log(`[package] electron-builder duration: ${Math.round((endTime - startTime) / 1000)}s`);

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

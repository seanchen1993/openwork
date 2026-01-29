/**
 * System PATH utilities for packaged apps
 *
 * macOS GUI apps launched from /Applications don't inherit the user's terminal PATH.
 * Windows GUI apps also don't inherit the full PATH from user environment.
 *
 * This module provides utilities to build a proper PATH without loading shell profiles,
 * which avoids triggering macOS folder access permissions (TCC) on macOS and provides
 * consistent PATH across all platforms.
 *
 * Approaches:
 * - macOS: /usr/libexec/path_helper + common Node.js installation paths
 * - Windows: Common Node.js installation paths from AppData, Program Files
 * - Linux: Common Node.js installation paths from /usr, /home
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Get NVM Node.js version paths.
 * NVM stores versions in ~/.nvm/versions/node/vX.X.X/bin/
 * Returns paths sorted by version (newest first).
 */
function getNvmNodePaths(): string[] {
  const home = process.env.HOME || '';
  const nvmVersionsDir = path.join(home, '.nvm', 'versions', 'node');

  if (!fs.existsSync(nvmVersionsDir)) {
    return [];
  }

  try {
    const versions = fs.readdirSync(nvmVersionsDir)
      .filter(name => name.startsWith('v'))
      .sort((a, b) => {
        // Sort by version number (descending - newest first)
        const parseVersion = (v: string) => {
          const parts = v.replace('v', '').split('.').map(Number);
          return parts[0] * 10000 + (parts[1] || 0) * 100 + (parts[2] || 0);
        };
        return parseVersion(b) - parseVersion(a);
      });

    return versions.map(v => path.join(nvmVersionsDir, v, 'bin'));
  } catch {
    return [];
  }
}

/**
 * Get fnm Node.js version paths.
 * fnm stores versions in ~/.fnm/node-versions/vX.X.X/installation/bin/
 */
function getFnmNodePaths(): string[] {
  const home = process.env.HOME || '';
  const fnmVersionsDir = path.join(home, '.fnm', 'node-versions');

  if (!fs.existsSync(fnmVersionsDir)) {
    return [];
  }

  try {
    const versions = fs.readdirSync(fnmVersionsDir)
      .filter(name => name.startsWith('v'))
      .sort((a, b) => {
        const parseVersion = (v: string) => {
          const parts = v.replace('v', '').split('.').map(Number);
          return parts[0] * 10000 + (parts[1] || 0) * 100 + (parts[2] || 0);
        };
        return parseVersion(b) - parseVersion(a);
      });

    return versions.map(v => path.join(fnmVersionsDir, v, 'installation', 'bin'));
  } catch {
    return [];
  }
}

/**
 * Common Node.js installation paths on macOS.
 * These are checked in order of preference.
 */
function getMacOSNodePaths(): string[] {
  const home = process.env.HOME || '';

  // Get dynamic paths from version managers
  const nvmPaths = getNvmNodePaths();
  const fnmPaths = getFnmNodePaths();

  return [
    // Version managers (dynamic - most specific, checked first)
    ...nvmPaths,
    ...fnmPaths,

    // Homebrew (very common)
    '/opt/homebrew/bin',              // Apple Silicon
    '/usr/local/bin',                 // Intel Mac

    // Version managers (static fallbacks)
    path.join(home, '.nvm', 'current', 'bin'),       // NVM with 'current' symlink
    path.join(home, '.volta', 'bin'),                // Volta
    path.join(home, '.asdf', 'shims'),               // asdf
    path.join(home, '.fnm', 'current', 'bin'),       // fnm current symlink
    path.join(home, '.nodenv', 'shims'),             // nodenv

    // Less common but valid paths
    '/usr/local/opt/node/bin',        // Homebrew node formula
    '/opt/local/bin',                 // MacPorts
    path.join(home, '.local', 'bin'),              // pip/pipx style installations
  ].filter(p => p && !p.includes('undefined'));
}

/**
 * Common Node.js installation paths on Windows.
 */
function getWindowsNodePaths(): string[] {
  const paths: string[] = [];
  const appData = process.env.APPDATA;
  const localAppData = process.env.LOCALAPPDATA;
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const home = os.homedir();

  // Node.js installer default paths
  const addIfExists = (p: string) => {
    if (fs.existsSync(p) && !paths.includes(p)) {
      paths.push(p);
    }
  };

  // NVM for Windows
  if (process.env.NVM_HOME) {
    addIfExists(path.join(process.env.NVM_HOME, 'current'));
    // Also check directly in NVM_HOME for current node
    try {
      const currentSymlink = path.join(process.env.NVM_HOME, 'current');
      if (fs.existsSync(currentSymlink)) {
        addIfExists(currentSymlink);
      }
    } catch {
      // Ignore
    }
  }

  // Volta for Windows
  addIfExists(path.join(home, 'AppData', 'Local', 'Volta'));

  // npm global paths
  if (appData) {
    addIfExists(path.join(appData, 'npm'));
  }
  if (localAppData) {
    addIfExists(path.join(localAppData, 'npm'));
  }

  // Program Files
  addIfExists(path.join(programFiles, 'nodejs'));
  addIfExists(path.join(programFilesX86, 'nodejs'));

  // User profile npm
  addIfExists(path.join(home, 'AppData', 'Roaming', 'npm'));

  return paths;
}

/**
 * Common Node.js installation paths on Linux.
 */
function getLinuxNodePaths(): string[] {
  const home = process.env.HOME || os.homedir();
  const paths: string[] = [];

  const addIfExists = (p: string) => {
    if (fs.existsSync(p) && !paths.includes(p)) {
      paths.push(p);
    }
  };

  // Get dynamic paths from version managers
  const nvmPaths = getNvmNodePaths();
  const fnmPaths = getFnmNodePaths();

  paths.push(...nvmPaths, ...fnmPaths);

  // Common Linux paths
  addIfExists('/usr/local/bin');
  addIfExists('/usr/bin');
  addIfExists(path.join(home, '.nvm', 'current', 'bin'));
  addIfExists(path.join(home, '.volta', 'bin'));
  addIfExists(path.join(home, '.asdf', 'shims'));
  addIfExists(path.join(home, '.fnm', 'current', 'bin'));
  addIfExists(path.join(home, '.local', 'bin'));

  return paths;
}

/**
 * Get common Node.js installation paths for the current platform.
 */
function getCommonNodePaths(): string[] {
  if (process.platform === 'win32') {
    return getWindowsNodePaths();
  } else if (process.platform === 'darwin') {
    return getMacOSNodePaths();
  } else {
    return getLinuxNodePaths();
  }
}

/**
 * Get system PATH using macOS path_helper utility.
 * This reads from /etc/paths and /etc/paths.d without loading user shell profiles.
 *
 * @returns The system PATH or null if path_helper fails or not on macOS
 */
function getSystemPathFromPathHelper(): string | null {
  if (process.platform !== 'darwin') {
    return null;
  }

  try {
    // path_helper outputs: PATH="..."; export PATH;
    // We need to extract just the path value
    const output = execSync('/usr/libexec/path_helper -s', {
      encoding: 'utf-8',
      timeout: 5000,
    });

    // Parse the output: PATH="/usr/local/bin:/usr/bin:..."; export PATH;
    const match = output.match(/PATH="([^"]+)"/);
    if (match && match[1]) {
      return match[1];
    }
  } catch (err) {
    console.warn('[SystemPath] path_helper failed:', err);
  }

  return null;
}

/**
 * Get the path separator for the current platform.
 */
function getPathSeparator(): string {
  return process.platform === 'win32' ? ';' : ':';
}

/**
 * Build an extended PATH for finding Node.js tools (node, npm, npx) in packaged apps.
 *
 * This function:
 * 1. Gets platform-specific common Node.js installation paths
 * 2. On macOS: adds system PATH from path_helper
 * 3. Prepends these to the existing PATH
 * 4. Does NOT load user shell profiles (avoids TCC permission prompts on macOS)
 *
 * @param basePath - The base PATH to extend (defaults to process.env.PATH)
 * @returns Extended PATH string
 */
export function getExtendedNodePath(basePath?: string): string {
  // Get base PATH - handle Windows case sensitivity
  let base = basePath || process.env.PATH || process.env.Path || '';

  // Start with common Node.js paths for the platform
  const nodePaths = getCommonNodePaths();

  // On macOS, try to get system PATH from path_helper
  const systemPath = getSystemPathFromPathHelper();

  // Build the final PATH:
  // 1. Common Node.js paths (highest priority - finds user's preferred Node)
  // 2. System PATH from path_helper (macOS only, includes /etc/paths.d entries)
  // 3. Base PATH (fallback)
  const pathParts: string[] = [];
  const separator = getPathSeparator();

  // Add common Node.js paths
  for (const p of nodePaths) {
    if (fs.existsSync(p) && !pathParts.includes(p)) {
      pathParts.push(p);
    }
  }

  // Add system PATH from path_helper (macOS only)
  if (systemPath) {
    for (const p of systemPath.split(separator)) {
      if (p && !pathParts.includes(p)) {
        pathParts.push(p);
      }
    }
  }

  // Add base PATH entries
  for (const p of base.split(separator)) {
    if (p && !pathParts.includes(p)) {
      pathParts.push(p);
    }
  }

  return pathParts.join(separator);
}

/**
 * Check if a command exists in the given PATH.
 *
 * On Unix-like systems, checks if the file is executable.
 * On Windows, checks if the file exists with appropriate extensions (.exe, .cmd, .bat).
 *
 * @param command - The command to find (e.g., 'npx', 'node', 'npm.cmd')
 * @param searchPath - The PATH to search in
 * @returns The full path to the command if found, null otherwise
 */
export function findCommandInPath(command: string, searchPath: string): string | null {
  const separator = getPathSeparator();

  for (const dir of searchPath.split(separator)) {
    if (!dir) continue;

    const dirPath = dir.trim();
    if (!dirPath) continue;

    try {
      if (!fs.existsSync(dirPath)) continue;

      // On Windows, try with common executable extensions
      if (process.platform === 'win32') {
        // Check if command already has an extension
        if (path.extname(command)) {
          const fullPath = path.join(dirPath, command);
          if (fs.existsSync(fullPath)) {
            const stats = fs.statSync(fullPath);
            if (stats.isFile()) {
              return fullPath;
            }
          }
        } else {
          // Try common Windows executable extensions
          const extensions = ['.exe', '.cmd', '.bat', '.ps1'];
          for (const ext of extensions) {
            const fullPath = path.join(dirPath, command + ext);
            if (fs.existsSync(fullPath)) {
              const stats = fs.statSync(fullPath);
              if (stats.isFile()) {
                return fullPath;
              }
            }
          }
        }
      } else {
        // Unix-like systems
        const fullPath = path.join(dirPath, command);
        if (fs.existsSync(fullPath)) {
          const stats = fs.statSync(fullPath);
          if (stats.isFile()) {
            // Check if executable (X_OK doesn't work on Windows)
            try {
              fs.accessSync(fullPath, fs.constants.X_OK);
              return fullPath;
            } catch {
              // Not executable, continue searching
            }
          }
        }
      }
    } catch {
      // Directory doesn't exist or other error, continue
    }
  }

  return null;
}

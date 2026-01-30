import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

/**
 * Get OpenCode package name and platform-specific binary name.
 *
 * opencode-ai 1.1.43+ uses platform-specific packages as optional dependencies:
 * - opencode-darwin-arm64 (macOS ARM)
 * - opencode-darwin-x64 (macOS Intel)
 * - opencode-linux-x64 (Linux)
 * - opencode-windows-x64 (Windows)
 * - opencode-windows-x64-baseline (Windows baseline)
 *
 * In packaged mode, we need to look for the platform-specific package.
 */
function getOpenCodePlatformInfo(): { packageName: string; binaryName: string } {
  if (process.platform === 'win32') {
    // Try x64 first, then baseline
    return {
      packageName: 'opencode-windows-x64',
      binaryName: 'opencode.exe',
    };
  }
  if (process.platform === 'darwin') {
    // macOS - use architecture-specific package
    const arch = process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
    return {
      packageName: `opencode-${arch}`,
      binaryName: 'opencode',
    };
  }
  if (process.platform === 'linux') {
    return {
      packageName: 'opencode-linux-x64',
      binaryName: 'opencode',
    };
  }
  // Fallback to main package
  return {
    packageName: 'opencode-ai',
    binaryName: 'opencode',
  };
}

/**
 * Get fallback OpenCode packages to try if the primary one isn't found.
 * This handles cases where the platform-specific package isn't installed.
 */
function getFallbackPackages(): string[] {
  const packages: string[] = [];

  if (process.platform === 'win32') {
    // Try baseline on Windows
    packages.push('opencode-windows-x64-baseline');
  }

  // Always try the main package as last resort
  packages.push('opencode-ai');

  return packages;
}

/**
 * Get all possible nvm OpenCode CLI paths by scanning the nvm versions directory
 */
function getNvmOpenCodePaths(): string[] {
  const homeDir = process.env.HOME || '';
  const nvmVersionsDir = path.join(homeDir, '.nvm/versions/node');
  const paths: string[] = [];

  try {
    if (fs.existsSync(nvmVersionsDir)) {
      const versions = fs.readdirSync(nvmVersionsDir);
      for (const version of versions) {
        const opencodePath = path.join(nvmVersionsDir, version, 'bin', 'opencode');
        if (fs.existsSync(opencodePath)) {
          paths.push(opencodePath);
        }
      }
    }
  } catch {
    // Ignore errors scanning nvm directory
  }

  return paths;
}

/**
 * Get the path to the bundled OpenCode CLI.
 *
 * In development: uses node_modules/.bin/opencode
 * In packaged app: uses the bundled CLI from unpacked asar
 */
export function getOpenCodeCliPath(): { command: string; args: string[] } {
  if (app.isPackaged) {
    // In packaged app, OpenCode is in unpacked asar
    // process.resourcesPath points to Resources folder in macOS app bundle
    const { packageName, binaryName } = getOpenCodePlatformInfo();

    // Try primary package first
    let cliPath = path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      packageName,
      'bin',
      binaryName
    );

    // If not found, try fallback packages
    if (!fs.existsSync(cliPath)) {
      console.warn(`[CLI Path] OpenCode not found at ${cliPath}, trying fallbacks...`);

      for (const fallbackPackage of getFallbackPackages()) {
        cliPath = path.join(
          process.resourcesPath,
          'app.asar.unpacked',
          'node_modules',
          fallbackPackage,
          'bin',
          binaryName
        );

        console.log(`[CLI Path] Trying fallback: ${cliPath}`);

        if (fs.existsSync(cliPath)) {
          console.log(`[CLI Path] Found OpenCode at fallback: ${cliPath}`);
          break;
        }
      }
    }

    // Verify the file exists
    if (!fs.existsSync(cliPath)) {
      throw new Error(`OpenCode CLI not found at: ${cliPath}. Tried packages: ${[packageName, ...getFallbackPackages()].join(', ')}`);
    }

    console.log(`[CLI Path] Using OpenCode at: ${cliPath}`);

    // OpenCode binary can be run directly
    return {
      command: cliPath,
      args: [],
    };
  } else {
    // In development, prefer the bundled CLI (node_modules) to keep behavior
    // consistent with the packaged app and avoid schema/version mismatches.
    // Opt into global with OPENWORK_USE_GLOBAL_OPENCODE=1 if needed.
    const preferGlobal = process.env.OPENWORK_USE_GLOBAL_OPENCODE === '1';

    // Try bundled CLI in node_modules first (unless preferGlobal)
    // Use app.getAppPath() instead of process.cwd() as cwd is unpredictable in Electron IPC handlers
    const binName = process.platform === 'win32' ? 'opencode.cmd' : 'opencode';
    const devCliPath = path.join(app.getAppPath(), 'node_modules', '.bin', binName);
    if (!preferGlobal && fs.existsSync(devCliPath)) {
      console.log('[CLI Path] Using bundled CLI:', devCliPath);
      return { command: devCliPath, args: [] };
    }

    // Check nvm installations (dynamically scan all versions)
    const nvmPaths = getNvmOpenCodePaths();
    for (const opencodePath of nvmPaths) {
      console.log('[CLI Path] Using nvm OpenCode CLI:', opencodePath);
      return { command: opencodePath, args: [] };
    }

    // Check other global installations (platform-specific)
    const globalOpenCodePaths = process.platform === 'win32'
      ? [
          // Windows: npm global installs
          path.join(process.env.APPDATA || '', 'npm', 'opencode.cmd'),
          path.join(process.env.LOCALAPPDATA || '', 'npm', 'opencode.cmd'),
        ]
      : [
          // macOS/Linux: Global npm
          '/usr/local/bin/opencode',
          // Homebrew
          '/opt/homebrew/bin/opencode',
        ];

    for (const opencodePath of globalOpenCodePaths) {
      if (fs.existsSync(opencodePath)) {
        console.log('[CLI Path] Using global OpenCode CLI:', opencodePath);
        return { command: opencodePath, args: [] };
      }
    }

    // Try bundled CLI in node_modules as a fallback (when preferGlobal is true)
    if (fs.existsSync(devCliPath)) {
      console.log('[CLI Path] Using bundled CLI:', devCliPath);
      return { command: devCliPath, args: [] };
    }

    // Final fallback: try 'opencode' on PATH
    // This handles cases where opencode is installed globally but in a non-standard location
    console.log('[CLI Path] Falling back to opencode command on PATH');
    return { command: 'opencode', args: [] };
  }
}

/**
 * Check if opencode is available on the system PATH
 */
function isOpenCodeOnPath(): boolean {
  try {
    const command = process.platform === 'win32' ? 'where opencode' : 'which opencode';
    execSync(command, { stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if the bundled OpenCode CLI is available
 */
export function isOpenCodeBundled(): boolean {
  try {
    if (app.isPackaged) {
      // In packaged mode, check if opencode exists in platform-specific package
      const { packageName, binaryName } = getOpenCodePlatformInfo();

      let cliPath = path.join(
        process.resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        packageName,
        'bin',
        binaryName
      );

      // Try fallback packages if primary not found
      if (!fs.existsSync(cliPath)) {
        for (const fallbackPackage of getFallbackPackages()) {
          cliPath = path.join(
            process.resourcesPath,
            'app.asar.unpacked',
            'node_modules',
            fallbackPackage,
            'bin',
            binaryName
          );

          if (fs.existsSync(cliPath)) {
            return true;
          }
        }
        return false;
      }

      return fs.existsSync(cliPath);
    } else {
      // In dev mode, actually verify the CLI exists

      // Prefer bundled CLI for dev consistency.
      const binName = process.platform === 'win32' ? 'opencode.cmd' : 'opencode';
      const devCliPath = path.join(app.getAppPath(), 'node_modules', '.bin', binName);
      if (fs.existsSync(devCliPath)) {
        return true;
      }

      // Check nvm installations (dynamically scan all versions)
      const nvmPaths = getNvmOpenCodePaths();
      if (nvmPaths.length > 0) {
        return true;
      }

      // Check other global installations (platform-specific)
      const globalOpenCodePaths = process.platform === 'win32'
        ? [
            // Windows: npm global installs
            path.join(process.env.APPDATA || '', 'npm', 'opencode.cmd'),
            path.join(process.env.LOCALAPPDATA || '', 'npm', 'opencode.cmd'),
          ]
        : [
            // macOS/Linux: Global npm
            '/usr/local/bin/opencode',
            // Homebrew
            '/opt/homebrew/bin/opencode',
          ];

      for (const opencodePath of globalOpenCodePaths) {
        if (fs.existsSync(opencodePath)) {
          return true;
        }
      }

      // Final fallback: check if opencode is available on PATH
      // This handles installations in non-standard locations
      if (isOpenCodeOnPath()) {
        return true;
      }

      // No CLI found
      return false;
    }
  } catch {
    return false;
  }
}

/**
 * Get the version of the bundled OpenCode CLI
 */
export function getBundledOpenCodeVersion(): string | null {
  try {
    if (app.isPackaged) {
      // In packaged mode, read from package.json
      const { packageName } = getOpenCodePlatformInfo();

      let packageJsonPath = path.join(
        process.resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        packageName,
        'package.json'
      );

      // Try fallback packages if primary not found
      if (!fs.existsSync(packageJsonPath)) {
        for (const fallbackPackage of getFallbackPackages()) {
          packageJsonPath = path.join(
            process.resourcesPath,
            'app.asar.unpacked',
            'node_modules',
            fallbackPackage,
            'package.json'
          );

          if (fs.existsSync(packageJsonPath)) {
            break;
          }
        }
      }

      if (fs.existsSync(packageJsonPath)) {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        return pkg.version;
      }
      return null;
    } else {
      // In dev mode, run the CLI to get version
      const { command, args } = getOpenCodeCliPath();
      const fullCommand = args.length > 0
        ? `"${command}" ${args.map(a => `"${a}"`).join(' ')} --version`
        : `"${command}" --version`;

      const output = execSync(fullCommand, {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();

      // Parse version from output (e.g., "opencode 1.0.0" or just "1.0.0")
      const versionMatch = output.match(/(\d+\.\d+\.\d+)/);
      return versionMatch ? versionMatch[1] : output;
    }
  } catch {
    return null;
  }
}

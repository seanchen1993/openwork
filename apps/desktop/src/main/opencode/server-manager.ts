/**
 * OpenCode Server Manager
 *
 * Manages the lifecycle of the OpenCode HTTP server process.
 * The server is started with `opencode serve --port 0` to get a dynamically assigned port.
 *
 * Responsibilities:
 * - Start the OpenCode server process
 * - Parse server output to find the assigned port
 * - Monitor server health (via stdout/stderr)
 * - Handle graceful shutdown
 */

import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { app } from 'electron';
import { getOpenCodeCliPath } from './cli-path';
import { getBundledNodePaths } from '../utils/bundled-node';
import path from 'path';
import fs from 'fs';

export interface ServerManagerEvents {
  ready: [{ baseUrl: string; port: number }];
  error: [Error];
  exit: [number | null, string | null];
}

export class OpenCodeServerManager extends EventEmitter<ServerManagerEvents> {
  private serverProcess: ChildProcess | null = null;
  private serverPort: number | null = null;
  private isStarting: boolean = false;
  private startupTimeout: NodeJS.Timeout | null = null;
  private outputBuffer: string = '';

  /**
   * Start the OpenCode server
   * @returns Promise resolving to the base URL (http://127.0.0.1:PORT)
   */
  async start(): Promise<string> {
    if (this.serverProcess) {
      throw new Error('OpenCode server is already running');
    }
    if (this.isStarting) {
      throw new Error('OpenCode server is already starting');
    }

    console.log('[ServerManager] Starting OpenCode server...');
    this.isStarting = true;
    this.outputBuffer = '';

    try {
      // Get the OpenCode CLI path
      const { command } = getOpenCodeCliPath();

      // Build environment with bundled Node.js
      const env = await this.buildEnvironment();

      // Server arguments: --port 0 for dynamic port assignment
      const args = ['serve', '--port', '0', '--hostname', '127.0.0.1'];

      // Spawn the server process
      this.serverProcess = spawn(command, args, {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Set up startup timeout (30 seconds)
      this.startupTimeout = setTimeout(() => {
        if (this.isStarting) {
          this.cleanup(new Error('Server startup timeout'));
        }
      }, 30000);

      // Handle server output to find the port
      this.serverProcess.stdout?.on('data', (data: Buffer) => {
        this.handleServerOutput(data.toString());
      });

      this.serverProcess.stderr?.on('data', (data: Buffer) => {
        this.handleServerOutput(data.toString());
      });

      // Handle server exit
      this.serverProcess.on('exit', (code, signal) => {
        console.log('[ServerManager] Server process exited:', code, signal);
        this.cleanup();
        this.emit('exit', code, signal);
      });

      // Handle server error
      this.serverProcess.on('error', (err) => {
        console.error('[ServerManager] Server process error:', err);
        this.cleanup(err);
      });

      // Wait for the port to be detected
      return new Promise((resolve, reject) => {
        this.once('ready', ({ baseUrl }) => {
          console.log('[ServerManager] Server ready at:', baseUrl);
          resolve(baseUrl);
        });
        this.once('error', reject);
      });

    } catch (error) {
      this.isStarting = false;
      throw error;
    }
  }

  /**
   * Stop the OpenCode server
   */
  async stop(): Promise<void> {
    if (!this.serverProcess) {
      return;
    }

    console.log('[ServerManager] Stopping OpenCode server...');

    // Kill the server process
    if (this.serverProcess.pid) {
      this.serverProcess.kill('SIGTERM');
    }

    // Force kill after 5 seconds if still running
    setTimeout(() => {
      if (this.serverProcess && this.serverProcess.pid) {
        console.warn('[ServerManager] Force killing server process');
        this.serverProcess.kill('SIGKILL');
      }
    }, 5000);
  }

  /**
   * Check if the server is running
   */
  isRunning(): boolean {
    return this.serverProcess !== null && !this.serverProcess.killed;
  }

  /**
   * Get the base URL of the server
   */
  getBaseUrl(): string {
    if (!this.serverPort) {
      throw new Error('Server is not ready');
    }
    return `http://127.0.0.1:${this.serverPort}`;
  }

  /**
   * Get the server port
   */
  getPort(): number {
    if (!this.serverPort) {
      throw new Error('Server is not ready');
    }
    return this.serverPort;
  }

  /**
   * Handle server output to detect the assigned port
   */
  private handleServerOutput(data: string): void {
    this.outputBuffer += data;

    // Log for debugging (but don't duplicate our own logs)
    const trimmed = data.trim();
    if (trimmed && !trimmed.startsWith('[ServerManager]')) {
      console.log('[ServerManager]', trimmed);
    }

    // Check for startup success messages
    // OpenCode server outputs various formats:
    // - "OpenCode server running at http://127.0.0.1:4096"
    // - "Server listening on port 4096"
    // - "opencode server listening on http://127.0.0.1:4096"

    // Try multiple regex patterns to find the port
    const patterns = [
      /https?:\/\/[^/:]+:(\d+)/,               // URL format: http://127.0.0.1:4096
      /listening on (?:http:\/\/[^/:]+|port)\s*:?\s*(\d+)/i,  // "listening on http://..." or "listening on port: 4096"
      /running at.*?:(\d+)/i,                    // "running at ...:4096"
    ];

    for (const pattern of patterns) {
      const match = this.outputBuffer.match(pattern);
      if (match) {
        this.serverPort = parseInt(match[1], 10);
        console.log('[ServerManager] ✓ Detected port:', this.serverPort);
        this.isStarting = false;

        if (this.startupTimeout) {
          clearTimeout(this.startupTimeout);
          this.startupTimeout = null;
        }

        this.emit('ready', {
          baseUrl: this.getBaseUrl(),
          port: this.serverPort,
        });
        return;
      }
    }

    // Check for error messages
    if (this.outputBuffer.toLowerCase().includes('error')) {
      // Check for specific errors that indicate startup failure
      if (this.outputBuffer.includes('EADDRINUSE')) {
        this.cleanup(new Error('Port already in use'));
      } else if (this.outputBuffer.includes('EACCES')) {
        this.cleanup(new Error('Permission denied to bind port'));
      }
    }

    // Trim buffer to prevent memory issues
    if (this.outputBuffer.length > 10000) {
      this.outputBuffer = this.outputBuffer.slice(-5000);
    }
  }

  /**
   * Build environment variables for the server process
   */
  private async buildEnvironment(): Promise<NodeJS.ProcessEnv> {
    const env: NodeJS.ProcessEnv = { ...process.env };

    if (app.isPackaged) {
      // Add bundled Node.js to PATH
      const bundledNode = getBundledNodePaths();
      if (bundledNode) {
        const delimiter = process.platform === 'win32' ? ';' : ':';
        const existingPath = env.PATH ?? env.Path ?? '';
        env.PATH = `${bundledNode.binDir}${delimiter}${existingPath}`;
        if (process.platform === 'win32') {
          env.Path = env.PATH;
        }
      }
    }

    // Add OpenCode config directory - this is where the generated opencode.json lives
    // The server needs to read this config to find the "accomplish" agent
    const configDir = path.join(app.getPath('userData'), 'opencode');
    if (fs.existsSync(configDir)) {
      env.OPENCODE_CONFIG_DIR = configDir;
      env.OPENCODE_CONFIG = path.join(configDir, 'opencode.json');
      console.log('[ServerManager] Setting OPENCODE_CONFIG_DIR:', configDir);
    } else {
      console.warn('[ServerManager] Config directory does not exist:', configDir);
    }

    return env;
  }

  /**
   * Cleanup resources
   */
  private cleanup(error?: Error): void {
    this.isStarting = false;

    if (this.startupTimeout) {
      clearTimeout(this.startupTimeout);
      this.startupTimeout = null;
    }

    if (error) {
      console.error('[ServerManager] Error:', error.message);
      this.emit('error', error);

      // Kill the process if there was an error
      if (this.serverProcess) {
        try {
          this.serverProcess.kill();
        } catch {
          // Ignore
        }
        this.serverProcess = null;
      }
    }
  }
}

/**
 * Singleton instance of the server manager
 */
let serverManagerInstance: OpenCodeServerManager | null = null;

/**
 * Get the singleton server manager instance
 */
export function getServerManager(): OpenCodeServerManager {
  if (!serverManagerInstance) {
    serverManagerInstance = new OpenCodeServerManager();
  }
  return serverManagerInstance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetServerManager(): void {
  if (serverManagerInstance) {
    serverManagerInstance.removeAllListeners();
    serverManagerInstance = null;
  }
}

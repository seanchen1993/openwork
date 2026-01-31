/**
 * OpenCode Adapter - SDK-based implementation
 *
 * This adapter uses the @opencode-ai/sdk to communicate with the OpenCode server
 * instead of using node-pty directly. This eliminates Windows ConPTY JSON parsing issues.
 *
 * Architecture:
 * - ServerManager starts OpenCode server (opencode serve --port 0)
 * - Adapter connects to server via HTTP/SSE using SDK
 * - Events are streamed as structured JSON (no parsing needed)
 *
 * Preserved from original PTY-based adapter:
 * - CompletionEnforcer for task completion logic
 * - LogWatcher for CLI error detection
 * - Event interface (OpenCodeAdapterEvents) for backward compatibility
 * - Message handling logic (handleMessage)
 */

import { EventEmitter } from 'events';
import { app } from 'electron';
import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk/v2';
import { OpenCodeLogWatcher, createLogWatcher, type OpenCodeLogError } from './log-watcher';
import { CompletionEnforcer, type CompletionEnforcerCallbacks } from './completion';
import {
  getOpenCodeCliPath,
  isOpenCodeBundled,
} from './cli-path';
import { getAllApiKeys } from '../store/secureStorage';
import { getSelectedModel } from '../store/appSettings';
import { getActiveProviderModel } from '../store/providerSettings';
import { generateOpenCodeConfig, ACCOMPLISH_AGENT_NAME } from './config-generator';
import type {
  TaskConfig,
  Task,
  TaskMessage,
  TaskResult,
  OpenCodeMessage,
  PermissionRequest,
  TodoItem,
} from '@accomplish/shared';

/**
 * Error thrown when OpenCode CLI is not available
 */
export class OpenCodeCliNotFoundError extends Error {
  constructor() {
    super(
      'OpenCode CLI is not available. The bundled CLI may be missing or corrupted. Please reinstall the application.'
    );
    this.name = 'OpenCodeCliNotFoundError';
  }
}

/**
 * Check if OpenCode CLI is available (bundled or installed)
 */
export async function isOpenCodeCliInstalled(): Promise<boolean> {
  return isOpenCodeBundled();
}

/**
 * Get OpenCode CLI version
 */
export async function getOpenCodeCliVersion(): Promise<string | null> {
  // For now, just return null - version check not critical for SDK mode
  return null;
}

export interface OpenCodeAdapterEvents {
  message: [OpenCodeMessage];
  'tool-use': [string, unknown];
  'tool-result': [string];
  'permission-request': [PermissionRequest];
  progress: [{ stage: string; message?: string; modelName?: string }];
  complete: [TaskResult];
  error: [Error];
  debug: [{ type: string; message: string; data?: unknown }];
  'todo:update': [TodoItem[]];
  'auth-error': [{ providerId: string; message: string }];
}

/**
 * Convert SDK event to OpenCodeMessage format
 * The SDK event format differs from the current OpenCodeMessage format,
 * so we need to transform them.
 */
function convertSdkEventToMessage(sdkEvent: unknown): OpenCodeMessage | null {
  const event = sdkEvent as { type?: string; properties?: Record<string, unknown> };

  // Handle different event types from the SDK
  const eventType = event.type || 'unknown';
  const props = event.properties || {};

  switch (eventType) {
    case 'text':
      return {
        type: 'text',
        timestamp: Date.now(),
        sessionID: String(props.sessionID || ''),
        part: {
          id: String(props.id || ''),
          sessionID: String(props.sessionID || ''),
          messageID: String(props.messageID || ''),
          type: 'text',
          text: String(props.text || ''),
        },
      } as OpenCodeMessage;

    case 'tool_call':
      return {
        type: 'tool_call',
        timestamp: Date.now(),
        sessionID: String(props.sessionID || ''),
        part: {
          id: String(props.id || ''),
          sessionID: String(props.sessionID || ''),
          messageID: String(props.messageID || ''),
          type: 'tool-call',
          tool: String(props.tool || ''),
          input: props.input,
        },
      } as OpenCodeMessage;

    case 'tool_result':
      return {
        type: 'tool_result',
        timestamp: Date.now(),
        sessionID: String(props.sessionID || ''),
        part: {
          id: String(props.id || ''),
          sessionID: String(props.sessionID || ''),
          messageID: String(props.messageID || ''),
          type: 'tool-result',
          toolCallID: String(props.toolCallID || props.toolCallId || ''),
          output: String(props.output || ''),
        },
      } as OpenCodeMessage;

    case 'step_start':
      return {
        type: 'step_start',
        timestamp: Date.now(),
        sessionID: String(props.sessionID || ''),
        part: {
          id: String(props.id || ''),
          sessionID: String(props.sessionID || ''),
          messageID: String(props.messageID || ''),
          type: 'step-start',
        },
      } as OpenCodeMessage;

    case 'step_finish':
      return {
        type: 'step_finish',
        timestamp: Date.now(),
        sessionID: String(props.sessionID || ''),
        part: {
          id: String(props.id || ''),
          sessionID: String(props.sessionID || ''),
          messageID: String(props.messageID || ''),
          type: 'step-finish',
          reason: String(props.reason || 'stop') as 'error' | 'tool_use' | 'stop' | 'end_turn',
        },
      } as OpenCodeMessage;

    case 'error':
      return {
        type: 'error',
        timestamp: Date.now(),
        error: String(props.error || 'Unknown error'),
      } as OpenCodeMessage;

    default:
      console.log('[Adapter] Unknown SDK event type:', eventType, props);
      return null;
  }
}

export class OpenCodeAdapter extends EventEmitter<OpenCodeAdapterEvents> {
  private client: OpencodeClient;
  private sessionId: string | null = null;
  private messageTaskId: string | null = null;
  private messages: TaskMessage[] = [];
  private hasCompleted: boolean = false;
  private isDisposed: boolean = false;
  private wasInterrupted: boolean = false;
  private completionEnforcer: CompletionEnforcer;
  private lastWorkingDirectory: string | undefined;
  /** Current model ID for display name */
  private currentModelId: string | null = null;
  /** Timer for transitioning from 'connecting' to 'waiting' stage */
  private waitingTransitionTimer: ReturnType<typeof setTimeout> | null = null;
  /** Whether the first tool has been received (to stop showing startup stages) */
  private hasReceivedFirstTool: boolean = false;
  private eventController: AbortController | null = null;

  /**
   * Create a new OpenCodeAdapter instance
   * @param serverUrl - The base URL of the OpenCode server
   * @param taskId - Optional task ID for this adapter instance
   */
  constructor(serverUrl: string, taskId?: string) {
    super();

    this.messageTaskId = taskId || null;

    // Create SDK client
    this.client = createOpencodeClient({ baseUrl: serverUrl });

    // Create completion enforcer with callbacks
    this.completionEnforcer = this.createCompletionEnforcer();
  }

  /**
   * Create the CompletionEnforcer with callbacks
   */
  private createCompletionEnforcer(): CompletionEnforcer {
    const callbacks: CompletionEnforcerCallbacks = {
      onStartContinuation: async (prompt: string) => {
        await this.sendContinuationPrompt(prompt);
      },
      onComplete: () => {
        this.hasCompleted = true;
        if (this.wasInterrupted) {
          console.log('[CompletionEnforcer] Task was interrupted, emitting interrupted status');
          this.emit('complete', {
            status: 'interrupted',
            sessionId: this.sessionId || undefined,
          });
        } else {
          this.emit('complete', {
            status: 'success',
            sessionId: this.sessionId || undefined,
          });
        }
      },
      onDebug: (type: string, message: string, data?: unknown) => {
        this.emit('debug', { type, message, data });
      },
    };
    return new CompletionEnforcer(callbacks);
  }

  /**
   * Start a new task with OpenCode CLI
   */
  async startTask(config: TaskConfig): Promise<Task> {
    // Check if adapter has been disposed
    if (this.isDisposed) {
      throw new Error('Adapter has been disposed and cannot start new tasks');
    }

    // Check if OpenCode CLI is installed before attempting to start
    const cliInstalled = await isOpenCodeCliInstalled();
    if (!cliInstalled) {
      throw new OpenCodeCliNotFoundError();
    }

    const taskId = config.taskId || this.generateTaskId();
    this.messageTaskId = taskId;
    this.sessionId = null;
    this.messages = [];
    this.hasCompleted = false;
    this.wasInterrupted = false;
    this.completionEnforcer.reset();
    this.lastWorkingDirectory = config.workingDirectory;
    this.hasReceivedFirstTool = false;
    this.isDisposed = false;

    // Clear any existing waiting transition timer
    if (this.waitingTransitionTimer) {
      clearTimeout(this.waitingTransitionTimer);
      this.waitingTransitionTimer = null;
    }

    // Sync API keys to OpenCode CLI's auth.json
    await generateOpenCodeConfig();

    // Emit 'loading' stage
    this.emit('progress', { stage: 'loading', message: 'Starting task...' });

    try {
      // Create a new session
      const sessionResponse = await this.client.session.create({
        title: taskId,
      });

      this.sessionId = sessionResponse.data?.id || null;
      console.log('[Adapter] Session created:', this.sessionId);

      if (!this.sessionId) {
        throw new Error('Failed to create session: no session ID returned');
      }

      // Start listening to events via SSE
      this.startEventStream();

      // Build model configuration
      const modelConfig = this.buildModelConfig();

      // Send the prompt to the session
      this.emit('progress', { stage: 'connecting', message: 'Sending prompt...' });

      // Use promptAsync for non-blocking start
      await this.client.session.promptAsync({
        sessionID: this.sessionId,
        model: modelConfig,
        parts: [{ type: 'text', text: config.prompt }],
        agent: ACCOMPLISH_AGENT_NAME,
      });

      return {
        id: taskId,
        prompt: config.prompt,
        status: 'running',
        messages: [],
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error('[Adapter] Error starting task:', error);
      this.hasCompleted = true;
      this.emit('error', error as Error);
      throw error;
    }
  }

  /**
   * Resume an existing session
   */
  async resumeSession(sessionId: string, prompt: string): Promise<Task> {
    return this.startTask({
      prompt,
      sessionId,
    });
  }

  /**
   * Start listening to events via SSE
   */
  private startEventStream(): void {
    if (!this.sessionId) {
      throw new Error('Cannot start event stream: no session ID');
    }

    // Subscribe to global events (returns a Promise)
    this.client.global.event().then((result) => {
      // Process the event stream
      this.processEventStream(result.stream);
    }).catch((error: unknown) => {
      if (!this.isDisposed) {
        console.error('[Adapter] Event stream error:', error);
      }
    });
  }

  /**
   * Process SSE event stream
   */
  private async processEventStream(stream: AsyncGenerator<unknown, unknown, unknown>): Promise<void> {
    try {
      for await (const event of stream) {
        if (this.isDisposed) {
          break;
        }

        const message = convertSdkEventToMessage(event);
        if (message) {
          this.handleMessage(message);
        }
      }
    } catch (error) {
      if (!this.isDisposed) {
        console.error('[Adapter] Error processing event stream:', error);
      }
    }
  }

  /**
   * Send user response for permission/question
   */
  async sendResponse(response: string): Promise<void> {
    if (!this.sessionId) {
      throw new Error('No active session');
    }

    await this.client.session.prompt({
      sessionID: this.sessionId,
      parts: [{ type: 'text', text: response }],
    });

    console.log('[Adapter] Response sent');
  }

  /**
   * Send a continuation prompt (for completion enforcement)
   */
  private async sendContinuationPrompt(prompt: string): Promise<void> {
    if (!this.sessionId) {
      throw new Error('No session ID available for continuation');
    }

    console.log(`[Adapter] Sending continuation prompt for session ${this.sessionId}`);

    await this.client.session.prompt({
      sessionID: this.sessionId,
      parts: [{ type: 'text', text: prompt }],
    });
  }

  /**
   * Cancel the current task (hard kill)
   */
  async cancelTask(): Promise<void> {
    this.hasCompleted = true;
    this.wasInterrupted = true;

    if (this.sessionId) {
      try {
        await this.client.session.abort({
          sessionID: this.sessionId,
        });
      } catch (error) {
        console.warn('[Adapter] Error aborting session:', error);
      }
    }

    // Stop event stream
    if (this.eventController) {
      this.eventController.abort();
      this.eventController = null;
    }
  }

  /**
   * Interrupt the current task (graceful)
   */
  async interruptTask(): Promise<void> {
    this.wasInterrupted = true;

    if (this.sessionId) {
      try {
        await this.client.session.abort({
          sessionID: this.sessionId,
        });
      } catch (error) {
        console.warn('[Adapter] Error interrupting session:', error);
      }
    }
  }

  /**
   * Get the current session ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Get the current task ID
   */
  getTaskId(): string | null {
    return this.messageTaskId;
  }

  /**
   * Check if the adapter has been disposed
   */
  isAdapterDisposed(): boolean {
    return this.isDisposed;
  }

  /**
   * Dispose the adapter and clean up all resources
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }

    console.log(`[Adapter] Disposing adapter for task ${this.messageTaskId}`);
    this.isDisposed = true;

    // Stop event stream
    if (this.eventController) {
      this.eventController.abort();
      this.eventController = null;
    }

    // Clear state
    this.sessionId = null;
    this.messageTaskId = null;
    this.messages = [];
    this.hasCompleted = true;
    this.currentModelId = null;
    this.hasReceivedFirstTool = false;

    // Clear waiting transition timer
    if (this.waitingTransitionTimer) {
      clearTimeout(this.waitingTransitionTimer);
      this.waitingTransitionTimer = null;
    }

    // Remove all listeners
    this.removeAllListeners();

    console.log('[Adapter] Adapter disposed');
  }

  /**
   * Build model configuration from settings
   */
  private buildModelConfig(): { providerID: string; modelID: string } {
    const activeModel = getActiveProviderModel();
    const selectedModel = activeModel || getSelectedModel();

    this.currentModelId = selectedModel?.model || null;

    if (!selectedModel?.model) {
      // Default model
      return {
        providerID: 'anthropic',
        modelID: 'claude-3-5-sonnet-20241022',
      };
    }

    // Parse model ID (format: "provider/model" or just "model")
    const parts = selectedModel.model.split('/');
    if (parts.length === 2) {
      return {
        providerID: parts[0],
        modelID: parts[1],
      };
    }

    // Use provider from settings
    return {
      providerID: selectedModel.provider || 'anthropic',
      modelID: selectedModel.model,
    };
  }

  /**
   * Handle incoming messages from the SDK
   * Preserved from original PTY-based adapter
   */
  private handleMessage(message: OpenCodeMessage): void {
    console.log('[Adapter] Handling message type:', message.type);

    switch (message.type) {
      // Step start event
      case 'step_start':
        if (message.part?.sessionID) {
          this.sessionId = message.part.sessionID;
        }
        this.emit('progress', { stage: 'connecting', message: 'Starting...' });
        break;

      // Text content event
      case 'text':
        if (!this.sessionId && message.part?.sessionID) {
          this.sessionId = message.part.sessionID;
        }
        this.emit('message', message);

        if (message.part?.text) {
          const taskMessage: TaskMessage = {
            id: this.generateMessageId(),
            type: 'assistant',
            content: message.part.text,
            timestamp: new Date().toISOString(),
          };
          this.messages.push(taskMessage);
        }
        break;

      // Tool call event
      case 'tool_call':
        const toolName = message.part?.tool || 'unknown';
        const toolInput = message.part?.input;

        console.log('[Adapter] Tool call:', toolName);

        if (!this.hasReceivedFirstTool) {
          this.hasReceivedFirstTool = true;
          if (this.waitingTransitionTimer) {
            clearTimeout(this.waitingTransitionTimer);
            this.waitingTransitionTimer = null;
          }
        }

        this.completionEnforcer.markToolsUsed();

        // Track complete_task calls
        if (toolName === 'complete_task' || toolName.endsWith('_complete_task')) {
          this.completionEnforcer.handleCompleteTaskDetection(toolInput);
        }

        // Track todowrite calls
        if (toolName === 'todowrite' || toolName.endsWith('_todowrite')) {
          const input = toolInput as { todos?: TodoItem[] };
          if (input?.todos && Array.isArray(input.todos) && input.todos.length > 0) {
            this.emit('todo:update', input.todos);
            this.completionEnforcer.updateTodos(input.todos);
          }
        }

        this.emit('tool-use', toolName, toolInput);
        this.emit('progress', { stage: 'tool-use', message: `Using ${toolName}` });

        // Check if this is AskUserQuestion
        if (toolName === 'AskUserQuestion') {
          this.handleAskUserQuestion(toolInput as AskUserQuestionInput);
        }
        break;

      // Tool result event
      case 'tool_result':
        const toolOutput = message.part?.output || '';
        console.log('[Adapter] Tool result received, length:', toolOutput.length);
        this.emit('tool-result', toolOutput);
        break;

      // Step finish event
      case 'step_finish':
        if (message.part?.reason === 'error') {
          if (!this.hasCompleted) {
            this.hasCompleted = true;
            this.emit('complete', {
              status: 'error',
              sessionId: this.sessionId || undefined,
              error: 'Task failed',
            });
          }
          break;
        }

        const action = this.completionEnforcer.handleStepFinish(message.part?.reason || 'stop');
        console.log(`[Adapter] step_finish action: ${action}`);

        if (action === 'complete' && !this.hasCompleted) {
          this.hasCompleted = true;
          this.emit('complete', {
            status: 'success',
            sessionId: this.sessionId || undefined,
          });
        }
        break;

      // Error event
      case 'error':
        this.hasCompleted = true;
        this.emit('complete', {
          status: 'error',
          sessionId: this.sessionId || undefined,
          error: message.error || 'Unknown error',
        });
        break;

      default:
        console.log('[Adapter] Unknown message type:', (message as { type: string }).type);
    }
  }

  private handleAskUserQuestion(input: AskUserQuestionInput): void {
    const question = input.questions?.[0];
    if (!question) return;

    const permissionRequest: PermissionRequest = {
      id: this.generateRequestId(),
      taskId: this.messageTaskId || '',
      type: 'question',
      question: question.question,
      options: question.options?.map((o) => ({
        label: o.label,
        description: o.description,
      })),
      multiSelect: question.multiSelect,
      createdAt: new Date().toISOString(),
    };

    this.emit('permission-request', permissionRequest);
  }

  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}

interface AskUserQuestionInput {
  questions?: Array<{
    question: string;
    header?: string;
    options?: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }>;
}

/**
 * Factory function to create a new adapter instance
 */
export function createAdapter(serverUrl: string, taskId?: string): OpenCodeAdapter {
  return new OpenCodeAdapter(serverUrl, taskId);
}

/**
 * @deprecated Singleton pattern no longer used with SDK architecture
 */
let adapterInstance: OpenCodeAdapter | null = null;

/**
 * @deprecated Use createAdapter() with serverUrl instead
 */
export function getOpenCodeAdapter(): OpenCodeAdapter {
  if (!adapterInstance) {
    throw new Error('getOpenCodeAdapter is deprecated. Use createAdapter(serverUrl, taskId?) instead.');
  }
  return adapterInstance;
}

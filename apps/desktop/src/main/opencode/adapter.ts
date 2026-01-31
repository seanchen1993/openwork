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
import { getModelDisplayName } from '../utils/model-display';
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
 *
 * SDK SSE event format:
 * {
 *   "payload": {
 *     "type": "message.part.updated",
 *     "properties": {
 *       "part": {
 *         "type": "text" | "tool" | "step-start" | "step-finish" | ...
 *       }
 *     }
 *   }
 * }
 */
function convertSdkEventToMessage(
  sdkEvent: unknown,
  currentSessionId: string | null,
  emittedToolCalls: Set<string>,
  emittedToolResults: Set<string>,
  emittedTextParts: Set<string>
): OpenCodeMessage | null {
  const event = sdkEvent as Record<string, unknown>;

  // Extract payload from SSE event
  const payload = 'payload' in event && typeof event.payload === 'object'
    ? (event.payload as Record<string, unknown>)
    : event;

  const eventType = (payload.type as string) || 'unknown';

  // Extract properties if available
  const props = 'properties' in payload && typeof payload.properties === 'object'
    ? (payload.properties as Record<string, unknown>)
    : {};

  // Ignore server-level events that aren't session messages
  if (eventType === 'server.connected' || eventType === 'server.heartbeat' || eventType === 'message.updated' || eventType === 'session.created') {
    return null;
  }

  // Handle message.part.updated events - extract the part and filter by session
  if (eventType === 'message.part.updated' && 'part' in props) {
    const part = props.part as Record<string, unknown>;

    // Filter by sessionID from the part (not from properties)
    if ('sessionID' in part && currentSessionId) {
      const partSessionId = String(part.sessionID);
      if (partSessionId !== currentSessionId) {
        return null; // Ignore events for other sessions
      }
    }

    const partType = String(part.type || 'unknown');

    switch (partType) {
      case 'text': {
        const textPart = part as {
          id: string;
          sessionID: string;
          messageID: string;
          type: 'text';
          text: string;
          time?: {
            start: number;
            end?: number;
          };
        };

        const partId = textPart.id;

        // Only emit text when it's complete (has time.end)
        // SDK sends incremental updates; we wait for completion
        if (!textPart.time?.end) {
          return null; // Text still being generated, wait for completion
        }

        // Only emit each text part once
        if (emittedTextParts.has(partId)) {
          return null;
        }
        emittedTextParts.add(partId);

        return {
          type: 'text',
          timestamp: Date.now(),
          sessionID: textPart.sessionID,
          part: {
            id: textPart.id,
            sessionID: textPart.sessionID,
            messageID: textPart.messageID,
            type: 'text',
            text: textPart.text, // Send complete text
            time: textPart.time,
          },
        } as OpenCodeMessage;
      }

      case 'tool': {
        const toolPart = part as {
          id: string;
          sessionID: string;
          messageID: string;
          type: 'tool';
          callID: string;
          tool: string;
          state: {
            status: 'pending' | 'running' | 'completed' | 'error';
            input?: { [key: string]: unknown };
            output?: string;
            error?: string;
          };
          time?: {
            start: number;
            end?: number;
          };
        };

        const status = toolPart.state.status;
        const partId = toolPart.id;

        // For completed/error tools, emit tool_result event (only once per part)
        if (status === 'completed' || status === 'error') {
          if (emittedToolResults.has(partId)) {
            return null; // Already emitted result for this tool
          }
          emittedToolResults.add(partId);
          return {
            type: 'tool_result',
            timestamp: Date.now(),
            sessionID: toolPart.sessionID,
            part: {
              id: toolPart.id,
              sessionID: toolPart.sessionID,
              messageID: toolPart.messageID,
              type: 'tool-result',
              toolCallID: toolPart.callID,
              output: status === 'completed' ? (toolPart.state.output || '') : (toolPart.state.error || ''),
              isError: status === 'error',
              time: toolPart.time,
            },
          } as OpenCodeMessage;
        }

        // For pending/running tools, emit tool_call event (only once per part)
        if (emittedToolCalls.has(partId)) {
          return null; // Already emitted call for this tool
        }
        emittedToolCalls.add(partId);
        return {
          type: 'tool_call',
          timestamp: Date.now(),
          sessionID: toolPart.sessionID,
          part: {
            id: toolPart.id,
            sessionID: toolPart.sessionID,
            messageID: toolPart.messageID,
            type: 'tool-call',
            tool: toolPart.tool,
            input: toolPart.state.input,
            time: toolPart.time,
          },
        } as OpenCodeMessage;
      }

      case 'step-start': {
        const stepPart = part as {
          id: string;
          sessionID: string;
          messageID: string;
          type: 'step-start';
        };
        return {
          type: 'step_start',
          timestamp: Date.now(),
          sessionID: stepPart.sessionID,
          part: {
            id: stepPart.id,
            sessionID: stepPart.sessionID,
            messageID: stepPart.messageID,
            type: 'step-start',
          },
        } as OpenCodeMessage;
      }

      case 'step-finish': {
        const stepPart = part as {
          id: string;
          sessionID: string;
          messageID: string;
          type: 'step-finish';
          reason: string;
        };
        return {
          type: 'step_finish',
          timestamp: Date.now(),
          sessionID: stepPart.sessionID,
          part: {
            id: stepPart.id,
            sessionID: stepPart.sessionID,
            messageID: stepPart.messageID,
            type: 'step-finish',
            reason: stepPart.reason as 'error' | 'tool_use' | 'stop' | 'end_turn',
          },
        } as OpenCodeMessage;
      }

      default:
        console.log('[Adapter] Unhandled part type:', partType);
        return null;
    }
  }

  // Handle session.status events
  if (eventType === 'session.status') {
    return null;
  }

  // For other events (not message.part.updated), filter by sessionID in properties
  if (eventType !== 'message.part.updated' && 'sessionID' in props && currentSessionId) {
    const eventSessionId = String(props.sessionID);
    if (eventSessionId !== currentSessionId) {
      return null;
    }
  }

  // Handle session.error events
  if (eventType === 'session.error') {
    const error = String(props.error || 'Unknown error');
    return {
      type: 'error',
      timestamp: Date.now(),
      error,
    } as OpenCodeMessage;
  }

  // Handle permission.asked events
  if (eventType === 'permission.asked') {
    // Permission request will be handled separately
    return null;
  }

  console.log('[Adapter] Unknown event:', eventType);
  return null;
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
  /** Track emitted tool calls to avoid duplicates */
  private emittedToolCalls = new Set<string>();
  /** Track emitted tool results to avoid duplicates */
  private emittedToolResults = new Set<string>();
  /** Track emitted text parts to avoid duplicates */
  private emittedTextParts = new Set<string>();

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
    this.emittedToolCalls.clear();
    this.emittedToolResults.clear();
    this.emittedTextParts.clear();

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
      // Create a new session with working directory
      const sessionResponse = await this.client.session.create({
        directory: config.workingDirectory,
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
      console.log('[Adapter] Model config:', JSON.stringify(modelConfig));
      console.log('[Adapter] Working directory:', config.workingDirectory);
      console.log('[Adapter] Prompt text:', config.prompt?.substring(0, 100));

      // Use promptAsync for non-blocking start
      console.log('[Adapter] Calling promptAsync with sessionID:', this.sessionId);
      const promptResult = await this.client.session.promptAsync({
        directory: config.workingDirectory,
        sessionID: this.sessionId,
        model: modelConfig,
        parts: [{ type: 'text', text: config.prompt }],
        agent: ACCOMPLISH_AGENT_NAME,
      });
      console.log('[Adapter] promptAsync result:', JSON.stringify(promptResult));

      return {
        id: taskId,
        prompt: config.prompt,
        status: 'running',
        messages: [],
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        workingDirectory: config.workingDirectory,
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
    console.log('[Adapter] Event stream started for session:', this.sessionId);
    try {
      for await (const event of stream) {
        if (this.isDisposed) {
          break;
        }

        const message = convertSdkEventToMessage(
          event,
          this.sessionId,
          this.emittedToolCalls,
          this.emittedToolResults,
          this.emittedTextParts
        );
        if (message) {
          this.handleMessage(message);
        }
      }
    } catch (error) {
      if (!this.isDisposed) {
        console.error('[Adapter] Event stream error:', error);
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
    switch (message.type) {
      // Step start event
      case 'step_start':
        if (message.part?.sessionID) {
          this.sessionId = message.part.sessionID;
        }
        // Emit 'connecting' stage with model display name
        const modelDisplayName = this.currentModelId
          ? getModelDisplayName(this.currentModelId)
          : 'AI';
        this.emit('progress', {
          stage: 'connecting',
          message: `Connecting to ${modelDisplayName}...`,
          modelName: modelDisplayName,
        });
        // Start timer to transition to 'waiting' stage after 500ms if no tool received
        if (this.waitingTransitionTimer) {
          clearTimeout(this.waitingTransitionTimer);
        }
        this.waitingTransitionTimer = setTimeout(() => {
          if (!this.hasReceivedFirstTool && !this.hasCompleted) {
            this.emit('progress', { stage: 'waiting', message: 'Waiting for response...' });
          }
        }, 500);
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

        // Emit message event for tool call (UI displays this in conversation)
        this.emit('message', message);
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
        // Emit message event for tool result (UI displays this in conversation)
        this.emit('message', message);
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

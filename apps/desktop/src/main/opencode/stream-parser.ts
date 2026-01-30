import { EventEmitter } from 'events';
import type { OpenCodeMessage } from '@accomplish/shared';

export interface StreamParserEvents {
  message: [OpenCodeMessage];
  error: [Error];
}

// Maximum buffer size to prevent memory exhaustion (10MB)
const MAX_BUFFER_SIZE = 10 * 1024 * 1024;

/**
 * Parses NDJSON (newline-delimited JSON) stream from OpenCode CLI
 *
 * Handles Windows PTY buffering issues where JSON objects may be fragmented
 * across multiple data chunks at arbitrary positions (not at newline boundaries).
 *
 * Uses brace counting to detect complete JSON objects instead of line-based parsing.
 */
export class StreamParser extends EventEmitter<StreamParserEvents> {
  private buffer: string = '';

  /**
   * Feed raw data from stdout
   */
  feed(chunk: string): void {
    console.log('[StreamParser.feed] ENTER - chunk length:', chunk.length, 'first 50 chars:', chunk.substring(0, 50).replace(/\n/g, '\\n'));

    // Normalize Windows line endings (\r\n -> \n) to prevent parsing issues
    this.buffer += chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    console.log('[StreamParser.feed] Buffer size after adding:', this.buffer.length);

    // Parse complete JSON objects using brace counting
    // This handles Windows PTY fragmentation where chunks split at arbitrary positions
    this.parseBuffer();

    console.log('[StreamParser.feed] After parseBuffer - buffer size:', this.buffer.length);

    // Prevent memory exhaustion from malformed data
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.emit('error', new Error('Stream buffer size exceeded maximum limit'));
      this.buffer = '';
    }

    console.log('[StreamParser.feed] EXIT');
  }

  /**
   * Parse complete JSON objects from the buffer using brace counting.
   * This handles Windows PTY fragmentation where JSON is split at arbitrary positions.
   */
  private parseBuffer(): void {
    // Use iterative approach instead of recursive to avoid stack overflow
    // when parsing many messages in a single buffer
    let parsedCount = 0;
    const MAX_ITERATIONS = 100000; // Safety limit to prevent infinite loops

    while (this.buffer.length > 0 && parsedCount < MAX_ITERATIONS) {
      let depth = 0;
      let inString = false;
      let escapeNext = false;
      let jsonObjStart = -1;
      let parsedOne = false;

      for (let i = 0; i < this.buffer.length; i++) {
        const char = this.buffer[i];

        // Handle escape sequences in strings
        if (escapeNext) {
          escapeNext = false;
          continue;
        }

        if (char === '\\') {
          escapeNext = true;
          continue;
        }

        // Track whether we're inside a string
        if (char === '"') {
          inString = !inString;
          continue;
        }

        // Only count braces when not in a string
        if (!inString) {
          if (char === '{') {
            if (depth === 0) {
              jsonObjStart = i;
            }
            depth++;
          } else if (char === '}') {
            if (depth > 0) {
              depth--;
              // When depth returns to 0, we have a complete JSON object
              if (depth === 0 && jsonObjStart >= 0) {
                const jsonStr = this.buffer.substring(jsonObjStart, i + 1);
                this.parseJsonObject(jsonStr);

                // Remove the parsed JSON from the buffer
                this.buffer = this.buffer.substring(i + 1);
                console.log('[parseBuffer] Parsed JSON, remaining buffer size:', this.buffer.length);

                parsedOne = true;
                parsedCount++;
                break; // Break out of the for loop to continue the while loop
              }
            }
          }
        }
      }

      // If we didn't parse a complete JSON object in this iteration,
      // we've reached the end of complete JSON - exit the loop
      if (!parsedOne) {
        if (this.buffer.length > 0) {
          console.log('[parseBuffer] No complete JSON found, buffer size:', this.buffer.length);
        }
        break;
      }

      // Otherwise, continue the while loop to parse the next JSON object
    }
  }

  /**
   * Parse a single JSON object string
   */
  private parseJsonObject(jsonStr: string): void {
    const trimmed = jsonStr.trim();
    console.log('[parseJsonObject] ENTER - string length:', trimmed.length, 'first 80 chars:', trimmed.substring(0, 80));

    if (!trimmed) {
      return;
    }

    // Try to parse the JSON
    const message = this.tryParseJson(trimmed);
    if (message) {
      this.emitMessage(message);
    } else {
      // JSON parse failed - this shouldn't happen with brace counting, but log it
      console.log('[parseJsonObject] Failed to parse JSON despite complete braces');
    }
  }

  /**
   * Try to parse a JSON string, returns the message or null if invalid
   */
  private tryParseJson(jsonStr: string): OpenCodeMessage | null {
    console.log('[tryParseJson] ENTER - string length:', jsonStr.length, 'first 100 chars:', jsonStr.substring(0, 100).replace(/\n/g, '\\n'));
    try {
      const result = JSON.parse(jsonStr) as OpenCodeMessage;
      console.log('[tryParseJson] SUCCESS - type:', result.type);
      return result;
    } catch (error) {
      // Log JSON parsing failures to help diagnose Windows PTY issues
      const preview = jsonStr.substring(0, 200);
      const errorStr = error instanceof Error ? error.message : String(error);
      console.error('[StreamParser] JSON parse failed:', errorStr);
      console.error('[StreamParser] JSON preview (first 200 chars):', preview.replace(/\n/g, '\\n'));
      return null;
    }
  }

  /**
   * Emit a parsed message with enhanced logging
   */
  private emitMessage(message: OpenCodeMessage): void {
    console.log('[emitMessage] ENTER - emitting message type:', message.type);

    // Enhanced logging for MCP/Playwriter-related messages
    if (message.type === 'tool_call' || message.type === 'tool_result') {
      const part = message.part as Record<string, unknown>;
      console.log('[StreamParser] Tool message details:', {
        type: message.type,
        tool: part?.tool,
        hasInput: !!part?.input,
        hasOutput: !!part?.output,
      });

      // Check if it's a dev-browser tool
      const toolName = String(part?.tool || '').toLowerCase();
      const output = String(part?.output || '').toLowerCase();
      if (toolName.includes('dev-browser') ||
          toolName.includes('browser') ||
          toolName.includes('mcp') ||
          output.includes('dev-browser') ||
          output.includes('browser')) {
        console.log('[StreamParser] >>> DEV-BROWSER MESSAGE <<<');
        console.log('[StreamParser] Full message:', JSON.stringify(message, null, 2));
      }
    }

    console.log('[emitMessage] About to emit via EventEmitter...');
    this.emit('message', message);
    console.log('[emitMessage] Emitted successfully');
  }

  /**
   * Flush any remaining buffer content
   */
  flush(): void {
    // Try to parse any remaining data in the buffer
    if (this.buffer.trim()) {
      console.log('[flush] Attempting to parse remaining buffer, size:', this.buffer.length);
      const message = this.tryParseJson(this.buffer.trim());
      if (message) {
        console.log('[flush] Parsed remaining JSON on flush');
        this.emitMessage(message);
      } else {
        console.log('[flush] Could not parse remaining buffer');
      }
    }
    this.buffer = '';
  }

  /**
   * Reset the parser
   */
  reset(): void {
    this.buffer = '';
  }
}

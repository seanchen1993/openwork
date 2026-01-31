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

    // Clean the chunk before adding to buffer
    // Windows PTY may insert various control characters that break JSON parsing
    let cleanedChunk = chunk;

    // Normalize Windows line endings (\r\n -> \n)
    cleanedChunk = cleanedChunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Remove ANSI escape sequences (CSI: ESC[ ... followed by a letter)
    cleanedChunk = cleanedChunk.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');

    // Remove OSC sequences (ESC] ... BEL or ESC)
    cleanedChunk = cleanedChunk.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '');

    // Remove other control characters (except whitespace: \n, \t, \r)
    // This handles cases where PTY inserts random control chars in the middle of JSON
    cleanedChunk = cleanedChunk.replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/g, '');

    this.buffer += cleanedChunk;

    console.log('[StreamParser.feed] Buffer size after adding:', this.buffer.length);

    // Parse complete JSON objects using brace counting
    // This handles Windows PTY fragmentation where chunks split at arbitrary positions
    this.parseBuffer();

    console.log('[StreamParser.feed] After parseBuffer - buffer size:', this.buffer.length);

    console.log('[StreamParser.feed] EXIT');
  }

  /**
   * Parse complete JSON objects from the buffer using brace counting.
   * This handles Windows PTY fragmentation where JSON is split at arbitrary positions.
   */
  private parseBuffer(): void {
    // First, skip any non-JSON content at the start of the buffer
    // This handles shell banners, ANSI escape sequences, terminal decorations, etc.
    this.skipNonJsonPrefix();

    // Use iterative approach instead of recursive to avoid stack overflow
    // when parsing many messages in a single buffer
    let parsedCount = 0;
    const MAX_ITERATIONS = 100000; // Safety limit to prevent infinite loops

    while (this.buffer.length > 0 && parsedCount < MAX_ITERATIONS) {
      // Skip non-JSON content before each parse attempt
      this.skipNonJsonPrefix();

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
      // we've reached the end of complete JSON - check if remaining buffer is too large
      if (!parsedOne) {
        // Check if the remaining incomplete buffer exceeds the limit
        if (this.buffer.length > MAX_BUFFER_SIZE) {
          this.emit('error', new Error('Stream buffer size exceeded maximum limit'));
          this.buffer = '';
        } else if (this.buffer.length > 0) {
          console.log('[parseBuffer] No complete JSON found, buffer size:', this.buffer.length);
        }
        break;
      }

      // Otherwise, continue the while loop to parse the next JSON object
    }
  }

  /**
   * Skip non-JSON content at the start of the buffer.
   * This handles shell banners, ANSI escape sequences, terminal decorations, etc.
   */
  private skipNonJsonPrefix(): void {
    let skipCount = 0;
    const maxSkip = 10000; // Don't skip more than 10KB at once

    for (let i = 0; i < Math.min(this.buffer.length, maxSkip); i++) {
      const char = this.buffer[i];

      // If we find a '{', this might be JSON start - stop skipping
      if (char === '{') {
        break;
      }

      // Skip ASCII control characters (except whitespace)
      if (char < ' ' && char !== '\n' && char !== '\r' && char !== '\t') {
        skipCount = i + 1;
        continue;
      }

      // Skip ANSI escape sequences
      if (char === '\x1b' && i + 1 < this.buffer.length && this.buffer[i + 1] === '[') {
        // CSI sequence: \x1b[ ... until a letter
        let j = i + 2;
        while (j < this.buffer.length && j < i + 50 && this.buffer[j] >= ' ' && this.buffer[j] <= '~') {
          // Wait for terminator (a letter in @-Z or a-z)
          const c = this.buffer[j];
          if ((c >= '@' && c <= 'Z') || (c >= 'a' && c <= 'z')) {
            skipCount = j + 1;
            i = j;
            break;
          }
          j++;
        }
        continue;
      }

      // Skip terminal decoration characters (box drawing, etc.) only at line start
      if (this.isTerminalDecorationChar(char) && (i === 0 || this.buffer[i - 1] === '\n')) {
        // Look ahead to see if this is a decoration line
        let j = i + 1;
        while (j < this.buffer.length && j < i + 50) {
          const c = this.buffer[j];
          if (c === '\n') {
            // Entire line looks like decoration - skip it
            skipCount = j + 1;
            i = j;
            break;
          }
          if (!this.isTerminalDecorationChar(c) && c !== ' ' && c !== '\t' && c !== '\r') {
            // Not a decoration line - stop skipping
            break;
          }
          j++;
        }
        continue;
      }

      // Skip whitespace and newlines
      if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
        skipCount = i + 1;
        continue;
      }

      // If we get here with a non-{ char, check if it's a known garbage line pattern
      // (like "Welcome to...", "Using...", etc.)
      if (char !== '{' && (i === 0 || this.buffer[i - 1] === '\n')) {
        // Check if this line looks like a shell banner/info message
        // by looking for common patterns
        let j = i;
        let looksLikeBanner = true;
        let bannerLength = 0;

        // Scan until newline
        while (j < this.buffer.length && j < i + 200 && this.buffer[j] !== '\n') {
          const c = this.buffer[j];
          // If we see any JSON-like structure, it's not a banner
          if (c === '{' || c === '}' || c === ':') {
            looksLikeBanner = false;
            break;
          }
          // If we see too many non-ASCII printable chars, it's probably not a banner
          if (c < ' ' || c > '~') {
            // Could be binary data or Unicode - be conservative
            looksLikeBanner = false;
            break;
          }
          j++;
          bannerLength++;
        }

        // Only skip if it's a reasonably short line that looks like a banner
        if (looksLikeBanner && bannerLength > 0 && bannerLength < 200 && j < this.buffer.length && this.buffer[j] === '\n') {
          skipCount = j + 1;
          i = j;
          continue;
        }

        // Otherwise, stop skipping - this might be valid data
        break;
      }

      // Stop skipping for any other content
      break;
    }

    if (skipCount > 0) {
      this.buffer = this.buffer.substring(skipCount);
      if (skipCount > 50) {
        console.log('[skipNonJsonPrefix] Skipped', skipCount, 'bytes of non-JSON prefix');
      }
    }
  }

  /**
   * Check if a character is a terminal decoration character
   */
  private isTerminalDecorationChar(char: string): boolean {
    const code = char.charCodeAt(0);
    // Box drawing characters (U+2500-U+257F)
    // Block elements (U+2580-U+259F)
    // Geometric shapes (U+25A0-U+25FF)
    // And other common terminal decoration chars
    return (code >= 0x2500 && code <= 0x25FF) ||
           char === '│' || char === '┌' || char === '┐' || char === '└' || char === '┘' ||
           char === '├' || char === '┤' || char === '┬' || char === '┴' || char === '┼' ||
           char === '─' || char === '◆' || char === '●' || char === '○' || char === '◇';
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
      // JSON parse failed - try cleaning and retry once
      const cleaned = this.cleanJsonString(trimmed);
      if (cleaned !== trimmed) {
        console.log('[parseJsonObject] Retrying with cleaned JSON');
        const retryMessage = this.tryParseJson(cleaned);
        if (retryMessage) {
          this.emitMessage(retryMessage);
          return;
        }
      }
      console.log('[parseJsonObject] Failed to parse JSON despite complete braces');
    }
  }

  /**
   * Clean a JSON string that may have embedded control characters or corruption.
   * This handles cases where PTY inserts garbage in the middle of JSON strings.
   *
   * Key issues handled:
   * - Windows PTY embeds literal newlines/tabs inside JSON string values
   * - Control characters inside strings cause JSON.parse() to fail
   * - Unterminated strings from PTY truncation
   */
  private cleanJsonString(jsonStr: string): string {
    let inString = false;
    let escapeNext = false;
    const result: string[] = [];

    for (let i = 0; i < jsonStr.length; i++) {
      const char = jsonStr[i];
      const code = char.charCodeAt(0);

      // Handle escape sequences
      if (escapeNext) {
        result.push(char);
        escapeNext = false;
        continue;
      }

      // Backslash starts an escape sequence
      if (char === '\\') {
        result.push(char);
        escapeNext = true;
        continue;
      }

      // Quote toggles string mode
      if (char === '"') {
        inString = !inString;
        result.push(char);
        continue;
      }

      // Inside a string: remove problematic control characters
      if (inString) {
        // Remove literal newlines, tabs, and other control chars inside strings
        // These would cause JSON.parse to fail with "Bad control character" error
        if (code <= 0x1F || code === 0x7F) {
          // Skip this character - don't add to result
          // Log for debugging
          if (code === 0x0A || code === 0x0D || code === 0x09) {
            console.log('[cleanJsonString] Removed control char inside string:', code, 'at position', i);
          }
          continue;
        }
        result.push(char);
        continue;
      }

      // Outside a string: keep structural whitespace but remove other control chars
      if (code === 0x0A || code === 0x0D || code === 0x09) {
        // Keep newlines, tabs, carriage returns for structure
        result.push(char);
      } else if (code > 0x1F && code !== 0x7F) {
        // Keep printable characters
        result.push(char);
      }
      // Other control chars outside strings are removed
    }

    const cleaned = result.join('');

    // If we're still in a string at the end, the JSON was truncated
    // Try to close it properly by finding the last valid point
    if (inString) {
      console.log('[cleanJsonString] Unterminated string detected, attempting to close');
      // Find the last complete structure before the truncated string
      let lastValidPos = cleaned.length - 1;
      for (let i = cleaned.length - 1; i >= 0; i--) {
        const c = cleaned[i];
        if (c === '}' || c === ']' || c === ',') {
          lastValidPos = i;
          break;
        }
        if (c === '{' || c === '[') {
          // Found opening bracket, truncate here
          lastValidPos = i - 1;
          break;
        }
      }
      if (lastValidPos > 0) {
        return cleaned.substring(0, lastValidPos + 1);
      }
    }

    return cleaned;
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

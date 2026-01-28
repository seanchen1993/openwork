'use client';

import { useMemo } from 'react';
import { FileText, Wrench, Plus } from 'lucide-react';
import { PanelSection } from '../layout/RightPanel';
import type { TaskMessage } from '@accomplish/shared';

interface ContextPanelProps {
  messages: TaskMessage[];
}

export default function ContextPanel({ messages }: ContextPanelProps) {
  // Extract unique tools and files from messages
  const { tools, files } = useMemo(() => {
    const toolSet = new Set<string>();
    const fileSet = new Set<string>();

    messages.forEach((msg) => {
      // Extract tool names
      if (msg.type === 'tool' && msg.toolName) {
        // Clean up tool name (remove MCP prefixes)
        const baseName = msg.toolName.includes('_') 
          ? msg.toolName.split('_').slice(-1)[0]
          : msg.toolName;
        toolSet.add(baseName);
      }

      // Extract file paths from tool inputs
      if (msg.toolInput) {
        const input = msg.toolInput as Record<string, unknown>;
        if (input.path && typeof input.path === 'string') {
          fileSet.add(input.path);
        }
        if (input.filePath && typeof input.filePath === 'string') {
          fileSet.add(input.filePath);
        }
      }

      // Try to extract file paths from content (basic pattern matching)
      if (msg.content) {
        const pathMatches = msg.content.match(/\/[\w\-./]+\.\w+/g);
        if (pathMatches) {
          pathMatches.slice(0, 5).forEach((path) => fileSet.add(path));
        }
      }
    });

    return {
      tools: Array.from(toolSet).slice(0, 10),
      files: Array.from(fileSet).slice(0, 10),
    };
  }, [messages]);

  const hasContent = tools.length > 0 || files.length > 0;

  return (
    <PanelSection title="上下文">
      <div className="flex flex-col gap-3">
        {hasContent ? (
          <>
            {/* Tools used */}
            {tools.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground font-medium">工具</div>
                <div className="flex flex-wrap gap-1.5">
                  {tools.map((tool) => (
                    <span
                      key={tool}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted text-xs text-muted-foreground"
                    >
                      <Wrench className="w-3 h-3" />
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Files referenced */}
            {files.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground font-medium">文件</div>
                <div className="space-y-1">
                  {files.slice(0, 5).map((file) => (
                    <div
                      key={file}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/50 text-xs"
                    >
                      <FileText className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                      <span className="truncate text-foreground">
                        {file.split('/').pop()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center relative">
                <FileText className="w-5 h-5 text-muted-foreground" />
                <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-background border border-border flex items-center justify-center">
                  <Plus className="w-2.5 h-2.5 text-muted-foreground" />
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              跟踪此任务中使用的工具和引用的文件。
            </p>
          </>
        )}
      </div>
    </PanelSection>
  );
}

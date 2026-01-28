'use client';

import { CheckCircle2 } from 'lucide-react';
import { PanelSection } from '../layout/RightPanel';
import type { TodoItem } from '@accomplish/shared';

interface ProgressPanelProps {
  todos: TodoItem[];
}

export default function ProgressPanel({ todos }: ProgressPanelProps) {
  const completedCount = todos.filter(t => t.status === 'completed').length;
  const totalCount = todos.length;

  return (
    <PanelSection title="进度">
      <div className="flex flex-col gap-3">
        {totalCount > 0 ? (
          <>
            {/* Progress indicator */}
            <div className="flex items-center gap-2">
              {todos.slice(0, 6).map((todo) => (
                <div
                  key={todo.id}
                  className={`w-6 h-6 rounded-full flex items-center justify-center ${
                    todo.status === 'completed'
                      ? 'bg-[#4A9B7F]'
                      : todo.status === 'in_progress'
                      ? 'bg-[var(--cowork-primary)]/30 animate-pulse'
                      : 'bg-muted'
                  }`}
                >
                  {todo.status === 'completed' ? (
                    <CheckCircle2 className="w-4 h-4 text-white" />
                  ) : (
                    <div className={`w-2 h-2 rounded-full ${
                      todo.status === 'in_progress' ? 'bg-[var(--cowork-primary)]' : 'bg-muted-foreground/30'
                    }`} />
                  )}
                </div>
              ))}
              <span className="text-xs text-muted-foreground ml-2">
                {completedCount} / {totalCount}
              </span>
            </div>
            {/* Todo list */}
            <div className="space-y-2">
              {todos.map((todo) => (
                <div key={todo.id} className="flex items-start gap-2 text-sm">
                  <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    todo.status === 'completed' ? 'bg-[#4A9B7F]' : 'border border-muted-foreground/30'
                  }`}>
                    {todo.status === 'completed' && (
                      <CheckCircle2 className="w-3 h-3 text-white" />
                    )}
                  </div>
                  <span className={todo.status === 'completed' ? 'text-muted-foreground line-through' : 'text-foreground'}>
                    {todo.content}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />
              </div>
              <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />
              </div>
              <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />
              </div>
              <span className="text-xs text-muted-foreground ml-2">0 / 0</span>
            </div>
            <p className="text-xs text-muted-foreground">
              查看较长任务的进度。
            </p>
          </>
        )}
      </div>
    </PanelSection>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useTaskStore } from '@/stores/taskStore';
import { getAccomplish } from '@/lib/accomplish';
import { staggerContainer } from '@/lib/animations';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import ConversationListItem from './ConversationListItem';
import SettingsDialog from './SettingsDialog';
import { Settings, MessageSquarePlus } from 'lucide-react';

// Cmb Cowork Logo - orange starburst
const CmbCoworkLogo = () => (
  <div className="flex items-center gap-2">
    <svg width="24" height="24" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M24 4L26.5 18L41 10L30 21.5L44 24L30 26.5L41 38L26.5 30L24 44L21.5 30L7 38L18 26.5L4 24L18 21.5L7 10L21.5 18L24 4Z" fill="#E07B54" />
    </svg>
    <span className="text-sm font-semibold text-foreground">Cmb Cowork</span>
  </div>
);

export default function Sidebar() {
  const navigate = useNavigate();
  const [showSettings, setShowSettings] = useState(false);
  const { tasks, loadTasks, updateTaskStatus, addTaskUpdate } = useTaskStore();
  const accomplish = getAccomplish();

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Subscribe to task status changes (queued -> running) and task updates (complete/error)
  // This ensures sidebar always reflects current task status
  useEffect(() => {
    const unsubscribeStatusChange = accomplish.onTaskStatusChange?.((data) => {
      updateTaskStatus(data.taskId, data.status);
    });

    const unsubscribeTaskUpdate = accomplish.onTaskUpdate((event) => {
      addTaskUpdate(event);
    });

    return () => {
      unsubscribeStatusChange?.();
      unsubscribeTaskUpdate();
    };
  }, [updateTaskStatus, addTaskUpdate, accomplish]);

  const handleNewConversation = () => {
    navigate('/');
  };

  return (
    <>
      <div className="flex h-screen w-[240px] flex-col border-r border-border bg-[var(--cowork-bg)] pt-4">
        {/* Logo - Top Left */}
        <div className="px-4 py-3 pt-8">
          <CmbCoworkLogo />
        </div>

        {/* New Task Button */}
        <div className="px-3 py-3">
          <button
            data-testid="sidebar-new-task-button"
            onClick={handleNewConversation}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/50 rounded-lg transition-colors"
          >
            <MessageSquarePlus className="h-4 w-4" />
            新任务
            <span className="ml-auto text-xs text-muted-foreground">⌘⇧O</span>
          </button>
        </div>

        {/* Recents Label */}
        <div className="px-4 py-2">
          <span className="text-xs font-medium text-muted-foreground">最近</span>
        </div>

        {/* Conversation List */}
        <ScrollArea className="flex-1">
          <div className="px-2 space-y-0.5">
            <AnimatePresence mode="wait">
              {tasks.length === 0 ? (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="px-3 py-8 text-center text-sm text-muted-foreground"
                >
                  暂无任务
                </motion.div>
              ) : (
                <motion.div
                  key="task-list"
                  variants={staggerContainer}
                  initial="initial"
                  animate="animate"
                  className="space-y-0.5"
                >
                  {tasks.map((task) => (
                    <ConversationListItem key={task.id} task={task} />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </ScrollArea>

        {/* Info text */}
        <div className="px-4 py-3 text-xs text-muted-foreground">
          这些任务在本地运行，不会跨设备同步
        </div>

        {/* Bottom Section - Settings */}
        <div className="px-3 py-3 border-t border-border flex items-center justify-end">
          {/* Settings Button */}
          <Button
            data-testid="sidebar-settings-button"
            variant="ghost"
            size="icon"
            onClick={() => setShowSettings(true)}
            title="设置"
            className="h-8 w-8"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <SettingsDialog open={showSettings} onOpenChange={setShowSettings} />
    </>
  );
}

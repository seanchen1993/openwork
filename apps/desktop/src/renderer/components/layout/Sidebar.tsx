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

// Logo - elegant serif style like Claude
const CmbCoworkLogo = () => (
  <div className="flex items-center justify-start">
    <span 
      className="text-[23px] text-foreground"
      style={{ 
        fontFamily: 'Tiempos, Georgia, "Times New Roman", Times, serif',
        fontWeight: 700,
        letterSpacing: '-0.02em',
        lineHeight: 1
      }}
    >
      Cmb Cowork
    </span>
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
        {/* Logo - Top Center */}
        <div className="px-4 py-4 pt-10">
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

        {/* Bottom Section - Settings */}
        <div className="px-4 py-4 border-t border-border/50">
          <Button
            data-testid="sidebar-settings-button"
            variant="ghost"
            size="icon"
            onClick={() => setShowSettings(true)}
            title="设置"
            className="h-11 w-11 rounded-lg hover:bg-muted/80"
          >
            <Settings className="h-[22px] w-[22px]" />
          </Button>
        </div>
      </div>

      <SettingsDialog open={showSettings} onOpenChange={setShowSettings} />
    </>
  );
}

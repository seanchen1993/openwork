'use client';

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { 
  FileText, 
  BarChart3, 
  Palette, 
  FolderOpen, 
  Calendar, 
  MessageSquare,
  ArrowRight,
  Folder,
  FileText as FileIcon,
  Plus,
} from 'lucide-react';
import TaskInputBar from '../components/landing/TaskInputBar';
import QuickTaskCard from '../components/landing/QuickTaskCard';
import FolderSelector from '../components/FolderSelector';
import SettingsDialog from '../components/layout/SettingsDialog';
import { useTaskStore } from '../stores/taskStore';
import { getAccomplish } from '../lib/accomplish';
import { springs } from '../lib/animations';
import { Button } from '@/components/ui/button';
import { hasAnyReadyProvider } from '@accomplish/shared';
import { PanelSection } from '../components/layout/RightPanel';


// Quick task definitions - Chinese
const QUICK_TASKS = [
  {
    id: 'create-file',
    title: '创建文件',
    icon: FileText,
    prompt: '帮我创建一个新文件。你想创建什么类型的文件？',
  },
  {
    id: 'crunch-data',
    title: '处理数据',
    icon: BarChart3,
    prompt: '帮我分析和处理一些数据。你想处理什么数据？',
  },
  {
    id: 'make-prototype',
    title: '制作原型',
    icon: Palette,
    prompt: '帮我创建一个原型。你想创建什么类型的原型？',
  },
  {
    id: 'organize-files',
    title: '整理文件',
    icon: FolderOpen,
    prompt: '整理当前文件夹。请提出任何澄清问题，并分享你将如何处理这项任务的计划。',
  },
  {
    id: 'prep-meeting',
    title: '准备会议',
    icon: Calendar,
    prompt: '帮我准备即将到来的会议。你想准备什么会议？',
  },
  {
    id: 'draft-message',
    title: '起草消息',
    icon: MessageSquare,
    prompt: '帮我起草一条消息。你想让我写什么类型的消息？',
  },
];

export default function HomePage() {
  const [prompt, setPrompt] = useState('');
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<'providers' | 'voice'>('providers');
  const { 
    startTask, 
    isLoading, 
    addTaskUpdate, 
    setPermissionRequest,
    workingDirectory,
    setWorkingDirectory,
  } = useTaskStore();
  const navigate = useNavigate();
  const accomplish = getAccomplish();

  // Subscribe to task events
  useEffect(() => {
    const unsubscribeTask = accomplish.onTaskUpdate((event) => {
      addTaskUpdate(event);
    });

    const unsubscribePermission = accomplish.onPermissionRequest((request) => {
      setPermissionRequest(request);
    });

    return () => {
      unsubscribeTask();
      unsubscribePermission();
    };
  }, [addTaskUpdate, setPermissionRequest, accomplish]);

  const executeTask = useCallback(async (taskPrompt: string) => {
    if (!taskPrompt.trim() || isLoading) return;

    const taskId = `task_${Date.now()}`;
    const task = await startTask({ 
      prompt: taskPrompt.trim(), 
      taskId,
      workingDirectory: workingDirectory || undefined,
    });
    if (task) {
      navigate(`/execution/${task.id}`);
    }
  }, [isLoading, startTask, navigate, workingDirectory]);

  const handleSubmit = async () => {
    if (!prompt.trim() || isLoading) return;

    // Check if any provider is ready before sending (skip in E2E mode)
    const isE2EMode = await accomplish.isE2EMode();
    if (!isE2EMode) {
      const settings = await accomplish.getProviderSettings();
      if (!hasAnyReadyProvider(settings)) {
        setSettingsInitialTab('providers');
        setShowSettingsDialog(true);
        return;
      }
    }

    await executeTask(prompt);
  };

  const handleQuickTaskClick = (taskPrompt: string) => {
    setPrompt(taskPrompt);
  };

  const handleSettingsDialogChange = (open: boolean) => {
    setShowSettingsDialog(open);
    if (!open) {
      setSettingsInitialTab('providers');
    }
  };

  const handleApiKeySaved = async () => {
    setShowSettingsDialog(false);
    if (prompt.trim()) {
      await executeTask(prompt);
    }
  };

  return (
    <>
      <SettingsDialog
        open={showSettingsDialog}
        onOpenChange={handleSettingsDialogChange}
        onApiKeySaved={handleApiKeySaved}
        initialTab={settingsInitialTab}
      />
      
      <div className="h-full flex bg-[var(--cowork-bg)]">
        {/* Main content area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-8 pt-16 pb-32">
            <div className="max-w-2xl mx-auto">
              {/* Title */}
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={springs.gentle}
                className="mb-10"
              >
                <h1 
                  data-testid="home-title"
                  className="text-[32px] text-foreground leading-tight"
                  style={{ fontFamily: 'Georgia, "Times New Roman", Times, serif', fontWeight: 400, letterSpacing: '-0.01em' }}
                >
                  一起搞定待办清单吧
                </h1>
              </motion.div>

              {/* Quick Task Cards - 2 rows x 3 columns */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...springs.gentle, delay: 0.2 }}
                className="grid grid-cols-3 gap-3"
              >
                {QUICK_TASKS.map((task) => (
                  <QuickTaskCard
                    key={task.id}
                    title={task.title}
                    icon={task.icon}
                    onClick={() => handleQuickTaskClick(task.prompt)}
                  />
                ))}
              </motion.div>
            </div>
          </div>

          {/* Bottom Input Bar - Fixed */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...springs.gentle, delay: 0.3 }}
            className="flex-shrink-0 bg-[var(--cowork-bg)] px-8 py-6"
          >
            <div className="max-w-2xl mx-auto">
              {/* Input Container */}
              <div className="bg-card rounded-2xl border border-border shadow-sm">
                {/* Text Input Area */}
                <div className="p-4">
                  <TaskInputBar
                    value={prompt}
                    onChange={setPrompt}
                    onSubmit={handleSubmit}
                    isLoading={isLoading}
                    placeholder="今天我能帮你做什么？"
                    large={false}
                    autoFocus={true}
                    autoSubmitOnTranscription={false}
                    hideSubmitButton={true}
                    minimal={true}
                    hideSpeechButton={true}
                  />
                </div>

                {/* Bottom Actions Bar */}
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2">
                    {/* Folder Selector */}
                    <FolderSelector onFolderSelect={setWorkingDirectory} />
                  </div>

                  <div className="flex items-center gap-3">
                    {/* Submit Button */}
                    <Button
                      onClick={handleSubmit}
                      disabled={!prompt.trim() || isLoading}
                      className="gap-2 px-5 bg-[var(--cowork-primary)] hover:bg-[var(--cowork-primary)]/90 text-white"
                    >
                      开始
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Right Side Panels */}
        <motion.aside
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={springs.gentle}
          className="w-[320px] h-full flex-shrink-0 border-l border-border bg-card/50 overflow-y-auto"
        >
          <div className="p-4 pt-14 space-y-4">
            {/* Progress Panel */}
            <PanelSection title="进度">
              <div className="flex flex-col items-center gap-3">
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
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  查看较长任务的进度。
                </p>
              </div>
            </PanelSection>

            {/* Working Folder Panel */}
            <PanelSection title="工作文件夹">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                  <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                    <Folder className="w-5 h-5 text-muted-foreground" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  查看和打开此任务期间创建的文件。
                </p>
              </div>
            </PanelSection>

            {/* Context Panel */}
            <PanelSection title="上下文">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                  <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center relative">
                    <FileIcon className="w-5 h-5 text-muted-foreground" />
                    <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-background border border-border flex items-center justify-center">
                      <Plus className="w-2.5 h-2.5 text-muted-foreground" />
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  跟踪此任务中使用的工具和引用的文件。
                </p>
              </div>
            </PanelSection>
          </div>
        </motion.aside>
      </div>
    </>
  );
}

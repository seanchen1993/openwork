'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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
  Code,
  GitBranch,
  Bug,
  Search,
  AlertCircle,
} from 'lucide-react';
import TaskInputBar from '../components/landing/TaskInputBar';
import QuickTaskCard from '../components/landing/QuickTaskCard';
import FolderSelector from '../components/FolderSelector';
import SettingsDialog from '../components/layout/SettingsDialog';
import { useTaskStore } from '../stores/taskStore';
import { getAccomplish, getFolderName } from '../lib/accomplish';
import { springs } from '../lib/animations';
import { Button } from '@/components/ui/button';
import { hasAnyReadyProvider } from '@accomplish/shared';
import { PanelSection } from '../components/layout/RightPanel';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';


// Programming skills
const PROGRAMMING_SKILLS = [
  {
    id: 'code-review',
    title: '代码检视',
    icon: Code,
    prompt: '帮我进行代码检视。请提供需要检视的代码文件或路径。',
  },
  {
    id: 'architecture-review',
    title: '架构巡检',
    icon: GitBranch,
    prompt: '帮我进行架构巡检。请提供需要巡检的项目或模块。',
  },
  {
    id: 'debug-issue',
    title: '调试问题',
    icon: Bug,
    prompt: '帮我调试代码问题。请描述遇到的问题或相关代码。',
  },
];

// Non-programming skills
const NON_PROGRAMMING_SKILLS = [
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
  const [showFolderDialog, setShowFolderDialog] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const hasMountedRef = useRef(false);
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

  // Clear working directory when returning to home page from execution
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      // Only clear if we're not initially loading the page (i.e., returning from execution)
      // The task store already loads the task's working directory when needed
      return;
    }
    // When user navigates back to home, clear the working directory for a fresh start
    setWorkingDirectory(null);
  }, [setWorkingDirectory]);

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

  const executeTask = useCallback(async (taskPrompt: string, overrideWorkingDirectory?: string) => {
    if (!taskPrompt.trim() || isLoading || isExecuting) return;

    setIsExecuting(true);
    try {
      const taskId = `task_${Date.now()}`;
      const task = await startTask({
        prompt: taskPrompt.trim(),
        taskId,
        workingDirectory: overrideWorkingDirectory || workingDirectory || undefined,
      });
      if (task) {
        navigate(`/execution/${task.id}`);
      }
    } finally {
      setIsExecuting(false);
    }
  }, [isLoading, isExecuting, startTask, navigate, workingDirectory]);

  const handleSelectFolderAndExecute = async () => {
    try {
      const path = await accomplish.selectFolder?.();
      if (path) {
        setWorkingDirectory(path);
        setShowFolderDialog(false);
        // Execute task with the selected path directly (don't rely on state update)
        await executeTask(prompt, path);
      }
    } catch (error) {
      console.error('Failed to select folder:', error);
    }
  };

  const handleSubmit = async () => {
    if (!prompt.trim() || isLoading || isExecuting) return;

    // Require working directory to be selected
    if (!workingDirectory) {
      setShowFolderDialog(true);
      return;
    }

    // Check if any provider is ready before sending (skip in E2E mode)
    const isE2EMode = await accomplish.isE2EMode();
    if (!isE2EMode) {
      const settings = await accomplish.getProviderSettings();
      if (!hasAnyReadyProvider(settings)) {
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
      />

      {/* Folder Selection Required Dialog */}
      <Dialog open={showFolderDialog} onOpenChange={setShowFolderDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Folder className="w-5 h-5 text-[var(--cowork-primary)]" />
              选择工作文件夹
            </DialogTitle>
            <DialogDescription>
              请先选择一个工作文件夹，以便在此任务期间创建和保存文件。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center py-6 gap-4">
            <div className="w-16 h-16 rounded-full bg-[var(--cowork-primary)]/10 flex items-center justify-center">
              <Folder className="w-8 h-8 text-[var(--cowork-primary)]" />
            </div>
            <p className="text-sm text-muted-foreground text-center">
              选择一个文件夹作为工作目录，所有在此任务期间创建的文件都将保存在此处。
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowFolderDialog(false)}
              disabled={isExecuting}
            >
              取消
            </Button>
            <Button
              onClick={handleSelectFolderAndExecute}
              disabled={isExecuting}
              className="gap-2 bg-[var(--cowork-primary)] hover:bg-[var(--cowork-primary)]/90 text-white"
            >
              {isExecuting ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  执行中...
                </>
              ) : (
                <>
                  <FolderOpen className="w-4 h-4" />
                  选择文件夹并开始
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <div className="h-full flex bg-[var(--cowork-bg)]">
        {/* Main content area */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {/* Background grid pattern */}
          <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{
            backgroundImage: `radial-gradient(circle, currentColor 1px, transparent 1px)`,
            backgroundSize: '24px 24px',
          }} />

          <div className="flex-1 overflow-y-auto px-8 pt-16 pb-32 relative">
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

              {/* Programming Skills Section */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...springs.gentle, delay: 0.2 }}
                className="mb-8"
              >
                <h3 className="text-xs font-medium text-muted-foreground/70 mb-3 px-1">编程技能</h3>
                <div className="grid grid-cols-3 gap-3">
                  {PROGRAMMING_SKILLS.map((task) => (
                    <QuickTaskCard
                      key={task.id}
                      title={task.title}
                      icon={task.icon}
                      onClick={() => handleQuickTaskClick(task.prompt)}
                    />
                  ))}
                </div>
              </motion.div>

              {/* Non-Programming Skills Section */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...springs.gentle, delay: 0.3 }}
              >
                <h3 className="text-xs font-medium text-muted-foreground/70 mb-3 px-1">非编程技能</h3>
                <div className="grid grid-cols-3 gap-3">
                  {NON_PROGRAMMING_SKILLS.map((task) => (
                    <QuickTaskCard
                      key={task.id}
                      title={task.title}
                      icon={task.icon}
                      onClick={() => handleQuickTaskClick(task.prompt)}
                    />
                  ))}
                </div>
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
                      disabled={!prompt.trim() || isLoading || isExecuting}
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
          className="w-[320px] h-full flex-shrink-0 bg-[var(--cowork-bg)] overflow-y-auto"
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
                {workingDirectory ? (
                  <button
                    onClick={async () => {
                      if (workingDirectory) {
                        await accomplish.openPath?.(workingDirectory);
                      }
                    }}
                    className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors text-left w-full"
                  >
                    <div className="w-10 h-10 rounded-lg bg-[var(--cowork-primary)]/10 flex items-center justify-center flex-shrink-0">
                      <Folder className="w-5 h-5 text-[var(--cowork-primary)]" />
                    </div>
                    <span className="text-sm font-medium text-foreground truncate flex-1" title={workingDirectory}>
                      {getFolderName(workingDirectory)}
                    </span>
                  </button>
                ) : (
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                      <AlertCircle className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <span className="text-sm text-muted-foreground">未选择文件夹</span>
                  </div>
                )}
                <p className="text-xs text-muted-foreground break-all">
                  {workingDirectory
                    ? `工作文件夹已设置。点击可在文件管理器中打开。`
                    : '请选择一个工作文件夹以开始任务。'}
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

'use client';

import { Folder, ExternalLink } from 'lucide-react';
import { PanelSection } from '../layout/RightPanel';
import { Button } from '@/components/ui/button';
import { getAccomplish } from '@/lib/accomplish';

interface WorkingFolderPanelProps {
  workingDirectory: string | null;
}

export default function WorkingFolderPanel({ workingDirectory }: WorkingFolderPanelProps) {
  const accomplish = getAccomplish();

  const handleOpenFolder = async () => {
    if (workingDirectory) {
      // Open folder in system file manager
      await accomplish.openPath?.(workingDirectory);
    }
  };

  // Extract folder name from path
  const folderName = workingDirectory 
    ? workingDirectory.split('/').filter(Boolean).pop() || workingDirectory
    : null;

  return (
    <PanelSection 
      title="工作文件夹"
      action={
        workingDirectory ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleOpenFolder}
            title="在 Finder 中打开"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        ) : null
      }
    >
      <div className="flex flex-col gap-3">
        {workingDirectory ? (
          <>
            <button
              onClick={handleOpenFolder}
              className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-[var(--cowork-primary)]/10 flex items-center justify-center">
                <Folder className="w-5 h-5 text-[var(--cowork-primary)]" />
              </div>
              <span className="text-sm font-medium text-foreground truncate">
                {folderName}
              </span>
            </button>
            <p className="text-xs text-muted-foreground">
              查看和打开此任务期间创建的文件。
            </p>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                <Folder className="w-5 h-5 text-muted-foreground" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              查看和打开此任务期间创建的文件。
            </p>
          </>
        )}
      </div>
    </PanelSection>
  );
}

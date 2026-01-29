'use client';

import { useState, useEffect } from 'react';
import { Folder, ChevronDown, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTaskStore } from '@/stores/taskStore';
import { getAccomplish, getFolderName } from '@/lib/accomplish';

interface FolderSelectorProps {
  onFolderSelect?: (path: string | null) => void;
}

export default function FolderSelector({ onFolderSelect }: FolderSelectorProps) {
  const { workingDirectory, recentFolders, setWorkingDirectory, loadRecentFolders } = useTaskStore();
  const [isOpen, setIsOpen] = useState(false);
  const accomplish = getAccomplish();

  useEffect(() => {
    loadRecentFolders();
  }, [loadRecentFolders]);

  const handleSelectFolder = async () => {
    try {
      const result = await accomplish.selectFolder?.();
      if (result) {
        setWorkingDirectory(result);
        onFolderSelect?.(result);
      }
    } catch (error) {
      console.error('Failed to select folder:', error);
    }
  };

  const handleSelectRecent = (path: string) => {
    setWorkingDirectory(path);
    onFolderSelect?.(path);
    setIsOpen(false);
  };

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="gap-2 text-sm font-normal text-muted-foreground hover:text-foreground max-w-[180px]"
        >
          <Folder className="w-4 h-4 flex-shrink-0" />
          <span className="truncate">{workingDirectory ? getFolderName(workingDirectory) : '选择文件夹'}</span>
          <ChevronDown className="w-3.5 h-3.5 opacity-50 flex-shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[300px]">
        {recentFolders.length > 0 && (
          <>
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
              最近
            </div>
            {recentFolders.slice(0, 5).map((folder) => (
              <DropdownMenuItem
                key={folder}
                onClick={() => handleSelectRecent(folder)}
                className="flex items-start gap-2 py-2"
              >
                <Folder className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="font-medium truncate">{getFolderName(folder)}</span>
                  <span className="text-xs text-muted-foreground break-all">{folder}</span>
                </div>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onClick={handleSelectFolder} className="gap-2">
          <Plus className="w-4 h-4" />
          <span>选择其他文件夹</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

'use client';

import { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { springs } from '@/lib/animations';

interface RightPanelProps {
  children: ReactNode;
  visible?: boolean;
}

export default function RightPanel({ children, visible = true }: RightPanelProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.aside
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 20 }}
          transition={springs.gentle}
          className="w-[280px] h-screen flex-shrink-0 border-l border-border bg-card/50 overflow-y-auto"
        >
          <div className="p-4 pt-14 space-y-4">
            {children}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

interface PanelSectionProps {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  collapsible?: boolean;
  defaultExpanded?: boolean;
}

export function PanelSection({ 
  title, 
  children, 
  action,
  collapsible = false,
  defaultExpanded = true 
}: PanelSectionProps) {
  return (
    <div className="bg-card rounded-lg border border-border">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {action}
      </div>
      <div className="p-4">
        {children}
      </div>
    </div>
  );
}

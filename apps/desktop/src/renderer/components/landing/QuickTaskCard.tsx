'use client';

import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';
import { springs } from '@/lib/animations';

interface QuickTaskCardProps {
  title: string;
  icon: LucideIcon;
  onClick: () => void;
}

export default function QuickTaskCard({ title, icon: Icon, onClick }: QuickTaskCardProps) {
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      transition={springs.gentle}
      onClick={onClick}
      className="flex items-center gap-3 p-4 rounded-xl bg-[var(--cowork-bg)] border border-border hover:shadow-sm transition-all duration-200 text-left w-full"
    >
      <div className="w-10 h-10 rounded-lg bg-muted/50 flex items-center justify-center flex-shrink-0">
        <Icon className="w-5 h-5 text-muted-foreground" />
      </div>
      <span className="text-sm font-medium text-foreground">{title}</span>
    </motion.button>
  );
}

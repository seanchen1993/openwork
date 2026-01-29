// apps/desktop/src/renderer/components/settings/ProviderSettingsPanel.tsx

import { AnimatePresence, motion } from 'framer-motion';
import type { ConnectedProvider } from '@accomplish/shared';
import { settingsVariants, settingsTransitions } from '@/lib/animations';
import { ClassicProviderForm, LiteLLMProviderForm } from './providers';

interface ProviderSettingsPanelProps {
  providerId: 'deepseek' | 'litellm';
  connectedProvider?: ConnectedProvider;
  onConnect: (provider: ConnectedProvider) => void;
  onDisconnect: () => void;
  onModelChange: (modelId: string) => void;
  showModelError: boolean;
}

export function ProviderSettingsPanel({
  providerId,
  connectedProvider,
  onConnect,
  onDisconnect,
  onModelChange,
  showModelError,
}: ProviderSettingsPanelProps) {
  // Render form based on provider
  const renderForm = () => {
    if (providerId === 'deepseek') {
      return (
        <ClassicProviderForm
          providerId="deepseek"
          connectedProvider={connectedProvider}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          onModelChange={onModelChange}
          showModelError={showModelError}
        />
      );
    }

    if (providerId === 'litellm') {
      return (
        <LiteLLMProviderForm
          connectedProvider={connectedProvider}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          onModelChange={onModelChange}
          showModelError={showModelError}
        />
      );
    }

    return <div>Unknown provider</div>;
  };

  return (
    <div className="min-h-[260px]">
      <AnimatePresence mode="wait">
        <motion.div
          key={providerId}
          variants={settingsVariants.slideDown}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={settingsTransitions.enter}
        >
          {renderForm()}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

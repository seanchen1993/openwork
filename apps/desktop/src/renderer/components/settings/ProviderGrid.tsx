// apps/desktop/src/renderer/components/settings/ProviderGrid.tsx

import { useMemo } from 'react';
import type { ProviderId, ProviderSettings } from '@accomplish/shared';
import { PROVIDER_META } from '@accomplish/shared';
import { ProviderCard } from './ProviderCard';

interface ProviderGridProps {
  settings: ProviderSettings;
  selectedProvider: ProviderId | null;
  onSelectProvider: (providerId: ProviderId) => void;
}

export function ProviderGrid({
  settings,
  selectedProvider,
  onSelectProvider,
}: ProviderGridProps) {
  const providers: ProviderId[] = ['deepseek', 'litellm'];

  return (
    <div className="rounded-xl border border-border bg-[#edebe7] p-4" data-testid="provider-grid">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-medium text-foreground">Providers</span>
      </div>

      {/* Providers */}
      <div className="grid grid-cols-2 gap-3 min-h-[110px] justify-items-center">
        {providers.map(providerId => (
          <ProviderCard
            key={providerId}
            providerId={providerId}
            connectedProvider={settings?.connectedProviders?.[providerId]}
            isActive={settings?.activeProviderId === providerId}
            isSelected={selectedProvider === providerId}
            onSelect={onSelectProvider}
          />
        ))}
      </div>
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getAccomplish } from '@/lib/accomplish';

interface Model {
  id: string;
  name: string;
  provider: string;
}

// Default models to show when no provider is connected
const DEFAULT_MODELS: Model[] = [
  { id: 'claude-sonnet-4-5-20250514', name: 'Sonnet 4.5', provider: 'anthropic' },
  { id: 'claude-3-5-sonnet-20241022', name: 'Sonnet 3.5', provider: 'anthropic' },
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
];

interface ModelSelectorInlineProps {
  onModelChange?: (modelId: string) => void;
}

export default function ModelSelectorInline({ onModelChange }: ModelSelectorInlineProps) {
  const [selectedModel, setSelectedModel] = useState<Model | null>(null);
  const [availableModels, setAvailableModels] = useState<Model[]>(DEFAULT_MODELS);
  const [isOpen, setIsOpen] = useState(false);
  const accomplish = getAccomplish();

  useEffect(() => {
    const loadSettings = async () => {
      try {
        // Try to get the currently selected model
        const current = await accomplish.getSelectedModel?.();
        if (current) {
          setSelectedModel({
            id: current.model,
            name: formatModelName(current.model),
            provider: current.provider,
          });
        } else {
          // Default to first model
          setSelectedModel(DEFAULT_MODELS[0]);
        }

        // Try to get available models from provider settings
        const settings = await accomplish.getProviderSettings?.();
        if (settings?.connectedProviders) {
          const models: Model[] = [];
          Object.entries(settings.connectedProviders).forEach(([providerId, provider]) => {
            if (provider?.availableModels) {
              provider.availableModels.forEach((m) => {
                models.push({
                  id: m.id,
                  name: m.name,
                  provider: providerId,
                });
              });
            }
          });
          if (models.length > 0) {
            setAvailableModels(models);
          }
        }
      } catch (error) {
        console.error('Failed to load model settings:', error);
      }
    };

    loadSettings();
  }, [accomplish]);

  const handleSelectModel = async (model: Model) => {
    setSelectedModel(model);
    setIsOpen(false);
    onModelChange?.(model.id);
    
    try {
      await accomplish.setSelectedModel?.({
        provider: model.provider as 'anthropic' | 'openai' | 'google' | 'xai',
        model: model.id,
      });
    } catch (error) {
      console.error('Failed to set model:', error);
    }
  };

  const formatModelName = (modelId: string): string => {
    // Format model ID to a readable name
    if (modelId.includes('sonnet-4-5') || modelId.includes('sonnet-4.5')) return 'Sonnet 4.5';
    if (modelId.includes('sonnet-3-5') || modelId.includes('sonnet-3.5')) return 'Sonnet 3.5';
    if (modelId.includes('opus')) return 'Opus';
    if (modelId.includes('gpt-4o')) return 'GPT-4o';
    if (modelId.includes('gpt-4')) return 'GPT-4';
    if (modelId.includes('gemini')) return 'Gemini';
    return modelId.split('/').pop() || modelId;
  };

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="gap-1.5 text-sm font-normal text-muted-foreground hover:text-foreground"
        >
          <span>{selectedModel?.name || 'Select model'}</span>
          <ChevronDown className="w-3.5 h-3.5 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[200px]">
        {availableModels.map((model) => (
          <DropdownMenuItem
            key={model.id}
            onClick={() => handleSelectModel(model)}
            className={selectedModel?.id === model.id ? 'bg-accent' : ''}
          >
            <span>{model.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

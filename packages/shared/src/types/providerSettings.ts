// packages/shared/src/types/providerSettings.ts

export type ProviderId = 'deepseek' | 'litellm';

export type ProviderCategory = 'classic' | 'hybrid';

export interface ProviderMeta {
  id: ProviderId;
  name: string;
  category: ProviderCategory;
  label: string;
  logoKey: string;
  helpUrl?: string;
}

export const PROVIDER_META: Record<ProviderId, ProviderMeta> = {
  deepseek: { id: 'deepseek', name: 'DeepSeek', category: 'classic', label: 'Service', logoKey: 'Deepseek', helpUrl: 'https://platform.deepseek.com/api_keys' },
  litellm: { id: 'litellm', name: 'LiteLLM', category: 'hybrid', label: 'Service', logoKey: 'liteLLM' },
};

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ApiKeyCredentials {
  type: 'api_key';
  keyPrefix: string;
}

export interface LiteLLMCredentials {
  type: 'litellm';
  serverUrl: string;
  hasApiKey: boolean;
  keyPrefix?: string;
}

export type ProviderCredentials =
  | ApiKeyCredentials
  | LiteLLMCredentials;

export interface ConnectedProvider {
  providerId: ProviderId;
  connectionStatus: ConnectionStatus;
  selectedModelId: string | null;
  credentials: ProviderCredentials;
  lastConnectedAt: string;
  availableModels?: Array<{ id: string; name: string }>;
}

export interface ProviderSettings {
  activeProviderId: ProviderId | null;
  connectedProviders: Partial<Record<ProviderId, ConnectedProvider>>;
  debugMode: boolean;
}

export function isProviderReady(provider: ConnectedProvider | undefined): boolean {
  if (!provider) return false;
  return provider.connectionStatus === 'connected' && provider.selectedModelId !== null;
}

export function hasAnyReadyProvider(settings: ProviderSettings | null | undefined): boolean {
  if (!settings?.connectedProviders) return false;
  return Object.values(settings.connectedProviders).some(isProviderReady);
}

export function getActiveProvider(settings: ProviderSettings | null | undefined): ConnectedProvider | null {
  if (!settings?.activeProviderId) return null;
  return settings.connectedProviders?.[settings.activeProviderId] ?? null;
}

export const DEFAULT_MODELS: Partial<Record<ProviderId, string>> = {
  deepseek: 'deepseek/deepseek-chat',
};

export function getDefaultModelForProvider(providerId: ProviderId): string | null {
  return DEFAULT_MODELS[providerId] ?? null;
}

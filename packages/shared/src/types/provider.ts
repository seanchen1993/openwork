/**
 * Provider and model configuration types for multi-provider support
 */

export type ProviderType = 'deepseek' | 'litellm';

export interface ProviderConfig {
  id: ProviderType;
  name: string;
  models: ModelConfig[];
  requiresApiKey: boolean;
  apiKeyEnvVar?: string;
  baseUrl?: string;
}

export interface ModelConfig {
  id: string; // e.g., "deepseek-chat"
  displayName: string; // e.g., "DeepSeek Chat (V3)"
  provider: ProviderType;
  fullId: string; // e.g., "deepseek/deepseek-chat"
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsVision?: boolean;
}

export interface SelectedModel {
  provider: ProviderType;
  model: string; // Full ID: "deepseek/deepseek-chat"
  baseUrl?: string;  // For LiteLLM: the server URL
  deploymentName?: string;  // For future use
}

/**
 * LiteLLM model info from API
 */
export interface LiteLLMModel {
  id: string;           // e.g., "openai/gpt-4"
  name: string;         // Display name (same as id for LiteLLM)
  provider: string;     // Extracted from model ID
  contextLength: number;
}

/**
 * LiteLLM configuration
 */
export interface LiteLLMConfig {
  baseUrl: string;      // e.g., "http://localhost:4000"
  enabled: boolean;
  lastValidated?: number;
  models?: LiteLLMModel[];
}

/**
 * Default providers and models
 */
export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    requiresApiKey: true,
    apiKeyEnvVar: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com',
    models: [
      {
        id: 'deepseek-chat',
        displayName: 'DeepSeek Chat (V3)',
        provider: 'deepseek',
        fullId: 'deepseek/deepseek-chat',
        contextWindow: 64000,
        supportsVision: false,
      },
      {
        id: 'deepseek-reasoner',
        displayName: 'DeepSeek Reasoner (R1)',
        provider: 'deepseek',
        fullId: 'deepseek/deepseek-reasoner',
        contextWindow: 64000,
        supportsVision: false,
      },
    ],
  },
];

export const DEFAULT_MODEL: SelectedModel = {
  provider: 'deepseek',
  model: 'deepseek/deepseek-chat',
};

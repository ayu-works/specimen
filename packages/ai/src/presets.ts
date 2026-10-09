export type ProviderKind = 'openai' | 'anthropic' | 'gemini';

export interface Preset {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  /** Example / default model id (always user-editable). */
  model: string;
  needsKey: boolean;
  /** Show the base URL field in settings. */
  editableBaseUrl: boolean;
  /** Whether the default model is known to accept images. */
  vision: boolean;
  contextTokens: number;
  note?: string;
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-5-5',
    needsKey: true,
    editableBaseUrl: false,
    vision: true,
    contextTokens: 200_000,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    needsKey: true,
    editableBaseUrl: false,
    vision: true,
    contextTokens: 128_000,
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    kind: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    model: 'gemini-2.5-flash',
    needsKey: true,
    editableBaseUrl: false,
    vision: true,
    contextTokens: 1_000_000,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    needsKey: true,
    editableBaseUrl: false,
    vision: true,
    contextTokens: 128_000,
  },
  {
    id: 'groq',
    label: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'openai/gpt-oss-20b',
    needsKey: true,
    editableBaseUrl: false,
    vision: false,
    contextTokens: 128_000,
  },
  {
    id: 'together',
    label: 'Together',
    kind: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
    model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    needsKey: true,
    editableBaseUrl: false,
    vision: false,
    contextTokens: 128_000,
  },
  {
    id: 'mistral',
    label: 'Mistral',
    kind: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-small-latest',
    needsKey: true,
    editableBaseUrl: false,
    vision: false,
    contextTokens: 128_000,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    needsKey: true,
    editableBaseUrl: false,
    vision: false,
    contextTokens: 64_000,
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    kind: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-3-mini',
    needsKey: true,
    editableBaseUrl: false,
    vision: false,
    contextTokens: 128_000,
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    kind: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.2',
    needsKey: false,
    editableBaseUrl: true,
    vision: false,
    contextTokens: 8_000,
    note: 'Start Ollama with OLLAMA_ORIGINS="chrome-extension://*" so it accepts requests from this extension.',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (local)',
    kind: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    model: 'local-model',
    needsKey: false,
    editableBaseUrl: true,
    vision: false,
    contextTokens: 8_000,
    note: 'Enable the local server in LM Studio and turn on CORS.',
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    kind: 'openai',
    baseUrl: '',
    model: '',
    needsKey: true,
    editableBaseUrl: true,
    vision: false,
    contextTokens: 32_000,
  },
];

export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

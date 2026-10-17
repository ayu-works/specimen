export {
  HTTP_FAILED_TEXT,
  httpError,
  IMAGE_REJECTED_TEXT,
  MID_STREAM_TEXT,
  mapThrown,
  OUT_OF_CREDIT_TEXT,
  RATE_TEXT,
  scrubLegacyProviderText,
  streamError,
  TRUNCATED_TEXT,
} from './errors';
export { type AskTurn, ask, askSystemPrompt } from './features/ask';
export {
  CRITIQUE_ERRORS,
  CRITIQUE_LIMITS,
  CRITIQUE_TRUNCATED,
  type CritiqueOptions,
  type CritiquePlan,
  type CritiqueResult,
  type CritiqueTurn,
  clipContext,
  critiquePlan,
  DEFAULT_PERSONAS,
  MAX_CONTEXT,
  PERSONAS,
  type PersonaId,
  parseVerdict,
  runCritique,
  type TurnStatus,
  type Verdict,
} from './features/critique';
export { compactScan, PAGE_DATA_RULE, pageDataBudget, wrapPageData } from './features/pageData';
export {
  measuredValues,
  missingValues,
  type PolishResult,
  polishPrompt,
} from './features/polishPrompt';
export { type Vibe, VibeSchema, vibe } from './features/vibe';
export type { LlmEvent, LlmRequest, PortLike } from './llmProtocol';
export { LLM_PORT } from './llmProtocol';
export { listModels, pickModel } from './models';
export { getPreset, PRESETS, type Preset, type ProviderKind } from './presets';
export {
  ANTHROPIC_DEFAULT_MODEL,
  buildAnthropicRequest,
  createAnthropic,
} from './providers/anthropic';
export { createChromeBuiltin, isChromeBuiltinAvailable } from './providers/chromeBuiltin';
export { buildGeminiRequest, createGemini, GEMINI_DEFAULT_MODEL } from './providers/gemini';
export {
  buildOpenAIRequest,
  createOpenAICompat,
  OPENAI_COMPAT_PRESETS,
} from './providers/openaiCompat';
export { createWebLLMProvider, WebLLMClient, type WebLLMStatus } from './providers/webllm';
export {
  clearProviders,
  getActiveProvider,
  getProvider,
  listProviders,
  registerProvider,
  setActiveProvider,
  unregisterProvider,
} from './registry';
export {
  decryptWithPassphrase,
  decryptWithRawKey,
  deriveRawKey,
  type EncryptedSecret,
  encryptWithPassphrase,
  encryptWithRawKey,
  PBKDF2_ITERATIONS,
  type PlainSecret,
  randomSalt,
  type StoredSecret,
} from './secrets/crypto';
export { type SseEvent, sseEvents } from './sse';
export type {
  ChatRequest,
  ContentPart,
  LLMProvider,
  ProviderConfig,
  ProviderErrorKind,
} from './types';
export { ProviderError } from './types';

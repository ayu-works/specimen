/**
 * Offscreen document: a hidden page the service worker creates so the local WebLLM engine can run
 * in a Web Worker. It only hosts the engine over Port `llm`; it answers no runtime messages.
 */
import { startLlmHost } from './llmHost';

startLlmHost();

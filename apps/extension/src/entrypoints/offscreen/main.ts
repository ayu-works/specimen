/**
 * Offscreen document: a hidden page the service worker creates so the local WebLLM engine can run
 * in a Web Worker. It hosts the engine over Port `llm` and the council (SPC-24) over Port
 * `council`; the only runtime message it answers is the service worker's `council.halt`.
 */
import { startCouncilHost } from './councilHost';
import { startLlmHost } from './llmHost';

startLlmHost();
startCouncilHost();

/**
 * Dedicated worker that owns the WebLLM engine, so tokenising, sampling and GPU work never
 * block the offscreen document's event loop.
 */
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (msg: MessageEvent) => handler.onmessage(msg);

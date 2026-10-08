/**
 * Offscreen-side half of the `llm` Port protocol (packages/ai/src/llmProtocol.ts).
 * Owns one WebLLM engine (running in a Web Worker) that outlives the side panel.
 */
import {
  CreateWebWorkerMLCEngine,
  deleteModelAllInfoInCache,
  hasModelInCache,
  type WebWorkerMLCEngine,
} from '@mlc-ai/web-llm';
import {
  type ChatRequest,
  type ContentPart,
  LLM_PORT,
  type LlmEvent,
  type LlmRequest,
} from '@specimen/ai';
import { gemmaById } from '@/lib/gemmaModels';
import { buildAppConfig } from '@/lib/webllmConfig';

type Kind = Extract<LlmEvent, { type: 'error' }>['kind'];

const ports = new Set<chrome.runtime.Port>();
let engine: WebWorkerMLCEngine | null = null;
let worker: Worker | null = null;
let loadedId: string | undefined;
let loadingId: string | undefined;
let loadPromise: Promise<void> | null = null;
let lastP = 0;
const aborted = new Set<string>();
/** WebLLM runs one generation at a time; chain requests. */
let chatChain: Promise<void> = Promise.resolve();

function send(port: chrome.runtime.Port, ev: LlmEvent): void {
  try {
    port.postMessage(ev);
  } catch {
    ports.delete(port);
  }
}
function broadcast(ev: LlmEvent): void {
  for (const p of ports) send(p, ev);
}

async function hasGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!gpu && !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

function classify(e: unknown): { kind: Kind; message: string } {
  const message = e instanceof Error ? e.message : String(e);
  if (/webgpu|gpu adapter|navigator\.gpu/i.test(message)) {
    return {
      kind: 'unsupported',
      message: 'This browser or GPU does not support WebGPU, which local Gemma needs.',
    };
  }
  if (/out of memory|oom|device was lost|DeviceLost/i.test(message)) {
    return { kind: 'other', message: 'The GPU ran out of memory. Try a smaller Gemma model.' };
  }
  if (/fetch|network|Failed to|NetworkError|Load failed/i.test(message)) {
    return {
      kind: 'network',
      message: `Download failed. Check your connection and try again. (${message.slice(0, 120)})`,
    };
  }
  return { kind: 'other', message };
}

function disposeEngine(): void {
  try {
    void engine?.unload();
  } catch {
    /* ignore */
  }
  worker?.terminate();
  engine = null;
  worker = null;
  loadedId = undefined;
}

async function load(modelId: string): Promise<void> {
  if (!gemmaById(modelId)) throw new Error(`Unknown model: ${modelId}`);
  if (loadedId === modelId && engine) return;
  if (loadPromise && loadingId === modelId) return loadPromise;
  if (loadPromise) await loadPromise.catch(() => {});
  if (!(await hasGpu())) throw new Error('WebGPU is not available (navigator.gpu)');

  loadingId = modelId;
  lastP = 0;
  loadPromise = (async () => {
    try {
      disposeEngine();
      worker = new Worker(new URL('./llm.worker.ts', import.meta.url), { type: 'module' });
      engine = await CreateWebWorkerMLCEngine(worker, modelId, {
        appConfig: buildAppConfig(),
        initProgressCallback: (r) => {
          lastP = r.progress;
          broadcast({ type: 'progress', p: r.progress, text: r.text });
        },
      });
      loadedId = modelId;
    } catch (e) {
      disposeEngine();
      throw e;
    } finally {
      loadingId = undefined;
      loadPromise = null;
    }
  })();
  return loadPromise;
}

/** Gemma's template has no system role: fold the system prompt into the first user turn. */
function toMessages(req: ChatRequest): { role: 'user' | 'assistant'; content: string }[] {
  const text = (c: string | ContentPart[]) =>
    typeof c === 'string'
      ? c
      : c
          .map((p) => (p.type === 'text' ? p.text : ''))
          .filter(Boolean)
          .join('\n');
  const msgs = req.messages.map((m) => ({ role: m.role, content: text(m.content) }));
  const first = msgs.find((m) => m.role === 'user');
  const json = req.json ? '\n\nRespond with a single valid JSON object and nothing else.' : '';
  if (first && (req.system || json)) {
    first.content = `${req.system ? `${req.system}\n\n---\n\n` : ''}${first.content}${json}`;
  }
  return msgs;
}

async function runChat(port: chrome.runtime.Port, id: string, req: ChatRequest): Promise<void> {
  try {
    if (!engine || !loadedId) throw new Error('No model is loaded');
    const stream = await engine.chat.completions.create({
      messages: toMessages(req),
      stream: true,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
    });
    for await (const chunk of stream) {
      if (aborted.has(id)) break;
      const text = chunk.choices[0]?.delta?.content;
      if (text) send(port, { type: 'delta', id, text });
    }
    send(port, { type: 'done', id });
  } catch (e) {
    send(port, { type: 'error', id, ...classify(e) });
  } finally {
    aborted.delete(id);
  }
}

async function handle(port: chrome.runtime.Port, msg: LlmRequest): Promise<void> {
  switch (msg.type) {
    case 'status': {
      const cached =
        msg.modelId && gemmaById(msg.modelId)
          ? await hasModelInCache(msg.modelId, buildAppConfig()).catch(() => false)
          : undefined;
      send(port, {
        type: 'status',
        loaded: loadedId,
        loading: loadPromise !== null,
        p: loadPromise ? lastP : undefined,
        gpu: await hasGpu(),
        cached,
      });
      return;
    }
    case 'load':
      try {
        await load(msg.modelId);
        send(port, { type: 'ready', modelId: msg.modelId });
      } catch (e) {
        send(port, { type: 'error', ...classify(e) });
      }
      return;
    case 'chat':
      chatChain = chatChain.then(() => runChat(port, msg.id, msg.req));
      return;
    case 'abort':
      aborted.add(msg.id);
      void engine?.interruptGenerate();
      return;
    case 'unload':
      disposeEngine();
      return;
    case 'delete':
      try {
        if (loadedId === msg.modelId) disposeEngine();
        await deleteModelAllInfoInCache(msg.modelId, buildAppConfig());
        send(port, { type: 'deleted', modelId: msg.modelId });
      } catch (e) {
        send(port, { type: 'error', ...classify(e) });
      }
  }
}

/** True while a model is loaded or loading, or any client is connected: do not close the document. */
export function llmBusy(): boolean {
  return loadedId !== undefined || loadPromise !== null || ports.size > 0;
}

export function startLlmHost(): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== LLM_PORT) return;
    ports.add(port);
    port.onMessage.addListener((m: LlmRequest) => void handle(port, m));
    port.onDisconnect.addListener(() => ports.delete(port));
  });
}

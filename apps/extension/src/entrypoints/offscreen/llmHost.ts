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
/** WebLLM runs one generation at a time; chain requests. */
let chatChain: Promise<void> = Promise.resolve();

/** One chat, owned by the Port that sent it: only that Port can stop it. */
interface Job {
  port: chrome.runtime.Port;
  id: string;
  stopped: boolean;
}
const jobs = new Map<chrome.runtime.Port, Map<string, Job>>();
/** The job the engine is generating, if any. `interruptGenerate()` is engine-wide: only stop this one. */
let running: Job | null = null;

function send(port: chrome.runtime.Port, ev: LlmEvent): void {
  try {
    port.postMessage(ev);
  } catch {
    // Chrome throws on a closed Port: treat it like a disconnect.
    dropPort(port);
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

/** Interrupt the running generation; a failing interrupt never escapes. */
function interrupt(): void {
  try {
    void Promise.resolve(engine?.interruptGenerate()).catch(() => {});
  } catch {
    /* ignore */
  }
}

/** Stop one job: a queued one is skipped when its turn comes, a running one is interrupted. */
function stop(job: Job): void {
  if (job.stopped) return;
  job.stopped = true;
  if (running === job) interrupt();
}

/** A closed Port's chats stop (queued or running); other Ports' chats are untouched. */
function dropPort(port: chrome.runtime.Port): void {
  ports.delete(port);
  for (const job of jobs.get(port)?.values() ?? []) stop(job);
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

async function runChat(job: Job, req: ChatRequest): Promise<void> {
  const { port, id } = job;
  try {
    if (job.stopped) {
      send(port, { type: 'error', id, kind: 'aborted', message: 'Stopped' });
      return;
    }
    if (!engine || !loadedId) throw new Error('No model is loaded');
    running = job;
    const stream = await engine.chat.completions.create({
      messages: toMessages(req),
      stream: true,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
    });
    // Drain rather than break: the worker's generator holds the model lock until it ends. The
    // worker also clears its interrupt flag when generation starts, so re-interrupt while stopped.
    let finish: string | null | undefined;
    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (choice?.finish_reason) finish = choice.finish_reason;
      if (job.stopped) {
        if (!choice?.finish_reason) interrupt();
        continue;
      }
      const text = choice?.delta?.content;
      if (text) send(port, { type: 'delta', id, text });
    }
    if (job.stopped) send(port, { type: 'error', id, kind: 'aborted', message: 'Stopped' });
    else if (finish === 'abort') {
      // Interrupted, but not by this chat's own abort: partial text is not an answer.
      send(port, {
        type: 'error',
        id,
        kind: 'other',
        message: 'The answer was cut short. Try again.',
      });
    } else send(port, { type: 'done', id });
  } catch (e) {
    send(
      port,
      job.stopped
        ? { type: 'error', id, kind: 'aborted', message: 'Stopped' }
        : { type: 'error', id, ...classify(e) },
    );
  } finally {
    if (running === job) running = null;
    const mine = jobs.get(port);
    if (mine?.get(id) === job) mine.delete(id);
    if (mine?.size === 0) jobs.delete(port);
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
    case 'chat': {
      let mine = jobs.get(port);
      if (mine?.has(msg.id)) {
        send(port, { type: 'error', id: msg.id, kind: 'other', message: 'Duplicate request id' });
        return;
      }
      if (!mine) {
        mine = new Map();
        jobs.set(port, mine);
      }
      const job: Job = { port, id: msg.id, stopped: false };
      mine.set(msg.id, job);
      chatChain = chatChain.then(() => runChat(job, msg.req));
      return;
    }
    case 'abort': {
      // Only this Port's own chat: an unknown id, or another Port's, is ignored.
      const job = jobs.get(port)?.get(msg.id);
      if (job) stop(job);
      return;
    }
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

/** Serve one `llm` Port: a real one from `onConnect`, or an in-page one (the council host). */
export function attachLlmPort(port: chrome.runtime.Port): void {
  ports.add(port);
  port.onMessage.addListener((m: LlmRequest) => void handle(port, m));
  port.onDisconnect.addListener(() => dropPort(port));
}

export function startLlmHost(): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== LLM_PORT) return;
    attachLlmPort(port);
  });
}

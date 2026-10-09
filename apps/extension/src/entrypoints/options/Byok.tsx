import { getPreset, listModels, PRESETS, ProviderError, pickModel } from '@specimen/ai';
import { Eye, EyeOff, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { resolveByokProvider } from '@/lib/aiByok';
import {
  type AiSettings,
  isEncrypted,
  loadKey,
  removeKey,
  requestProviderPermission,
  saveAiSettings,
  saveKey,
  unlockKeys,
} from '@/lib/aiSettings';
import { fieldClass } from './fields';

type KeyInfo = 'none' | 'saved' | 'encrypted';

export function Byok({
  settings,
  onChange,
}: {
  settings: AiSettings;
  onChange: (s: AiSettings) => void;
}) {
  const [presetId, setPresetId] = useState(settings.byok.preset);
  const preset = getPreset(presetId) ?? PRESETS[0];
  const saved = settings.byok.preset === presetId;
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState(
    saved && settings.byok.model ? settings.byok.model : (preset?.model ?? ''),
  );
  const [baseUrl, setBaseUrl] = useState(
    saved && settings.byok.baseUrl ? settings.byok.baseUrl : (preset?.baseUrl ?? ''),
  );
  const [vision, setVision] = useState(
    saved ? (settings.byok.vision ?? preset?.vision ?? false) : (preset?.vision ?? false),
  );
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [encrypt, setEncrypt] = useState(settings.encryptKeys);
  const [pass, setPass] = useState('');
  const [info, setInfo] = useState<KeyInfo>('none');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function pickPreset(id: string) {
    const p = getPreset(id);
    if (!p) return;
    setPresetId(id);
    setModel(settings.byok.preset === id && settings.byok.model ? settings.byok.model : p.model);
    setModels([]);
    setBaseUrl(
      settings.byok.preset === id && settings.byok.baseUrl ? settings.byok.baseUrl : p.baseUrl,
    );
    setVision(p.vision);
    setKey('');
    setMsg(null);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh the saved-key line per preset
  useEffect(() => {
    let live = true;
    void (async () => {
      const k = await loadKey(presetId);
      const enc = await isEncrypted(presetId);
      if (live) setInfo(k.status === 'none' ? 'none' : enc ? 'encrypted' : 'saved');
    })();
    return () => {
      live = false;
    };
  }, [presetId, settings]);

  if (!preset) return null;
  const effectiveBase = preset.editableBaseUrl ? baseUrl : preset.baseUrl;
  const effectiveModel = model || preset.model;

  /** Typed key, else the saved one (prompting for the passphrase if it is locked). */
  async function currentKey(): Promise<string | undefined> {
    if (!preset?.needsKey) return undefined;
    if (key) return key;
    let k = await loadKey(preset.id);
    if (k.status === 'locked' && pass) {
      if (await unlockKeys(preset.id, pass)) k = await loadKey(preset.id);
    }
    if (k.status === 'ok') return k.key;
    throw new Error(
      k.status === 'locked'
        ? 'Your saved key is encrypted: enter the passphrase below.'
        : 'Enter an API key first.',
    );
  }

  async function fetchModels() {
    setBusy(true);
    setMsg(null);
    try {
      await requestProviderPermission(effectiveBase);
      const apiKey = await currentKey();
      const list = await listModels(preset as NonNullable<typeof preset>, {
        baseUrl: effectiveBase,
        apiKey,
      });
      setModels(list);
      if (list.length === 0) {
        setMsg({ ok: false, text: 'The provider returned no chat models for this key.' });
        return;
      }
      if (!list.includes(effectiveModel)) {
        const next = pickModel(list, preset?.model);
        if (next) setModel(next);
      }
      setMsg({ ok: true, text: `${list.length} models available. Pick one, then Test.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMsg(null);
    try {
      // Must be requested inside this click, before any await that would end the gesture.
      const granted = await requestProviderPermission(effectiveBase);
      const apiKey = await currentKey();
      const provider = resolveByokProvider(preset as NonNullable<typeof preset>, {
        baseUrl: effectiveBase,
        model: effectiveModel,
        apiKey,
        vision,
      });
      const ctl = new AbortController();
      let got = false;
      for await (const _ of provider.chat(
        // Reasoning models (e.g. gpt-oss) spend their first tokens thinking, so allow a few.
        { messages: [{ role: 'user', content: 'Reply with one word.' }], maxTokens: 32 },
        ctl.signal,
      )) {
        got = true;
        ctl.abort();
        break;
      }
      setMsg({
        ok: true,
        text: got
          ? `Works: ${effectiveModel} answered.${granted ? '' : ' (Browser access to this host was not granted; the call still succeeded.)'}`
          : `Works: connected to ${effectiveModel}. (It returned no text for this tiny test, which is normal for reasoning models.)`,
      });
    } catch (e) {
      const kind = e instanceof ProviderError ? e.kind : 'other';
      if (kind === 'aborted') setMsg({ ok: true, text: `Works: ${effectiveModel} answered.` });
      else setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const granted = await requestProviderPermission(effectiveBase);
      if (key) {
        if (encrypt && !pass) throw new Error('Enter a passphrase to encrypt the key.');
        await saveKey(preset?.id ?? presetId, key, encrypt ? pass : undefined);
        setKey('');
      }
      onChange(
        await saveAiSettings({
          provider: 'byok',
          encryptKeys: encrypt,
          byok: {
            preset: presetId,
            baseUrl: preset?.editableBaseUrl ? baseUrl : '',
            model: effectiveModel,
            keyRef: '',
            vision,
          },
        }),
      );
      setMsg({
        ok: true,
        text: granted
          ? 'Saved.'
          : 'Saved, but the browser did not grant access to this provider. Press Test or Save again and choose Allow.',
      });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    await removeKey(presetId);
    setKey('');
    setInfo('none');
    setMsg({ ok: true, text: 'Key removed.' });
    onChange(await saveAiSettings({}));
  }

  return (
    <Card className="flex flex-col gap-3" data-testid="byok">
      <CardTitle className="mb-0">API key</CardTitle>
      <p className="text-muted-foreground">
        Requests go straight from your browser to the provider you pick. Your key is stored only on
        this device and is never sent anywhere else.
      </p>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium">Provider</span>
        <select
          className={fieldClass}
          value={presetId}
          onChange={(e) => pickPreset(e.target.value)}
        >
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium">Model</span>
        <div className="flex gap-1.5">
          <input
            className={`${fieldClass} min-w-0 flex-1`}
            value={model}
            placeholder={preset.model || 'model id'}
            onChange={(e) => setModel(e.target.value)}
            list="byok-models"
            spellCheck={false}
          />
          <Button
            type="button"
            variant="outline"
            onClick={fetchModels}
            disabled={busy}
            title="Ask the provider which models your key can use"
          >
            <RefreshCw size={14} />
            Fetch models
          </Button>
        </div>
        <datalist id="byok-models">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
      {preset.editableBaseUrl && (
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium">Base URL</span>
          <input
            className={fieldClass}
            value={baseUrl}
            placeholder="https://host/v1"
            onChange={(e) => setBaseUrl(e.target.value)}
            spellCheck={false}
          />
        </label>
      )}
      {preset.note && <p className="text-xs text-muted-foreground">{preset.note}</p>}
      {preset.needsKey && (
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium">API key</span>
          <div className="flex gap-2">
            <input
              className={fieldClass}
              type={show ? 'text' : 'password'}
              autoComplete="off"
              value={key}
              placeholder={info === 'none' ? 'Paste your key' : 'Saved. Paste to replace'}
              onChange={(e) => setKey(e.target.value)}
              spellCheck={false}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              aria-label={show ? 'Hide key' : 'Show key'}
              onClick={() => setShow(!show)}
            >
              {show ? <EyeOff size={14} /> : <Eye size={14} />}
            </Button>
          </div>
          <span className="text-xs text-muted-foreground" data-testid="key-state">
            {info === 'none' && 'No key saved.'}
            {info === 'saved' && 'A key is saved on this device.'}
            {info === 'encrypted' &&
              'A key is saved on this device, encrypted with your passphrase.'}
          </span>
        </label>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={vision} onChange={(e) => setVision(e.target.checked)} />
        This model can read images (enables “Describe the vibe”)
      </label>
      {preset.needsKey && (
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={encrypt}
              onChange={(e) => setEncrypt(e.target.checked)}
            />
            Encrypt keys with a passphrase
          </label>
          {(encrypt || info === 'encrypted') && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium">Passphrase</span>
              <input
                className={fieldClass}
                type="password"
                autoComplete="off"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
              />
              <span className="text-xs text-muted-foreground">
                The side panel asks for it once per browser session. If you forget it, remove the
                key and add it again.
              </span>
            </label>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={test} disabled={busy}>
          Test
        </Button>
        <Button onClick={save} disabled={busy}>
          Save
        </Button>
        {preset.needsKey && (
          <Button variant="ghost" onClick={clear} disabled={busy || info === 'none'}>
            Remove key
          </Button>
        )}
      </div>
      {msg && (
        <p
          role={msg.ok ? 'status' : 'alert'}
          className={msg.ok ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}
        >
          {msg.text}
        </p>
      )}
    </Card>
  );
}

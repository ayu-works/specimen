// Downloads the WebLLM model-library .wasm files for the Gemma options into public/models/.
// Chrome Web Store policy forbids remotely hosted executable code, so these ship inside the
// extension; only model *weights* are downloaded at runtime. Skips files that already exist.
//
//   node scripts/fetch-model-libs.mjs [--force]
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'models');
const force = process.argv.includes('--force');
const models = JSON.parse(readFileSync(join(root, 'src/lib/gemma-models.json'), 'utf8'));
const { prebuiltAppConfig } = await import('@mlc-ai/web-llm');

mkdirSync(outDir, { recursive: true });
let failed = false;
for (const m of models) {
  const dest = join(outDir, m.wasm);
  if (!force && existsSync(dest) && statSync(dest).size > 0) {
    console.log(`ok   ${m.wasm} (cached)`);
    continue;
  }
  const rec = prebuiltAppConfig.model_list.find((x) => x.model_id === m.id);
  if (!rec) {
    console.error(`FAIL ${m.id}: not in this WebLLM version's prebuilt list`);
    failed = true;
    continue;
  }
  if (rec.model_lib.split('/').pop() !== m.wasm) {
    console.error(`FAIL ${m.id}: expected ${m.wasm}, WebLLM points at ${rec.model_lib}`);
    failed = true;
    continue;
  }
  try {
    const res = await fetch(rec.model_lib);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(dest, buf);
    console.log(`got  ${m.wasm} (${(buf.length / 1048576).toFixed(2)} MB)`);
  } catch (e) {
    console.error(`FAIL ${m.wasm}: ${e instanceof Error ? e.message : e}`);
    failed = true;
  }
}
if (failed) process.exit(1);

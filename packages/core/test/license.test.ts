import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));

function workspacePackageJsons(): string[] {
  const files = [join(root, 'package.json')];
  for (const group of ['packages', 'apps']) {
    const dir = join(root, group);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const pkg = join(dir, entry.name, 'package.json');
      if (entry.isDirectory() && existsSync(pkg)) files.push(pkg);
    }
  }
  return files;
}

describe('license', () => {
  it('T0.07 LICENSE is MIT and every package.json license is MIT', () => {
    const license = readFileSync(join(root, 'LICENSE'), 'utf8');
    expect(license).toMatch(/MIT License/);
    expect(license).toMatch(/Permission is hereby granted, free of charge/);
    const files = workspacePackageJsons();
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const file of files) {
      const pkg = JSON.parse(readFileSync(file, 'utf8')) as { license?: string };
      expect(pkg.license, file).toBe('MIT');
    }
  });
});

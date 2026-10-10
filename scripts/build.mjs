import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from '../fixtures/site.mjs';
import { renderSite } from '../src/site/render.mjs';
import { createFixtureManifest } from '../src/release/manifest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist');
const within = path => {
  const rel = relative(root, path);
  return rel && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel);
};
if (!within(out)) throw new Error('output directory escapes repository');

const files = renderSite(fixture);
await rm(out, { recursive: true, force: true });
for (const [name, content] of files) {
  const destination = resolve(out, name);
  const rel = relative(out, destination);
  if (!rel || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
    throw new Error(`output path escapes dist: ${name}`);
  }
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content, 'utf8');
}
await writeFile(resolve(out, 'build-manifest.json'), `${JSON.stringify(await createFixtureManifest(files), null, 2)}\n`, 'utf8');
process.stdout.write(`Built ${files.size} fixture files in ${out}\n`);

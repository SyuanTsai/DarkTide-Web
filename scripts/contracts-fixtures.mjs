import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.join(repoRoot, 'test', 'fixtures', 'contracts');

async function copyRelative(sourceRoot, targetRoot, relative) {
  const source = path.join(sourceRoot, ...relative.split('/'));
  const target = path.join(targetRoot, ...relative.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
}

async function writeJson(root, relative, value) {
  const destination = path.join(root, ...relative.split('/'));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(value, null, 2)}\n`);
}

async function createModsFixture() {
  const sourceRoot = path.join(repoRoot, 'docs', 'contracts', 'w03');
  const targetRoot = path.join(fixtureRoot, 'w14', 'w03');
  const index = JSON.parse(await readFile(path.join(sourceRoot, 'mods', 'mapping-ledger.json'), 'utf8'));
  const wanted = new Set(['M01', 'M05', 'M07', 'K01', 'M08']);
  for (const group of index.groups) {
    if (!wanted.has(group.groupId)) continue;
    for (const descriptor of group.shards) {
      if (group.groupId === 'M01' && descriptor !== group.shards[0]) continue;
      await copyRelative(sourceRoot, targetRoot, descriptor.path);
    }
  }
  await copyRelative(sourceRoot, targetRoot, 'mods/mapping-ledger.json');
}

export async function generateContractFixtures() {
  await rm(fixtureRoot, { recursive: true, force: true });
  const sourceW03 = path.join(repoRoot, 'docs', 'contracts', 'w03');
  const targetW03 = path.join(fixtureRoot, 'w14', 'w03');
  const ledger = JSON.parse(await readFile(path.join(sourceW03, 'mapping-ledger.json'), 'utf8'));
  const selectedDescriptors = ledger.shards.filter(descriptor => descriptor.groupId === 'source-code-registry' || descriptor.groupId === 'web-w01-inputs');
  await writeJson(targetW03, 'mapping-ledger.json', { ...ledger, shards: selectedDescriptors });
  for (const descriptor of selectedDescriptors) await copyRelative(sourceW03, targetW03, descriptor.path);
  await createModsFixture();

  for (const filename of [
    'weapon-registry-current-reconciliation.json',
    'source-current-row-reconciliation.json',
    'web-current-row-reconciliation.json',
  ]) await copyRelative(path.join(repoRoot, 'docs', 'contracts', 'w14'), path.join(fixtureRoot, 'w14'), filename);

  await copyCandidate('c41434cc510b4d28b91e59a14ac681e5aa973a09958ba3b7eb03d10eb13a8a00', 'w09-c414');
  await copyCandidate('d8d430c3f105696a06d4f2af040e095d260546fbae38960d8ec1cb0eb1f56bab', 'w09-d8d');
  await copyTreeFiles(path.join(repoRoot, 'content', 'contracts', 'w13', 'ranged-candidate'), path.join(fixtureRoot, 'w13', 'ranged-candidate'));
}

async function copyCandidate(proposalId, fixtureName) {
  await copyTreeFiles(
    path.join(repoRoot, 'content', 'contracts', 'w09', 'proposals', proposalId, 'candidate'),
    path.join(fixtureRoot, fixtureName, 'candidate'),
  );
}

async function copyTreeFiles(source, target) {
  const entries = await (await import('node:fs/promises')).readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) await copyTreeFiles(sourcePath, targetPath);
    else if (entry.isFile()) {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await copyFile(sourcePath, targetPath);
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  generateContractFixtures().catch(error => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}

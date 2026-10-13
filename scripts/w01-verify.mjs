import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyW01Package } from './w01-build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length > 1) {
  process.stderr.write('Usage: node scripts/w01-verify.mjs [artifact-directory]\n');
  process.exitCode = 2;
} else {
  try {
    const result = await verifyW01Package(args.length ? path.resolve(args[0]) : path.join(root, 'dist-w01'));
    process.stdout.write('Verified isolated W01 fixture package build_id=' + result.buildId + ' data_revision=' + result.dataRevision + ' files=' + result.fileCount + '\n');
  } catch (error) {
    process.stderr.write('W01 preview verification failed: ' + (error?.message ?? String(error)) + '\n');
    process.exitCode = 1;
  }
}

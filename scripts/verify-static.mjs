import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyStaticPackage } from '../src/static/verify.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length > 1) {
  process.stderr.write('Usage: node scripts/verify-static.mjs [artifact-directory]\n');
  process.exitCode = 2;
} else {
  const directory = args.length === 1 ? path.resolve(args[0]) : path.join(root, 'dist');
  try {
    const result = await verifyStaticPackage(directory);
    process.stdout.write(
      'Verified ' + result.file_count + ' static files (' + result.package_kind +
      ') build_id=' + result.build_id + ' data_revision=' + result.data_revision + '\n'
    );
  } catch (error) {
    process.stderr.write('Static artifact verification failed: ' + (error?.message ?? String(error)) + '\n');
    process.exitCode = 1;
  }
}


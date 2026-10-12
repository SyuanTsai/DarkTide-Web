import { buildStaticSite } from '../src/static/build.mjs';
import { fixturePublicContent } from '../src/static/fixture.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseBuildArgs(args) {
  const result = { mode: 'published', root: SCRIPT_ROOT, siteOrigin: undefined };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--fixture' && !seen.has(argument)) {
      seen.add(argument);
      result.mode = 'fixture';
    } else if (argument === '--site-origin' && !seen.has(argument) && args[index + 1]) {
      seen.add(argument);
      result.siteOrigin = args[++index];
    } else if (argument === '--root' && !seen.has(argument) && args[index + 1]) {
      seen.add(argument);
      result.root = path.resolve(args[++index]);
    } else {
      throw new Error('Usage: node scripts/build.mjs [--fixture] [--site-origin https://example.test] [--root path]');
    }
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseBuildArgs(process.argv.slice(2));
    const result = await buildStaticSite({
      ...options,
      ...(options.mode === 'fixture' ? { data: fixturePublicContent() } : {})
    });
    process.stdout.write(
      'Built ' + result.file_count + ' static files (' + result.package_kind +
      ') build_id=' + result.build_id + ' data_revision=' + result.data_revision + '\n'
    );
  } catch (error) {
    process.stderr.write('Static build failed: ' + (error?.message ?? String(error)) + '\n');
    process.exitCode = error?.message?.startsWith('Usage:') ? 2 : 1;
  }
}


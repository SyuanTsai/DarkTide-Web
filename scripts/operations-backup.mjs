import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createBackup } from '../src/operations/backup.mjs';
const { values } = parseArgs({ options: { dist: { type: 'string', default: 'dist' }, receipt: { type: 'string', default: '.deployment/last-deployment.json' }, output: { type: 'string', default: '.operations/backup' }, 'run-url': { type: 'string' }, commit: { type: 'string' } } });
const root = process.cwd();
await mkdir(path.dirname(path.resolve(values.output)), { recursive: true });
const record = await createBackup({ root, dist: path.resolve(values.dist), receiptPath: path.resolve(values.receipt), output: path.resolve(values.output), runUrl: values['run-url'], runAttempt: process.env.GITHUB_RUN_ATTEMPT || '1', sourceCommit: values.commit });
console.log(JSON.stringify({ tag: record.tag, build_id: record.build_id, file_count: record.file_count }));

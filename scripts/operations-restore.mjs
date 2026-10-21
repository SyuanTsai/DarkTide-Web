import path from 'node:path';
import { parseArgs } from 'node:util';
import { restoreBackup } from '../src/operations/backup.mjs';
const { values } = parseArgs({ options: { backup: { type: 'string' }, output: { type: 'string' }, 'source-output': { type: 'string' } } });
if (!values.backup || !values.output) throw new Error('Required: --backup <downloaded-release-directory> --output <new-directory> [--source-output <new-directory>]');
console.log(JSON.stringify(await restoreBackup({ directory: path.resolve(values.backup), output: path.resolve(values.output), sourceOutput: values['source-output'] && path.resolve(values['source-output']) }), null, 2));

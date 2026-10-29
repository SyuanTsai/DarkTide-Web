import { runW17RetirementCli } from './contract-w17-retirement.mjs';

try {
  await runW17RetirementCli();
} catch (error) {
  process.stderr.write('W17 preflight failed: ' + error.message + '\n');
  process.exitCode = 1;
}
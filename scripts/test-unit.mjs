import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const discoverTests = (directory) => readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return discoverTests(path);
    return entry.isFile() && entry.name.endsWith('.test.js') ? [path] : [];
  });

const tests = discoverTests('src').sort();
if (!tests.length) throw new Error('No unit tests were found under src.');

const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...tests], { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.signal) throw new Error(`Unit tests stopped by ${result.signal}.`);
if (result.status === null) throw new Error('Unit tests did not return an exit status.');
process.exitCode = result.status;

#!/usr/bin/env node

import { cac } from 'cac';
import { remove } from './remove.js';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const cli = cac('ts-remove-unused');

cli
  .command('', 'There are no subcommands. Simply execute ts-remove-unused')
  .option('--project <file>', 'Path to your tsconfig.json')
  .option(
    '--skip <regexp_pattern>',
    'Specify the regexp pattern to match files that should be skipped from transforming',
  )
  .option('--include-d-ts', 'Include .d.ts files in target for transformation')
  .option(
    '--check',
    'Check if there are any unused exports without removing them',
  )
  .action((options) => {
    const skipArg = options.skip;

    const skip =
      skipArg && Array.isArray(skipArg)
        ? skipArg.map((s) => new RegExp(s))
        : typeof skipArg === 'string'
          ? [new RegExp(skipArg)]
          : [];

    if (!options['includeD-ts']) {
      skip.push(new RegExp('\\.d\\.ts'));
    }

    remove({
      configPath: resolve(options.project || './tsconfig.json'),
      skip,
      mode: options.check ? 'check' : 'write',
      projectRoot: process.cwd(),
    });
  });

cli.help();

const { version } = createRequire(import.meta.url)('../package.json');

cli.version(`v${version}`);
cli.parse();

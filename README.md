# ts-remove-unused

> Remove unused code from your TypeScript project

## Install

```bash
npm i typescript ## TypeScript is a peer dependency
npm i -D @line/ts-remove-unused
```

## Usage

```
Usage:
  $ ts-remove-unused 

Commands:
    There are no subcommands. Simply execute ts-remove-unused

For more info, run any command with the `--help` flag:
  $ ts-remove-unused --help

Options:
  --project <file>         Path to your tsconfig.json 
  --skip <regexp_pattern>  Specify the regexp pattern to match files that should be skipped from transforming 
  --include-d-ts           Include .d.ts files in target for transformation 
  --check                  Check if there are any unused exports without removing them 
  -h, --help               Display this message 
  -v, --version            Display version number 
```

The CLI will respect the `tsconfig.json` for loading source files.

Here's an example of using the cli.

```
npx ts-remove-unused --skip 'src\/index\.ts'
```

### Check

Use `--check` to check for unused files and exports without making changes to project files. The command will exit with
code: 1 if there are any unused files or exports discovered.

```
npx ts-remove-unused --check
```

### Use the JavaScript API

Alternatively, you can use the JavaScript API to execute ts-remove-unused.

```typescript
import { remove } from '@line/ts-remove-unused';

remove({
  configPath: '/path/to/project/tsconfig.json',
  projectRoot: '/path/to/project',
  skip: [/main.ts/],
  mode: 'write',
});
```

### Skip removing unused exports

When you add a comment `// ts-remove-unused-skip` to your export declaration, the CLI will skip it from being removed

```ts
// ts-remove-unused-skip
export const hello = 'world';
```

By default, .d.ts files are skipped. If you want to include .d.ts files, use the --include-d-ts option.

## License

```
Copyright (C) 2023 LINE Corp.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

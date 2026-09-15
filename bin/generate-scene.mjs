#!/usr/bin/env node
import { tsImport } from 'tsx/esm/api';

const module = await tsImport('../src/cli/index.ts', import.meta.url);
await module.runCli(process.argv.slice(2));

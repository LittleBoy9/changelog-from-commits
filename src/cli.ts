#!/usr/bin/env node
import { run } from './run.js';

// This module is only ever the executable entry point; `run` lives in run.ts so
// it can be imported and tested without launching the CLI as a side effect.
run(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: Error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });

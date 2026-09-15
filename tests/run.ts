import { runPipelineTests } from './pipeline.test.js';
import { runSceneSpecTests } from './sceneSpec.test.js';

const tests: Array<[string, () => Promise<void>]> = [
  ['Scene Spec and prompt adapter', runSceneSpecTests],
  ['Project pipeline and ZIP packager', runPipelineTests],
];

let failed = 0;
for (const [name, run] of tests) {
  try {
    await run();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}`);
    console.error(error);
  }
}
if (failed) process.exitCode = 1;
else console.log(`\n${tests.length} test groups passed.`);

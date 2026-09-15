import assert from 'node:assert/strict';
import { promptToSceneSpec } from '../src/pipeline/promptToSpec.js';
import { validateSceneSpec } from '../src/spec/validateSceneSpec.js';

export async function runSceneSpecTests(): Promise<void> {
  const spec = await promptToSceneSpec('生成一个低多边形咖啡店，玻璃门可以打开，椅子可以拖动，吊灯可以点击开关');
  const result = validateSceneSpec(spec);
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(spec.name, 'low-poly-cafe');
  assert.ok(spec.objects.some((object) => object.type === 'door' && object.interactions?.some((entry) => entry.type === 'hinge')));
  assert.ok(spec.objects.some((object) => object.type === 'chair' && object.interactions?.some((entry) => entry.type === 'drag')));
  assert.ok(spec.objects.some((object) => object.type === 'light' && object.interactions?.some((entry) => entry.type === 'toggle')));

  const unknownSpec = await promptToSceneSpec('生成一个低多边形实验室，量子仪器可以拖动');
  assert.ok(unknownSpec.objects.some((object) => object.type === 'generic' && object.name.includes('量子仪器')));
  assert.equal(validateSceneSpec(unknownSpec).valid, true);

  const rotateSpec = await promptToSceneSpec('生成一个实验空间，未知仪器可以旋转');
  assert.ok(rotateSpec.objects.some((object) => object.name.includes('未知仪器') && object.interactions?.some((entry) => entry.type === 'rotate')));
  assert.equal(validateSceneSpec(rotateSpec).valid, true);

  const lightSpec = await promptToSceneSpec('生成一个工作间，墙灯可以点击开关');
  assert.ok(lightSpec.objects.some((object) => object.name.includes('墙灯') && object.type === 'light' && object.interactions?.some((entry) => entry.type === 'toggle')));
  assert.equal(validateSceneSpec(lightSpec).valid, true);

  const invalidSpec = await promptToSceneSpec('生成一个展厅，植物');
  invalidSpec.objects[1].id = invalidSpec.objects[0].id;
  invalidSpec.objects[0].material.color = 'wood';
  const invalidResult = validateSceneSpec(invalidSpec);
  assert.equal(invalidResult.valid, false);
  assert.ok(invalidResult.errors.some((error) => error.includes('duplicates')));
  assert.ok(invalidResult.errors.some((error) => error.includes('#RRGGBB')));
}

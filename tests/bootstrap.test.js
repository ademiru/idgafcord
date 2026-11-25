import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { bootstrap } from './bootstrap.js';
test('the actual assembled native bootstrap has valid JavaScript', () => {
  const script = bootstrap();
  assert.doesNotMatch(script, /__LDC_\w+_(MODULE|CSS|URI)__/);
  assert.doesNotThrow(() => new vm.Script(script));
});
test('no modules run on external origins or the suspended blank page', () => {
  for (const hostname of ['example.org', '', 'discord.com.evil.test']) {
    assert.doesNotThrow(() => vm.runInNewContext(bootstrap(), { location: { hostname } }));
  }
});

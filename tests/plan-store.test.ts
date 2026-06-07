import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { createPlanStore } from '../src/plans/store.js';

describe('plan store', () => {
  test('reads missing plan files as empty content', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mini-agent-plan-home-'));
    const store = createPlanStore({
      home,
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
    });

    await expect(store.read()).resolves.toBe('');
  });

  test('writes and reads the current session plan file', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mini-agent-plan-home-'));
    const store = createPlanStore({
      home,
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
    });

    await expect(store.write('# Plan\n\n- Read files')).resolves.toEqual({
      ok: true,
      content: expect.stringContaining('Wrote'),
    });
    await expect(store.read()).resolves.toBe('# Plan\n\n- Read files');
  });
});

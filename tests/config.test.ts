import { describe, expect, test } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  test('loads required OpenAI-compatible settings', () => {
    const config = loadConfig({
      OPENAI_API_KEY: 'key',
      OPENAI_BASE_URL: 'https://example.com/v1/',
      OPENAI_MODEL: 'model-a',
    });

    expect(config).toEqual({
      apiKey: 'key',
      baseUrl: 'https://example.com/v1',
      model: 'model-a',
      maxSteps: 10,
    });
  });

  test('fails when required settings are missing', () => {
    expect(() => loadConfig({})).toThrow(
      'Missing required environment variables: OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL',
    );
  });

  test('supports numeric max step override', () => {
    const config = loadConfig({
      OPENAI_API_KEY: 'key',
      OPENAI_BASE_URL: 'https://example.com/v1',
      OPENAI_MODEL: 'model-a',
      MAX_AGENT_STEPS: '3',
    });

    expect(config.maxSteps).toBe(3);
  });
});

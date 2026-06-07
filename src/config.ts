export type AgentConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxSteps: number;
};

type Env = Record<string, string | undefined>;

const REQUIRED_ENV = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL'] as const;

export function loadConfig(env: Env = process.env): AgentConfig {
  const missing = REQUIRED_ENV.filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const maxSteps = parseMaxSteps(env.MAX_AGENT_STEPS);

  return {
    apiKey: env.OPENAI_API_KEY!.trim(),
    baseUrl: trimTrailingSlash(env.OPENAI_BASE_URL!.trim()),
    model: env.OPENAI_MODEL!.trim(),
    maxSteps,
  };
}

function parseMaxSteps(value: string | undefined): number {
  if (!value?.trim()) {
    return 10;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('MAX_AGENT_STEPS must be a positive integer');
  }

  return parsed;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

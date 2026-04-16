// src-v3/utils/model-config.ts

/**
 * Resolve the Claude model to use, with no silent fallback.
 * Precedence: explicit arg → process.env.CLAUDE_MODEL → throw.
 *
 * Per user rule (v2 lesson): silent fallback to a default model (e.g. 'haiku' or 'opus')
 * enabled expensive runtime surprises. Fail-fast instead — the caller must make the choice
 * deliberate.
 */
export function requireModel(explicit?: string): string {
  if (explicit && explicit.length > 0) return explicit;
  const fromEnv = process.env.CLAUDE_MODEL;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  throw new Error(
    'CLAUDE_MODEL is not set. Set CLAUDE_MODEL in .env (e.g. CLAUDE_MODEL=sonnet) ' +
    'or pass `model` explicitly in the caller config. No silent default is applied.'
  );
}

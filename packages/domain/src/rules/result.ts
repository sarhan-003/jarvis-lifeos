export type RuleResult<T> = { ok: true; value: T } | { ok: false; error: string; candidates?: string[] };

export const ok = <T>(value: T): RuleResult<T> => ({ ok: true, value });
export const fail = <T>(error: string, candidates?: string[]): RuleResult<T> =>
  candidates ? { ok: false, error, candidates } : { ok: false, error };

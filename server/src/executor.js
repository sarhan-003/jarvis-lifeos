// Runs a tool call end to end: normalize -> validate -> (confirm?) -> execute,
// and records every attempt in the action log so the UI can show exactly what
// happened, including failures.
import { TOOLS, ToolError } from './tools.js';
import { resolveDate } from './dates.js';

const DATE_KEYS = ['dueDate', 'date'];

// Accept "tomorrow" / "friday" for date fields from either agent.
function normalizeDates(args, today) {
  const out = { ...args };
  for (const key of DATE_KEYS) {
    if (typeof out[key] === 'string') out[key] = resolveDate(out[key], today) ?? out[key];
  }
  return out;
}

function formatZodError(error) {
  return error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ');
}

export async function executeTool(name, rawArgs, ctx) {
  const { store, today, request = '', source = 'assistant', provider = null, via } = ctx;
  const base = { request, source, provider, ...(via ? { via } : {}), tool: name, args: rawArgs ?? {} };
  const tool = TOOLS[name];
  if (!tool) {
    return store.logAction({ ...base, status: 'error', error: `Unknown tool "${name}".` });
  }

  const parsed = tool.schema.safeParse(normalizeDates(rawArgs ?? {}, today));
  if (!parsed.success) {
    return store.logAction({ ...base, status: 'error', error: `Invalid arguments: ${formatZodError(parsed.error)}` });
  }
  const args = parsed.data;

  try {
    if (tool.confirmation && !ctx.confirmed) {
      const confirm = tool.confirmation(args, { store, today });
      if (confirm) {
        return store.logAction({
          ...base,
          args: confirm.args,
          status: 'awaiting_confirmation',
          message: confirm.prompt,
        });
      }
    }
    const { result, message } = await tool.run(args, { store, today });
    return store.logAction({ ...base, args, status: 'success', result, message });
  } catch (err) {
    if (err instanceof ToolError) {
      return store.logAction({ ...base, args, status: 'error', error: err.message, result: err.details ?? null });
    }
    throw err;
  }
}

// Resolve an action that is waiting for the user's yes/no.
export async function resolveConfirmation(store, actionId, approve, today) {
  const action = store.getAction(actionId);
  if (!action) throw new ToolError(`No action with id ${actionId}.`);
  if (action.status !== 'awaiting_confirmation') {
    throw new ToolError(`Action ${actionId} is not awaiting confirmation (status: ${action.status}).`);
  }
  if (!approve) {
    return store.patchAction(actionId, { status: 'cancelled', message: `Cancelled: ${action.message}` });
  }
  const tool = TOOLS[action.tool];
  try {
    const { result, message } = await tool.run(action.args, { store, today });
    return store.patchAction(actionId, { status: 'success', result, message, confirmedAt: new Date().toISOString() });
  } catch (err) {
    if (err instanceof ToolError) return store.patchAction(actionId, { status: 'error', error: err.message });
    throw err;
  }
}

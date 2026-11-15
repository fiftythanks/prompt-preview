import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import type { Model } from "@oh-my-pi/pi-ai";
import { getSupportedEfforts, requireSupportedEffort } from "@oh-my-pi/pi-catalog/model-thinking";
import { getSelectListTheme, SelectList, truncateToWidth } from "@oh-my-pi/pi-tui";
import type { ReviewSettings, ReviewerSelection } from "./contract";

export const DEFAULT_SETTINGS: ReviewSettings = {
  enabled: true, provider: "openai-codex", modelId: "gpt-6.1-terra", effort: "low",
};

function supportsOff(model: Model): boolean {
  return !model.thinking?.requiresEffort || model.thinking.suppressWhenOff === true;
}

export function validateSelection(ctx: ExtensionContext, selection: ReviewerSelection): Model {
  const model = ctx.models.list().find(item => item.provider === selection.provider && item.id === selection.modelId);
  if (!model) throw new Error(`Reviewer ${selection.provider}/${selection.modelId} is not available in the configured model list`);
  if (selection.effort === "off") {
    if (!supportsOff(model)) throw new Error(`Reviewer ${model.provider}/${model.id} does not support effort off`);
  } else {
    const effort = getSupportedEfforts(model).find(item => item === selection.effort);
    if (!effort) throw new Error(`Effort ${selection.effort} is not supported by ${model.provider}/${model.id}`);
    requireSupportedEffort(model, effort);
  }
  return model;
}

type Owner = { id: string; file: string; artifacts: string; directory: string };
function owner(ctx: ExtensionContext): Owner {
  const manager = ctx.sessionManager;
  const id = manager.getSessionId();
  const file = manager.getSessionFile();
  const artifacts = manager.getArtifactsDir();
  if (!id || !file || !artifacts) throw new Error("Prompt-review settings require a persistent session and artifacts directory");
  return { id, file, artifacts, directory: join(artifacts, "prompt-review", Buffer.from(id, "utf8").toString("base64url")) };
}
function assertOwner(ctx: ExtensionContext, expected: Owner): void {
  const current = owner(ctx);
  if (current.id !== expected.id || current.file !== expected.file || current.artifacts !== expected.artifacts) {
    throw new Error("Session changed while accessing prompt-review settings");
  }
}
async function materialise(ctx: ExtensionContext, expected: Owner): Promise<void> {
  await ctx.sessionManager.ensureOnDisk();
  assertOwner(ctx, expected);
  if (!(await stat(expected.file)).isFile()) throw new Error("Prompt-review session file is not persistent");
  assertOwner(ctx, expected);
}

function parseSettings(value: unknown, id: string): ReviewSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Malformed prompt-review settings");
  const record = value as Record<string, unknown>;
  const keys = ["schemaVersion", "ownerSessionId", "enabled", "provider", "modelId", "effort"];
  if (Object.keys(record).length !== keys.length || keys.some(key => !(key in record)) ||
      record.schemaVersion !== 1 || record.ownerSessionId !== id || typeof record.enabled !== "boolean" ||
      typeof record.provider !== "string" || !record.provider || typeof record.modelId !== "string" || !record.modelId ||
      typeof record.effort !== "string" || !record.effort) {
    throw new Error("Malformed, unsupported or incorrectly owned prompt-review settings");
  }
  return { enabled: record.enabled, provider: record.provider, modelId: record.modelId, effort: record.effort };
}

export async function loadSettings(ctx: ExtensionContext): Promise<ReviewSettings> {
  const expected = owner(ctx);
  await materialise(ctx, expected);
  let raw: string;
  try {
    raw = await readFile(join(expected.directory, "settings.json"), "utf8");
  } catch (error) {
    assertOwner(ctx, expected);
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...DEFAULT_SETTINGS };
    throw error;
  }
  assertOwner(ctx, expected);
  return parseSettings(JSON.parse(raw), expected.id);
}

const writes = new Map<string, Promise<void>>();
export async function saveSettings(ctx: ExtensionContext, settings: ReviewSettings): Promise<void> {
  const expected = owner(ctx);
  const snapshot = parseSettings({ schemaVersion: 1, ownerSessionId: expected.id, ...settings }, expected.id);
  const key = join(expected.directory, "settings.json");
  const previous = writes.get(key) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    await materialise(ctx, expected);
    const parent = join(expected.artifacts, "prompt-review");
    await mkdir(parent, { recursive: true, mode: 0o700 });
    await chmod(parent, 0o700);
    await mkdir(expected.directory, { recursive: true, mode: 0o700 });
    await chmod(expected.directory, 0o700);
    const temporary = join(expected.directory, `.settings-${randomUUID()}.tmp`);
    let created = false;
    try {
      const handle = await open(temporary, "wx", 0o600);
      created = true;
      try {
        await handle.chmod(0o600);
        await handle.writeFile(JSON.stringify({ schemaVersion: 1, ownerSessionId: expected.id, ...snapshot }) + "\n", "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      assertOwner(ctx, expected);
      await rename(temporary, key);
      created = false;
      const directory = await open(expected.directory, "r");
      try { await directory.sync(); } finally { await directory.close(); }
      assertOwner(ctx, expected);
    } finally {
      if (created) await unlink(temporary).catch(() => {});
    }
  });
  writes.set(key, operation);
  try { await operation; } finally { if (writes.get(key) === operation) writes.delete(key); }
}

async function select(ctx: ExtensionContext, title: string, items: { value: string; label: string }[], selected: string, search: boolean, signal?: AbortSignal): Promise<string | undefined> {
  if (signal?.aborted) return undefined;
  try {
    return await ctx.ui.custom<string | undefined>((tui, theme, _keys, done) => {
      const list = new SelectList(items, 12, getSelectListTheme(), { search: search ? "always" : "never", emptyText: "No available choices" });
      list.setSelectedValue(selected);
      list.onSelect = item => done(item.value);
      list.onCancel = () => done(undefined);
      return {
        render(width: number) { return [truncateToWidth(theme.bold(title), width), ...list.render(width)]; },
        invalidate() { list.invalidate(); },
        handleInput(data: string) { list.handleInput(data); tui.requestRender(); },
      };
    }, { overlay: true, signal });
  } catch (error) {
    if (signal?.aborted) return undefined;
    throw error;
  }
}

export async function chooseSelection(ctx: ExtensionContext, current: ReviewerSelection, signal?: AbortSignal): Promise<ReviewerSelection | undefined> {
  if (!ctx.hasUI || ctx.mode !== "tui") throw new Error("Reviewer selection requires an interactive terminal");
  const models = ctx.models.list();
  const items = models.map((model, index) => ({ value: String(index), label: `${model.provider}/${model.id}` }));
  const selected = models.findIndex(model => model.provider === current.provider && model.id === current.modelId);
  const choice = await select(ctx, "Select reviewer (type to search)", items, String(selected), true, signal);
  if (choice === undefined || signal?.aborted) return undefined;
  const model = models[Number(choice)];
  if (!model) throw new Error("Selected reviewer is no longer available");
  const efforts: string[] = [...(supportsOff(model) ? ["off"] : []), ...getSupportedEfforts(model)];
  const effort = await select(ctx, `Effort for ${model.provider}/${model.id}`, efforts.map(value => ({ value, label: value })), current.effort, false, signal);
  if (effort === undefined || signal?.aborted) return undefined;
  const result = { provider: model.provider, modelId: model.id, effort };
  validateSelection(ctx, result);
  return result;
}

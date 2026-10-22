// Persistent JSON-file store. Every mutation is written to disk atomically
// (write temp file, then rename) so data survives server and page reloads.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const EMPTY = () => ({ tasks: [], plans: [], actions: [] });

export class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = EMPTY();
    this.queue = Promise.resolve();
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      this.data = { ...EMPTY(), ...JSON.parse(raw) };
    } catch (err) {
      if (err.code !== 'ENOENT') throw new Error(`Cannot read data file ${this.filePath}: ${err.message}`);
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      this.data = EMPTY();
      this.flushSync();
    }
  }

  flushSync() {
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.filePath);
  }

  // Serialize writes so concurrent requests never interleave file writes.
  save() {
    this.queue = this.queue.then(() => this.flushSync());
    return this.queue;
  }

  static id(prefix) {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  }

  // ---- tasks ----
  listTasks({ status = 'all', dueDate } = {}) {
    return this.data.tasks
      .filter((t) => status === 'all' || t.status === status)
      .filter((t) => !dueDate || t.dueDate === dueDate)
      .sort(byDueThenCreated);
  }

  getTask(id) {
    return this.data.tasks.find((t) => t.id === id) ?? null;
  }

  async insertTask(fields) {
    const now = new Date().toISOString();
    const task = {
      id: Store.id('task'),
      title: fields.title,
      dueDate: fields.dueDate ?? null,
      priority: fields.priority ?? 'medium',
      notes: fields.notes ?? '',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    this.data.tasks.push(task);
    await this.save();
    return task;
  }

  async patchTask(id, patch) {
    const task = this.getTask(id);
    if (!task) return null;
    Object.assign(task, patch, { updatedAt: new Date().toISOString() });
    await this.save();
    return task;
  }

  async removeTask(id) {
    const idx = this.data.tasks.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    const [task] = this.data.tasks.splice(idx, 1);
    await this.save();
    return task;
  }

  // ---- study plans (one plan per date) ----
  listPlans() {
    return [...this.data.plans].sort((a, b) => a.date.localeCompare(b.date));
  }

  getPlan(id) {
    return this.data.plans.find((p) => p.id === id) ?? null;
  }

  getPlanByDate(date) {
    return this.data.plans.find((p) => p.date === date) ?? null;
  }

  async upsertPlan(plan) {
    const now = new Date().toISOString();
    const existing = this.getPlanByDate(plan.date);
    if (existing) {
      Object.assign(existing, plan, { id: existing.id, createdAt: existing.createdAt, updatedAt: now });
      await this.save();
      return existing;
    }
    const created = { id: Store.id('plan'), ...plan, createdAt: now, updatedAt: now };
    this.data.plans.push(created);
    await this.save();
    return created;
  }

  // ---- action log (tool execution transparency) ----
  listActions(limit = 50) {
    return this.data.actions.slice(-limit).reverse();
  }

  getAction(id) {
    return this.data.actions.find((a) => a.id === id) ?? null;
  }

  async logAction(action) {
    const record = { id: Store.id('act'), createdAt: new Date().toISOString(), ...action };
    this.data.actions.push(record);
    if (this.data.actions.length > 500) this.data.actions.splice(0, this.data.actions.length - 500);
    await this.save();
    return record;
  }

  async patchAction(id, patch) {
    const action = this.getAction(id);
    if (!action) return null;
    Object.assign(action, patch, { updatedAt: new Date().toISOString() });
    await this.save();
    return action;
  }
}

function byDueThenCreated(a, b) {
  if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
  if (a.dueDate && !b.dueDate) return -1;
  if (!a.dueDate && b.dueDate) return 1;
  return a.createdAt.localeCompare(b.createdAt);
}

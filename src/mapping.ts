const HOURS_PER_MONTH = 730;
const SECONDS_PER_MONTH = HOURS_PER_MONTH * 3600;

// Linux/X86, US East (N. Virginia), from the worked examples on
// https://aws.amazon.com/fargate/pricing/ retrieved 2026-11-26.
const CPU_USD_PER_VCPU_SECOND = 0.000011244;
const MEMORY_USD_PER_GB_SECOND = 0.000001235;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export function documentsFromText(text: string): Json[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    return [JSON.parse(trimmed) as Json];
  } catch {
    const docs: Json[] = [];
    for (const line of text.split('\n')) {
      const item = line.trim();
      if (!item) continue;
      try {
        docs.push(JSON.parse(item) as Json);
      } catch {
        // Pulumi progress lines are not part of the plan.
      }
    }
    return docs;
  }
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function cpuVcpu(value: unknown): number {
  if (typeof value === 'number') return value;
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  if (raw.endsWith('m')) return Number(raw.slice(0, -1)) / 1000;
  return Number(raw);
}

function memoryGb(value: unknown): number {
  if (typeof value === 'number') return value / 1024 ** 3;
  const raw = String(value ?? '').trim();
  const match = raw.match(/^([0-9.]+)(Ki|Mi|Gi|Ti|K|M|G|T)?$/);
  if (!match) return 0;
  const amount = Number(match[1]);
  switch (match[2]) {
    case 'Ki':
      return amount / 1024 / 1024;
    case 'Mi':
      return amount / 1024;
    case 'Gi':
      return amount;
    case 'Ti':
      return amount * 1024;
    case 'K':
      return amount / 1e6;
    case 'M':
      return amount / 1e3;
    case 'G':
      return amount;
    case 'T':
      return amount * 1000;
    default:
      return amount / 1024 ** 3;
  }
}

function containersOf(state: Record<string, unknown>): Record<string, unknown>[] {
  const bag = asObject(state.inputs ?? state.outputs ?? state);
  const spec = asObject(bag.spec ?? bag);
  const template = asObject(spec.template);
  const pod = asObject(template.spec ?? template);
  const containers = pod.containers ?? spec.containers;
  if (!Array.isArray(containers)) return [];
  return containers.filter((item) => item && typeof item === 'object') as Record<string, unknown>[];
}

function replicasOf(state: Record<string, unknown>): number {
  const bag = asObject(state.inputs ?? state.outputs ?? state);
  const spec = asObject(bag.spec ?? bag);
  const replicas = Number(spec.replicas ?? bag.replicas ?? 1);
  return Number.isFinite(replicas) && replicas > 0 ? replicas : 1;
}

function costOf(state: Record<string, unknown>): number {
  const replicas = replicasOf(state);
  let usd = 0;
  for (const container of containersOf(state)) {
    const resources = asObject(container.resources);
    const requests = asObject(resources.requests);
    if (!requests.cpu && !requests.memory) continue;
    usd += replicas * cpuVcpu(requests.cpu) * CPU_USD_PER_VCPU_SECOND * SECONDS_PER_MONTH;
    usd += replicas * memoryGb(requests.memory) * MEMORY_USD_PER_GB_SECOND * SECONDS_PER_MONTH;
  }
  return usd;
}

function addState(
  states: Map<string, Record<string, unknown>>,
  op: unknown,
  state: unknown,
  urn: unknown,
  anon: { n: number },
) {
  const key = typeof urn === 'string' && urn ? urn : `anon-${anon.n++}`;
  if (op === 'delete' || op === 'remove') {
    states.delete(key);
    return;
  }
  if (!state || typeof state !== 'object') return;
  states.set(key, state as Record<string, unknown>);
}

export function planCostUsd(docs: unknown[]): number {
  const states = new Map<string, Record<string, unknown>>();
  const anon = { n: 0 };
  for (const doc of docs) {
    const root = asObject(doc);
    const steps = root.steps;
    if (Array.isArray(steps)) {
      for (const step of steps) {
        const item = asObject(step);
        addState(states, item.op, item.newState ?? item.new, item.urn, anon);
      }
    }
    for (const eventName of ['resourcePreEvent', 'resOutputsEvent']) {
      const metadata = asObject(asObject(root[eventName]).metadata);
      if (Object.keys(metadata).length > 0) {
        addState(states, metadata.op, metadata.new ?? metadata.newState, metadata.urn, anon);
      }
    }
  }
  let usd = 0;
  for (const state of states.values()) usd += costOf(state);
  return usd;
}

export function formatUsd(value: number): string {
  return value.toFixed(4);
}

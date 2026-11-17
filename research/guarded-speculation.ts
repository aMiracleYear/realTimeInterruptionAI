/** Discrete-event scheduling experiment. No audio, provider, or learned model is simulated. */
export interface Snapshot {
  epoch: string;
  revision: number;
  /** Exact serialized request AND trust/finalization/reference/model identities. */
  request: string;
}
export interface Observation {
  at: number;
  eligibleAt: number;
  snapshot: Snapshot;
  verdict: "listen" | "interrupt";
  fail?: boolean;
  /** Evaluation-only counterfactual label; never consulted by scheduling or policy. */
  wouldRecover?: boolean;
}
export interface Scenario {
  name: string;
  judgeMs: number;
  observations: Observation[];
  controls?: { at: number; type: "end" | "think"; until?: number }[];
  maxSpeculations?: number;
}
type Job = { id: number; observation: Observation; start: number; end: number; speculative: boolean };
type Event = { at: number; priority: number; order: number; run: () => void };
const same = (a: Snapshot, b: Snapshot) =>
  a.epoch === b.epoch && a.revision === b.revision && a.request === b.request;
const key = (s: Snapshot) => JSON.stringify([s.epoch, s.revision, s.request]);

export function simulate(scenario: Scenario, strategy: "serial" | "speculative") {
  if (!Number.isFinite(scenario.judgeMs) || scenario.judgeMs <= 0) throw new Error("Invalid duration");
  if (!Number.isInteger(scenario.maxSpeculations ?? 1) || (scenario.maxSpeculations ?? 1) < 0)
    throw new Error("Invalid speculation budget");
  let previousAt = -Infinity;
  for (const o of scenario.observations) {
    if (![o.at, o.eligibleAt].every(Number.isFinite) || o.at < 0 || o.eligibleAt < o.at)
      throw new Error("Invalid observation timing");
    if (o.at < previousAt) throw new Error("Observations must be ordered");
    previousAt = o.at;
  }
  for (const c of scenario.controls ?? []) {
    if (!Number.isFinite(c.at) || c.at < 0 ||
      (c.type === "think" && (!Number.isFinite(c.until) || c.until! < c.at)))
      throw new Error("Invalid control timing");
  }
  let now = 0, order = 0, ended = false, protectedUntil = 0;
  let current: Observation | undefined, active: Job | undefined, pending: Observation | undefined;
  let speculations = 0, staleCompletions = 0, policyBlocked = 0, failures = 0;
  const events: Event[] = [], jobs: Job[] = [], completed: Job[] = [];
  const committed = new Set<string>();
  const decisions: { at: number; observationAt: number; snapshot: Snapshot; action: string; harmful: boolean }[] = [];
  const queueWaits: number[] = [];
  const schedule = (at: number, priority: number, run: () => void) => events.push({ at, priority, order: order++, run });
  const valid = (o: Observation) => !ended && Boolean(current && same(current.snapshot, o.snapshot));
  function commit(job: Job) {
    const o = job.observation;
    if (!valid(o) || !current || now < current.eligibleAt || committed.has(key(current.snapshot)) || o.fail) return;
    committed.add(key(current.snapshot));
    if (now < protectedUntil) { policyBlocked++; return; }
    decisions.push({ at: now, observationAt: current.at, snapshot: { ...current.snapshot },
      action: o.verdict, harmful: o.verdict === "interrupt" && Boolean(current.wouldRecover) });
  }
  function start(o: Observation, speculative: boolean) {
    if (active) throw new Error("Single-worker capacity exceeded");
    if (!speculative) queueWaits.push(Math.max(0, now - o.eligibleAt));
    const job: Job = { id: jobs.length, observation: o, start: now, end: now + scenario.judgeMs, speculative };
    active = job;
    jobs.push(job);
    schedule(job.end, 3, () => {
      active = undefined;
      completed.push(job);
      if (!valid(o)) staleCompletions++;
      if (o.fail) failures++;
      commit(job);
      // Abort is deliberately NOT assumed to reclaim provider capacity.
      const demand = pending;
      pending = undefined;
      if (demand && valid(demand) && !committed.has(key(demand.snapshot))) {
        const ready = [...completed].reverse().find(j => !j.observation.fail && same(j.observation.snapshot, demand.snapshot));
        if (ready) commit(ready);
        else start(demand, false);
      } else if (o.fail && job.speculative && valid(o) && current && now >= current.eligibleAt) {
        // One ordinary retry after an adopted speculative failure. Never loop on failures.
        start(current, false);
      }
    });
  }
  for (const o of scenario.observations) {
    schedule(o.at, 1, () => {
      if (ended) return;
      current = o;
      pending = undefined;
      if (strategy === "speculative" && !active && speculations < (scenario.maxSpeculations ?? 1)) {
        speculations++;
        start(o, true);
      }
    });
    schedule(o.eligibleAt, 2, () => {
      if (current !== o || !valid(o)) return;
      const ready = [...completed].reverse().find(j => !j.observation.fail && same(j.observation.snapshot, o.snapshot));
      if (ready) { commit(ready); return; }
      // Adopt matching work already in flight; do not create a duplicate.
      if (active && same(active.observation.snapshot, o.snapshot)) return;
      if (active) pending = o;
      else start(o, false);
    });
  }
  for (const c of scenario.controls ?? []) {
    schedule(c.at, 0, () => {
      if (c.type === "end") { ended = true; current = undefined; pending = undefined; }
      else protectedUntil = Math.max(protectedUntil, c.until!);
    });
  }
  while (events.length) {
    events.sort((a, b) => a.at - b.at || a.priority - b.priority || a.order - b.order);
    const event = events.shift()!;
    now = event.at;
    event.run();
  }
  const cuts = decisions.filter(d => d.action === "interrupt");
  // Independently audit each commitment against the observation/control history.
  const audited = new Set<string>();
  const invalidCommits = decisions.filter(d => {
    const duplicate = audited.has(key(d.snapshot));
    audited.add(key(d.snapshot));
    const latest = scenario.observations.filter(o => o.at <= d.at).at(-1);
    const prohibited = scenario.controls?.some(c => c.at <= d.at &&
      (c.type === "end" || d.at < c.until!));
    return duplicate || !latest || !same(latest.snapshot, d.snapshot) || d.at < latest.eligibleAt || prohibited;
  }).length;
  return {
    name: scenario.name, strategy, firstInterruptionMs: cuts[0]?.at ?? null,
    assessorCalls: jobs.length, assessorWorkMs: jobs.length * scenario.judgeMs,
    speculativeCalls: speculations, staleCompletions, policyBlocked, failures,
    maxFallbackQueueMs: Math.max(0, ...queueWaits), invalidCommits,
    harmfulInterruptionCount: cuts.filter(d => d.harmful).length,
    decisions, jobs: jobs.map(({ observation, ...job }) => ({ ...job, revision: observation.snapshot.revision })),
  };
}

// ARCHITECTURE_DAG.md chunk 3 — `typeset.produce` as a claimable node.
//
// The element graph's first node. What has to be true of it:
//
//   1. IT IS A ROOT. It depends only on the run's frozen brief, so it is
//      claimable in the same instant as surface.driver.view and adds NOTHING to
//      the critical path. If it ever acquires a surface dependency, the "zero
//      added latency" claim in the blueprint stops being true.
//   2. THE KILL SWITCH IS THE SHAPE. With DESIGNPRO_ATLAS_ELEMENT_GRAPH unset or
//      off, the compiled graph is byte-for-byte the one without it -- including
//      master.assemble's depends_on array, which is why the element node is
//      appended AFTER master rather than before it.
//   3. IT HANDS ON A REFERENCE, NEVER PIXELS (RULE 0.39). A node output carrying
//      base64 fails here, as it does for surface.driver.view.
//   4. IT NEVER INVENTS A LINE. No company name in the brief means no node at
//      all -- not an empty artifact, and not a guess.
//
// Unset means OFF on purpose: this port has never run live, and the flag that
// defaulted the other way is the weeks of invisible field-first routing that
// CLAUDE.md records.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const runtimeRequire = createRequire(join(HERE, "..", "runtime", "package.json"));
const graph = runtimeRequire(join(HERE, "..", "runtime", "atlas-call1-graph.cjs"));
const typeset = runtimeRequire(join(HERE, "..", "runtime", "atlas-typeset-layer.cjs"));

const BRIEF = { companyName: "Precision Climate Solutions", phone: "(520) 555-0192" };

function withFlag(value, fn) {
  const before = process.env.DESIGNPRO_ATLAS_ELEMENT_GRAPH;
  if (value === null) delete process.env.DESIGNPRO_ATLAS_ELEMENT_GRAPH;
  else process.env.DESIGNPRO_ATLAS_ELEMENT_GRAPH = value;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.DESIGNPRO_ATLAS_ELEMENT_GRAPH;
    else process.env.DESIGNPRO_ATLAS_ELEMENT_GRAPH = before;
  }
}

const compile = (flag, input) =>
  withFlag(flag, () => graph.compileHeroDriverGraph({ heroFirst: true, input }));

test("unset means OFF, and off is byte-for-byte today's graph", () => {
  const unset = compile(null, BRIEF);
  const off = compile("off", BRIEF);
  const typo = compile("ON PLEASE", BRIEF);
  assert.deepEqual(unset, off);
  assert.deepEqual(typo, off, "a typo must not select a customer path");
  assert.ok(!off.some((n) => n.key === graph.TYPESET_NODE));
  assert.equal(off.length, 8);
});

test("on, the element node is a ROOT and master's edges do not move", () => {
  const off = compile("off", BRIEF);
  const on = compile("on", BRIEF);

  const element = on.find((n) => n.key === graph.TYPESET_NODE);
  assert.ok(element, "typeset.produce must be compiled in");
  assert.deepEqual(element.dependsOn, [], "a root, or the zero-latency claim is false");
  assert.equal(element.input.role, "typography");
  assert.equal(element.input.text, BRIEF.companyName, "the node records the exact string it will set");

  // Every surface edge, and master's whole depends_on array, unchanged.
  for (const node of off) {
    const same = on.find((n) => n.key === node.key);
    assert.ok(same, `${node.key} disappeared`);
    assert.deepEqual(same.dependsOn, node.dependsOn, `${node.key}'s edges moved`);
  }
  assert.equal(on.length, off.length + 1);

  // No surface waits on an element in this chunk; master.composite is chunk 8.
  for (const node of on) {
    if (node.key !== graph.TYPESET_NODE) {
      assert.ok(!node.dependsOn.includes(graph.TYPESET_NODE), `${node.key} must not wait on the element yet`);
    }
  }
});

test("no company name means no node — never an empty artifact, never a guess", () => {
  assert.ok(!compile("on", {}).some((n) => n.key === graph.TYPESET_NODE));
  assert.ok(!compile("on", { companyName: "   " }).some((n) => n.key === graph.TYPESET_NODE));
  // businessName is the other spelling the brief uses.
  assert.ok(compile("on", { businessName: "Arctic Air" }).some((n) => n.key === graph.TYPESET_NODE));
});

test("the node key satisfies the migration's CHECK, so no migration is needed", () => {
  assert.match(graph.TYPESET_NODE, /^[a-z][a-z0-9._:-]{1,120}$/);
});

test("executing it stores a REFERENCE at the content hash, and no pixels cross the boundary", async () => {
  const [element] = compile("on", BRIEF).filter((n) => n.key === graph.TYPESET_NODE);
  const puts = [];
  const store = {
    putImmutableBytes: async ({ storagePath, bytes, contentType }) => {
      puts.push({ storagePath, byteSize: bytes.length, contentType });
      return { storagePath, contentHash: null, byteSize: bytes.length };
    },
  };
  const result = await graph.executeNode({
    claim: {
      node: {
        node_key: graph.TYPESET_NODE, input: element.input, depends_on: [],
        lease_owner: "designpro-worker-1", attempt: 1,
      },
      run: { id: "run-1", owner_id: "owner-1", created_at: new Date().toISOString(),
        definition: { manifest: { zones: [{ surfaceKey: "driver" }] }, input: BRIEF } },
      claimToken: "token",
      dependencies: [],
    },
    store,
    supabase: null,
    callEdge: () => { throw new Error("an element node must make NO model call"); },
  });

  assert.equal(result.state, "completed");
  assert.equal(result.output.role, "typography");
  assert.equal(result.output.deterministic, true);
  assert.equal(result.output.leaseOwner, "designpro-worker-1");

  const ref = result.output.element;
  assert.match(ref.contentHash, /^[0-9a-f]{64}$/);
  assert.equal(ref.storagePath, typeset.elementStoragePath(ref.contentHash),
    "the storage path IS the content hash, so a re-claim re-reads instead of re-writing");
  assert.equal(puts.length, 1);
  assert.equal(puts[0].storagePath, ref.storagePath);
  assert.equal(puts[0].contentType, "image/png");
  assert.ok(ref.width > 0 && ref.height > 0);

  // RULE 0.39: identity crosses the node boundary, never bytes.
  const serialized = JSON.stringify(result.output);
  assert.ok(!/[A-Za-z0-9+/]{400,}={0,2}/.test(serialized), "a node output must not carry base64 pixels");
  assert.ok(!serialized.includes("data:image"));
  assert.ok(!("bytes" in result.output));
});

test("the same brief on two runs resolves to the same artifact", async () => {
  const [element] = compile("on", BRIEF).filter((n) => n.key === graph.TYPESET_NODE);
  const run = async (leaseOwner) => {
    const out = await graph.executeNode({
      claim: {
        node: { node_key: graph.TYPESET_NODE, input: element.input, depends_on: [], lease_owner: leaseOwner, attempt: 1 },
        run: { id: "run-1", owner_id: "owner-1", created_at: new Date().toISOString(),
          definition: { manifest: { zones: [{ surfaceKey: "driver" }] }, input: BRIEF } },
        claimToken: "token", dependencies: [],
      },
      store: { putImmutableBytes: async ({ storagePath, bytes }) => ({ storagePath, byteSize: bytes.length }) },
      supabase: null,
      callEdge: () => { throw new Error("no model call"); },
    });
    return out.output.element;
  };
  const one = await run("designpro-worker-1");
  const two = await run("designpro-worker-2");
  assert.equal(one.contentHash, two.contentHash);
  assert.equal(one.storagePath, two.storagePath);
});

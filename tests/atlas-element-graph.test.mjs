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

// Every node the element graph adds. A surface may depend on none of them.
const ELEMENT_NODES = [graph.TYPESET_NODE, graph.CONTACT_NODE, graph.LOGO_NODE, graph.LOCKUP_NODE, graph.COMPOSITE_NODE];

// THE ELEMENT GRAPH BELONGS TO THE RETAINED SINGLE-CALL SHAPE (2026-09-22).
// Hero-first authors its own lettering on the vehicle (the persona brain draws
// the logo, the name and the contact bar into the hero), so
// `compileHeroDriverGraph({ heroFirst: true })` compiles NO element node: a
// typeset lockup composited over brain-lettered flanks would print the name
// twice, and it is the "generic text" the owner rejected. These locks
// therefore compile the single-call shape by name.
const compile = (flag, input) =>
  withFlag(flag, () => graph.compileHeroDriverGraph({ heroFirst: false, input }));

test("hero-first compiles no element node at all: the hero carries its own lettering", () => {
  const on = withFlag("on", () => graph.compileHeroDriverGraph({ heroFirst: true, input: BRIEF }));
  for (const key of ELEMENT_NODES) assert.ok(!on.some((n) => n.key === key), `${key} must not compile on hero-first`);
  assert.equal(on.length, 12, "five views + six surfaces + master.assemble");
});

test("unset means OFF, and off is byte-for-byte today's graph", () => {
  const unset = compile(null, BRIEF);
  const off = compile("off", BRIEF);
  const typo = compile("ON PLEASE", BRIEF);
  assert.deepEqual(unset, off);
  assert.deepEqual(typo, off, "a typo must not select a customer path");
  assert.ok(!off.some((n) => n.key === graph.TYPESET_NODE));
  assert.ok(!off.some((n) => n.key === graph.CONTACT_NODE));
  assert.equal(off.length, 7, "the single-call base graph: six surfaces + master.assemble");
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
  // FIVE, NOT FOUR, SINCE 2026-09-21: typography, contact, the GENERATED MARK,
  // the lockup and the composite. A customer who names their business and
  // uploads no logo now earns `logo.generate` -- the branch `logoNodeFor`
  // used to answer with `return null`, which is how the mark went missing.
  assert.equal(on.length, off.length + 5,
    "typography, contact, the generated mark, the lockup, and the composite");
  const mark = on.find((n) => n.key === "logo.generate");
  assert.ok(mark, "a named business with no uploaded logo earns a drawn mark");
  assert.deepEqual(mark.dependsOn, [], "it reads the brief, never the artwork, so it is a root too");

  // NO SURFACE waits on an element; master.composite (chunk 8) is what will
  // consume them. element.lockup depends on them by design -- it is an element
  // node, not a surface -- so the assertion is about the surfaces and master.
  for (const node of on) {
    if (ELEMENT_NODES.includes(node.key)) continue;
    for (const elementKey of ELEMENT_NODES) {
      assert.ok(!node.dependsOn.includes(elementKey), `${node.key} must not wait on ${elementKey}`);
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

// ---------------------------------------------------------------------------
// ARCHITECTURE_DAG.md chunk 4 — `contact.produce`.
//
// THE CONTACT-INVENTION LOCK, MOVED FROM PROSE INTO STRUCTURE. Today it is a
// sentence in the Call-1 prompt asking the model not to invent a phone number
// or a web address, and that sentence has needed fixing before (the
// phone-missing / website-supplied hole). A node cannot hallucinate: it sets the
// exact strings its row carries, so a line the customer never supplied has no
// way to exist.
// ---------------------------------------------------------------------------

const CONTACT = { companyName: "Precision Climate Solutions", phone: "(520) 555-0192", website: "precisionclimate.com" };

test("the contact bar is its own node, and it is a root", () => {
  const [bar] = compile("on", CONTACT).filter((n) => n.key === graph.CONTACT_NODE);
  assert.ok(bar);
  assert.deepEqual(bar.dependsOn, []);
  assert.equal(bar.input.role, "contact");
  assert.deepEqual(bar.input.lines, [CONTACT.phone, CONTACT.website]);
  assert.equal(bar.input.fontKey, typeset.DEFAULT_CONTACT_FONT, "the bar sets in the contact face, not the display face");
});

test("only supplied lines exist — no invented phone, no invented URL, no invented city", () => {
  assert.deepEqual(graph.contactLinesFrom({}), []);
  assert.deepEqual(graph.contactLinesFrom({ phone: "  " }), []);

  // The hole this replaces: a phone that is missing while a website is present.
  assert.deepEqual(graph.contactLinesFrom({ website: "arcticair.com" }), ["arcticair.com"]);
  assert.deepEqual(graph.contactLinesFrom({ phone: "(520) 555-0192" }), ["(520) 555-0192"]);

  // `phone` and `website` are the ONLY contact fields the input contract
  // carries. A city is not conjured to balance the bar.
  assert.deepEqual(graph.contactLinesFrom({ phone: "p", website: "w", city: "Tucson, AZ" }), ["p", "w"]);
});

test("no contact details means no contact node — and the name node still compiles", () => {
  const nameOnly = compile("on", { companyName: "Arctic Air" });
  assert.ok(nameOnly.some((n) => n.key === graph.TYPESET_NODE));
  assert.ok(!nameOnly.some((n) => n.key === graph.CONTACT_NODE));

  // ...and the reverse: contact with no company name still gets its bar.
  const barOnly = compile("on", { phone: "(520) 555-0192" });
  assert.ok(!barOnly.some((n) => n.key === graph.TYPESET_NODE));
  assert.ok(barOnly.some((n) => n.key === graph.CONTACT_NODE));
});

test("executing the bar renders ONLY its own lines, and never the company name", async () => {
  const [bar] = compile("on", CONTACT).filter((n) => n.key === graph.CONTACT_NODE);
  const [name] = compile("on", CONTACT).filter((n) => n.key === graph.TYPESET_NODE);

  const exec = async (element) => (await graph.executeNode({
    claim: {
      node: { node_key: element.key, input: element.input, depends_on: [], lease_owner: "designpro-worker-1", attempt: 1 },
      run: { id: "run-1", owner_id: "owner-1", created_at: new Date().toISOString(),
        definition: { manifest: { zones: [{ surfaceKey: "driver" }] }, input: CONTACT } },
      claimToken: "token", dependencies: [],
    },
    store: { putImmutableBytes: async ({ storagePath, bytes }) => ({ storagePath, byteSize: bytes.length }) },
    supabase: null,
    callEdge: () => { throw new Error("an element node must make NO model call"); },
  })).output;

  const barOut = await exec(bar);
  assert.equal(barOut.role, "contact");
  assert.match(barOut.element.contentHash, /^[0-9a-f]{64}$/);

  // The two elements are different artifacts: the bar is not the name lockup,
  // and the name lockup does not carry the contact lines.
  const nameOut = await exec(name);
  assert.notEqual(barOut.element.contentHash, nameOut.element.contentHash);

  // Set at the contact size, not the display size.
  //
  // THE HEIGHT WAS A PROXY, AND IT STOPPED HOLDING (2026-09-18). This asserted
  // `barOut.element.height < nameOut.element.height`, which is a statement about
  // CANVAS HEIGHT -- one line of name versus two lines of contact -- and it only
  // ever held because the name was pinned at 12% of the canvas whatever its
  // length. Since a name too wide for its canvas is now FITTED rather than run
  // off the edge, a long company name draws smaller and its one-line canvas can
  // legitimately be shorter than a two-line contact bar.
  //
  // The guarantee this test's own message states is about SIZES, so it is
  // asserted on the sizes, which is what it meant all along and is stricter than
  // the proxy: the bar sets in contact type, the name in display type, and the
  // name is never subordinate to its own contact lines.
  assert.equal(barOut.metrics.nominalLineSize, nameOut.metrics.nominalLineSize,
    "both elements share one canvas width, so one reference proportion");
  assert.ok(barOut.metrics.lineSize <= barOut.metrics.nominalLineSize,
    "the bar sets at the contact proportion, never larger");
  assert.ok(nameOut.metrics.nameSize > barOut.metrics.lineSize,
    "the company name must still read larger than a contact line");

  // Same reference discipline as every other node.
  assert.ok(!("bytes" in barOut));
  assert.ok(!JSON.stringify(barOut).includes("data:image"));
});

// ---------------------------------------------------------------------------
// ARCHITECTURE_DAG.md chunk 5 — `logo.prepare`. The customer's OWN logo.
// It never generates one, and absence is an answer rather than a gap.
// ---------------------------------------------------------------------------

const LOGO_ASSET = { storagePath: "logos/precision.png", contentHash: "c".repeat(64), byteSize: 4096 };

test("no upload means no logo node — and the lockup is the brand mark", () => {
  const none = compile("on", CONTACT);
  assert.ok(!none.some((n) => n.key === graph.LOGO_NODE));
  assert.ok(none.some((n) => n.key === graph.TYPESET_NODE),
    "with no logo the typography lockup IS the mark, which is what buildLogoArchitecture already directs");
});

test("an uploaded logo is its own root, carrying identity and no pixels", () => {
  const withLogo = compile("on", { ...CONTACT, logoAsset: LOGO_ASSET });
  const node = withLogo.find((n) => n.key === graph.LOGO_NODE);
  assert.ok(node);
  assert.deepEqual(node.dependsOn, []);
  assert.equal(node.input.role, "logo");
  assert.equal(node.input.source, "customer");
  assert.deepEqual(node.input.asset, LOGO_ASSET);
  assert.equal(withLogo.length, compile("off", CONTACT).length + 5, "three elements, the lockup, the composite");

  // Still no surface waits on the logo (element.lockup does, by design).
  for (const other of withLogo) {
    if (ELEMENT_NODES.includes(other.key)) continue;
    assert.ok(!other.dependsOn.includes(graph.LOGO_NODE), `${other.key} must not wait on the logo`);
  }
});

test("a malformed logo identity refuses the RUN, before a worker spends a lease", () => {
  assert.throws(
    () => compile("on", { ...CONTACT, logoAsset: { url: "https://example.com/logo.png" } }),
    (err) => err.code === "flat_atlas_logo_identity_invalid",
    "compile-time refusal: a URL is not an immutable identity",
  );
  assert.throws(
    () => compile("on", { ...CONTACT, logoAsset: { storagePath: "logos/a.png", contentHash: "short", byteSize: 10 } }),
    (err) => err.code === "flat_atlas_logo_identity_invalid",
  );
});

// ---------------------------------------------------------------------------
// ARCHITECTURE_DAG.md chunk 6 — `element.lockup`. The one element node that is
// NOT a root: it needs its dependencies' recorded dimensions.
// ---------------------------------------------------------------------------

test("the lockup depends on exactly the elements that exist", () => {
  // CONTACT carries a company name, so the generated mark is one of the
  // elements that exist -- the lockup must wait for it or place it late.
  const both = compile("on", CONTACT).find((n) => n.key === graph.LOCKUP_NODE);
  assert.deepEqual(both.dependsOn.sort(),
    [graph.CONTACT_NODE, graph.TYPESET_NODE, "logo.generate"].sort());

  const nameOnly = compile("on", { companyName: "Arctic Air" }).find((n) => n.key === graph.LOCKUP_NODE);
  assert.deepEqual(nameOnly.dependsOn.sort(), [graph.TYPESET_NODE, "logo.generate"].sort(),
    "no contact node means no phantom edge to one");

  // A PHONE ALONE STILL EARNS NO MARK: there is no business name to draw one
  // for, which is the same honest no-op the customer-logo branch makes.
  const phoneOnly = compile("on", { phone: "555-0142" }).find((n) => n.key === graph.LOCKUP_NODE);
  assert.deepEqual(phoneOnly.dependsOn, [graph.CONTACT_NODE]);

  // An UPLOADED logo takes the prepare branch and is never regenerated.
  const all = compile("on", { ...CONTACT, logoAsset: LOGO_ASSET }).find((n) => n.key === graph.LOCKUP_NODE);
  assert.equal(all.dependsOn.length, 3);
  assert.ok(all.dependsOn.includes(graph.LOGO_NODE));
  assert.ok(!all.dependsOn.includes("logo.generate"));
});

test("nothing to place means no lockup node at all", () => {
  const bare = compile("on", { vehicle: "F250" });
  assert.ok(!bare.some((n) => n.key === graph.LOCKUP_NODE), "an empty manifest is not a plan");
  assert.equal(bare.length, compile("off", CONTACT).length);
});

test("the lockup still gates nothing — no surface waits on it", () => {
  for (const node of compile("on", CONTACT)) {
    if (ELEMENT_NODES.includes(node.key)) continue;
    assert.ok(!node.dependsOn.includes(graph.LOCKUP_NODE), `${node.key} must not wait on the lockup`);
  }
});

test("executing it turns element references into placed boxes", async () => {
  const element = (key, role, width, height) => ({
    nodeKey: key, state: "completed",
    output: { role, element: { storagePath: `atlas-elements/${role}.png`, contentHash: role[0].repeat(64), width, height } },
  });
  const out = (await graph.executeNode({
    claim: {
      node: { node_key: graph.LOCKUP_NODE, input: {}, depends_on: [graph.TYPESET_NODE, graph.CONTACT_NODE],
        lease_owner: "designpro-worker-2", attempt: 1 },
      run: { id: "run-1", owner_id: "owner-1", created_at: new Date().toISOString(),
        definition: { input: CONTACT, manifest: { zones: [
          { surfaceKey: "driver", rotationDegrees: 90, trim: { w: 600, h: 2400 } },
          { surfaceKey: "passenger", rotationDegrees: -90, trim: { w: 600, h: 2400 } },
        ] } } },
      claimToken: "token",
      dependencies: [element(graph.TYPESET_NODE, "typography", 1600, 400), element(graph.CONTACT_NODE, "contact", 1600, 200)],
    },
    store: { putImmutableBytes: async () => { throw new Error("the planner stores nothing"); } },
    supabase: null,
    callEdge: () => { throw new Error("the planner makes NO model call"); },
  })).output;

  assert.equal(out.role, "lockup");
  assert.equal(out.lockup.contract, "designpro.atlas-element-lockup.v1");
  assert.equal(out.lockup.placements.length, 4, "two elements across two flanks");
  const driver = out.lockup.placements.find((p) => p.surfaceKey === "driver" && p.role === "typography");
  const passenger = out.lockup.placements.find((p) => p.surfaceKey === "passenger" && p.role === "typography");
  assert.ok(Math.abs(passenger.box.xPct - (1 - driver.box.xPct - driver.box.wPct)) < 1e-6);
  assert.equal(passenger.flipped, false);
});

test("a dependency with no element reference is incomplete, and RETRYABLE", async () => {
  await assert.rejects(() => graph.executeNode({
    claim: {
      node: { node_key: graph.LOCKUP_NODE, input: {}, depends_on: [graph.TYPESET_NODE], lease_owner: "w", attempt: 1 },
      run: { id: "run-1", owner_id: "o", created_at: new Date().toISOString(),
        definition: { input: CONTACT, manifest: { zones: [{ surfaceKey: "driver", trim: { w: 600, h: 2400 } }] } } },
      claimToken: "t",
      dependencies: [{ nodeKey: graph.TYPESET_NODE, state: "completed", output: { role: "typography" } }],
    },
    store: {}, supabase: null, callEdge: () => {},
  }), (err) => err.code === "designpro_atlas_call1_dependency_incomplete" && err.retryable === true);
});

// ---------------------------------------------------------------------------
// ARCHITECTURE_DAG.md chunk 8 — `master.composite`. The only element node that
// runs AFTER master.assemble, and the only one that touches the sheet.
// ---------------------------------------------------------------------------

test("the composite depends on the assembled master and the plan, and nothing else", () => {
  const node = compile("on", CONTACT).find((n) => n.key === graph.COMPOSITE_NODE);
  assert.ok(node);
  assert.deepEqual(node.dependsOn, ["master.assemble", graph.LOCKUP_NODE],
    "the element producers are already the lockup's dependencies; naming them again duplicates edges");
});

test("no elements means no composite — the assembled master is the master", () => {
  const bare = compile("on", { vehicle: "F250" });
  assert.ok(!bare.some((n) => n.key === graph.COMPOSITE_NODE));
  assert.equal(bare.length, compile("off", CONTACT).length);
});

test("master.assemble's own edges are STILL untouched by any of this", () => {
  const off = compile("off", CONTACT).find((n) => n.key === "master.assemble");
  const on = compile("on", { ...CONTACT, logoAsset: LOGO_ASSET }).find((n) => n.key === "master.assemble");
  assert.deepEqual(on.dependsOn, off.dependsOn,
    "the six surfaces assemble exactly as before; the composite is a node AFTER them");
});

test("an incomplete dependency is retryable, never a silent un-composited sheet", async () => {
  const run = (dependencies) => graph.executeNode({
    claim: {
      node: { node_key: graph.COMPOSITE_NODE, input: {}, depends_on: ["master.assemble", graph.LOCKUP_NODE], lease_owner: "w", attempt: 1 },
      run: { id: "run-1", owner_id: "o", created_at: new Date().toISOString(),
        definition: { input: CONTACT, manifest: { zones: [{ surfaceKey: "driver", rotationDegrees: 90, trim: { x: 0, y: 0, w: 200, h: 600 } }] } } },
      claimToken: "t", dependencies,
    },
    store: {}, supabase: null, callEdge: () => { throw new Error("no model call"); },
  });

  await assert.rejects(() => run([
    { nodeKey: "master.assemble", state: "completed", output: {} },
    { nodeKey: graph.LOCKUP_NODE, state: "completed", output: { lockup: { placements: [] } } },
  ]), (err) => err.code === "designpro_atlas_call1_dependency_incomplete" && err.retryable === true);

  await assert.rejects(() => run([
    { nodeKey: "master.assemble", state: "completed", output: { master: { storagePath: "p", contentHash: "a".repeat(64) } } },
    { nodeKey: graph.LOCKUP_NODE, state: "completed", output: {} },
  ]), (err) => err.code === "designpro_atlas_call1_dependency_incomplete" && err.retryable === true);
});

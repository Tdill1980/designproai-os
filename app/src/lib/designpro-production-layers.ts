/**
 * PRODUCTION LAYERS, FROM THE STANDALONE RUNTIME.
 *
 * `Produ…102723 tokens truncated…ringify({ instruction: "Make the driver logo larger" }),
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "flat_first_atlas_new_run_required" });
  assert.equal(calls.some((item) => item.url.endsWith("/rpc/regenerate_designpro_generation_slot")), false);
});

test("an instructionless flat-first view retry is also refused before the regeneration RPC", async (t) => {
  const requestId = "10000000-0000-4000-8000-000000000010";
  const calls = [];
  const server = createGateway({
    env,
    fetchImpl: async (url, init = {}) => {
      const value = String(url);
      calls.push({ url: value, init });
      if (value.endsWith("/auth/v1/user")) {
        return Response.json({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
      }
      if (value.endsWith("/rest/v1/rpc/designpro_flat_first_handoff_gate")) {
        return Response.json({
          flatFirst: true,
          productionEligible: false,
          revisionId: "40000000-0000-4000-8000-000000000001",
        });
      }
      if (value.endsWith("/rest/v1/rpc/regenerate_designpro_generation_slot")) {
        return Response.json({
          requestId,
          sourceViewType: "side",
          consumerRole: "driver",
          supersededViews: 1,
          state: "queued",
        });
      }
      throw new Error(`unexpected ${url}`);
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/api/generation/requests/${requestId}/views/side/regenerate`, {
    method: "POST",
    headers: { cookie: "dp_session=test-token", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "flat_first_atlas_new_run_required" });
  assert.equal(calls.some((item) => item.url.endsWith("/rpc/regenerate_designpro_generation_slot")), false);
});

test("the active Close-Up view can be regenerated without mutating the accepted one", async (t) => {
  const requestId = "10000000-0000-4000-8000-000000000002";
  const calls = [];
  const server = createGateway({
    env,
    fetchImpl: async (url, init = {}) => {
      const value = String(url);
      calls.push({ url: value, init });
      if (value.endsWith("/auth/v1/user")) return Response.json({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
      if (value.endsWith("/rest/v1/rpc/designpro_flat_first_handoff_gate")) {
        return Response.json({ flatFirst: false, productionEligible: true, revisionId: null });
      }
      if (value.endsWith("/rest/v1/rpc/regenerate_designpro_generation_slot")) {
        return Response.json({
          requestId, sourceViewType: "close-up", consumerRole: "closeup",
          supersededViews: 1, state: "queued",
        });
      }
      throw new Error(`unexpected ${url}`);
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/api/generation/requests/${requestId}/views/close-up/regenerate`, {
    method: "POST",
    headers: { cookie: "dp_session=test-token", "content-type": "application/json", origin: env.DESIGNPRO_APP_ORIGIN },
    body: JSON.stringify({ instruction: "bolder lettering" }),
  });
  assert.equal(response.status, 202);
  const payload = await response.json();
  assert.equal(payload.sourceViewType, "close-up");
  assert.equal(payload.consumerRole, "closeup");
  assert.equal(payload.supersededViews, 1);
  // The instruction is carried to the server, never turned into a browser prompt.
  const rpcCall = calls.find((item) => item.url.includes("regenerate_designpro_generation_slot"));
  assert.equal(JSON.parse(rpcCall.init.body).p_instruction, "bolder lettering");
});

test("a historical hero3d view is readable history but cannot be regenerated", async (t) => {
  const requestId = "10000000-0000-4000-8000-000000000002";
  const calls = [];
  const server = createGateway({
    env,
    fetchImpl: async (url, init = {}) => {
      const value = String(url);
      calls.push({ url: value, init });
      if (value.endsWith("/auth/v1/user")) return Response.json({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
      throw new Error(`unexpected ${url}`);
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/api/generation/requests/${requestId}/views/hero-3d/regenerate`, {
    method: "POST",
    headers: { cookie: "dp_session=test-token", "content-type": "application/json", origin: env.DESIGNPRO_APP_ORIGIN },
    body: JSON.stringify({ instruction: "repair historical view" }),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "generation_view_not_in_plan" });
  assert.equal(calls.some((item) => item.url.includes("/rest/v1/rpc/")), false);
});

test("a view outside the frozen plan cannot be regenerated", async (t) => {
  const server = createGateway({
    env,
    fetchImpl: async (url) => {
      if (String(url).endsWith("/auth/v1/user")) return Response.json({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
      throw new Error(`unexpected ${url}`);
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/api/generation/requests/10000000-0000-4000-8000-000000000002/views/spoiler/regenerate`, {
    method: "POST",
    headers: { cookie: "dp_session=test-token", "content-type": "application/json", origin: env.DESIGNPRO_APP_ORIGIN },
    body: "{}",
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "generation_view_not_in_plan" });
});

// ---------------------------------------------------------------------------
// THE SIX CALL-1 PANELS, AND WHO MAY READ THEM
// ---------------------------------------------------------------------------

test("the generation atlas publishes the six Call-1 panels with their own geometry", async (t) => {
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const requestId = "10000000-0000-4000-8000-0000000000c1";
  const generationId = "90000000-0000-4000-8000-0000000000c1";
  const row = flatFirstAtlasRpcRow({ userId, requestId, generationId });
  row.ownerId = userId;
  row.callOnePanels = callOnePanelRecords({
    ownerId: userId, generationId, masterHash: row.masterContentHash,
  });
  const server = createGateway({
    env,
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.endsWith("/auth/v1/user")) return Response.json({ id: userId });
      if (value.includes("/rest/v1/designpro_workflow_runs")) return Response.json([]);
      if (value.endsWith("/rest/v1/rpc/designpro_generation_workspace")) {
        return Response.json(generationWorkspaceRpcRow({ requestId, generationId, ownerId: userId }));
      }
      if (value.endsWith("/rest/v1/rpc/designpro_flat_atlas_generation_paths")) {
        return Response.json([row]);
      }
      if (value.includes("/storage/v1/object/sign/wrap-files/")) {
        return Response.json({ signedURL: `/object/sign/wrap-files/o?token=${encodeURIComponent(value.split("wrap-files/")[1])}` });
      }
      throw new Error(`unexpected ${url}`);
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/api/jobs/${generationId}/atlas`, {
    headers: { cookie: "dp_session=test-token" },
  });
  assert.equal(response.status, 200);
  const [revision] = await response.json();
  // The six canonical surfaces, always in the one order, each carrying the
  // geometry an installer cuts to and the hash the file is identified by.
  assert.deepEqual(revision.callOnePanels.map((panel) => panel.surfaceKey), [
    "driver", "passenger", "hood", "roof", "front", "rear",
  ]);
  const driver = revision.callOnePanels[0];
  assert.equal(driver.trimWidthIn, 196.9);
  assert.equal(driver.printWidthIn, 206.9);
  assert.equal(driver.bleedInches, 5);
  assert.equal(driver.surfaceSqFt, 69.6);
  assert.equal(driver.effectivePpi, 17.94);
  assert.equal(driver.sourceMasterHash, revision.master.contentHash);
  assert.equal(typeof driver.signedUrl, "string");
  assert.equal(driver.expiresIn, 300);
  // A private storage path never leaves the gateway, for a panel any more than
  // for the master beside it.
  assert.equal("storagePath" in driver, false);
  assert.equal(JSON.stringify(revision).includes("designpro/user_"), false);
});

test("a Call-1 panel that fails its own arithmetic or lineage is refused, never signed", async (t) => {
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const requestId = "10000000-0000-4000-8000-0000000000c2";
  const generationId = "90000000-0000-4000-8000-0000000000c2";
  const mutations = {
    // Print is trim plus the bleed on both edges. A panel that does not satisfy
    // that is one the installer cannot cut to.
    bleed_arithmetic: (panels) => { panels[0].printWidthIn = panels[0].trimWidthIn + 3; },
    // A panel cut from another master is the exact pairing failure PanelPro
    // exists to catch, so it must not reach a customer's screen either.
    foreign_master: (panels) => { panels[0].sourceMasterHash = "9".repeat(64); },
    // A path outside this revision's own immutable prefix.
    foreign_path: (panels) => { panels[0].storagePath = `designpro/user_${"b".repeat(8)}/x/panels/${panels[0].contentHash}.png`; },
    // Five surfaces is not a panel set.
    short_set: (panels) => { panels.pop(); },
    // One surface twice means another is missing.
    duplicate_surface: (panels) => { panels[1].surfaceKey = "driver"; },
  };
  for (const [label, mutate] of Object.entries(mutations)) {
    const row = flatFirstAtlasRpcRow({ userId, requestId, generationId });
    row.ownerId = userId;
    row.callOnePanels = callOnePanelRecords({
      ownerId: userId, generationId, masterHash: row.masterContentHash,
    });
    mutate(row.callOnePanels);
    let signed = 0;
    const server = createGateway({
      env,
      fetchImpl: async (url) => {
        const value = String(url);
        if (value.endsWith("/auth/v1/user")) return Response.json({ id: userId });
        if (value.includes("/rest/v1/designpro_workflow_runs")) return Response.json([]);
        if (value.endsWith("/rest/v1/rpc/designpro_generation_workspace")) {
          return Response.json(generationWorkspaceRpcRow({ requestId, generationId, ownerId: userId }));
        }
        if (value.endsWith("/rest/v1/rpc/designpro_flat_atlas_generation_paths")) {
          return Response.json([row]);
        }
        if (value.includes("/storage/v1/object/sign/wrap-files/")) {
          signed += 1;
          return Response.json({ signedURL: "/object/sign/wrap-files/o?token=t" });
        }
        throw new Error(`unexpected ${url}`);
      },
    });
    try {
      const base = await listen(server);
      const response = await fetch(`${base}/api/jobs/${generationId}/atlas`, {
        headers: { cookie: "dp_session=test-token" },
      });
      assert.equal(response.status, 502, `${label} was accepted`);
      assert.equal(signed, 0, `${label} was signed before it was checked`);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});

test("design staff read a generation they do not own, on the owner's storage prefix", async (t) => {
  // The paths embed the OWNER's id. Checking them against the caller's would
  // refuse a design-team member every row the server just cleared them for --
  // which is exactly why the studio was empty for anyone but the customer.
  const staffId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const ownerId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const requestId = "10000000-0000-4000-8000-0000000000c3";
  const generationId = "90000000-0000-4000-8000-0000000000c3";
  const row = flatFirstAtlasRpcRow({ userId: ownerId, requestId, generationId });
  row.ownerId = ownerId;
  row.callOnePanels = callOnePanelRecords({
    ownerId, generationId, masterHash: row.masterContentHash,
  });
  const server = createGateway({
    env,
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.endsWith("/auth/v1/user")) return Response.json({ id: staffId });
      if (value.includes("/rest/v1/designpro_workflow_runs")) return Response.json([]);
      if (value.endsWith("/rest/v1/rpc/designpro_flat_atlas_generation_paths")) {
        return Response.json([row]);
      }
      if (value.endsWith("/rest/v1/rpc/designpro_generation_workspace")) {
        return Response.json({
          requestId, generationId, ownerId, state: "outputs_ready",
          brief: "A masculine automotive wrap", designName: "Pro-Tech Automotive",
          vehicle: { year: "2022", make: "Chevy", model: "Traverse", type: "truck" },
          pipelineMode: "flat-first-atlas-v1",
          contractVersion: "designpro.calls-1-7-input.v3",
          viewsSuperseded: false,
          views: [{
            sourceViewType: "side", consumerRole: "driver",
            storagePath: `designpro/user_${ownerId}/${generationId}/calls-1-7/${"7".repeat(64)}.png`,
            contentHash: "7".repeat(64), contentType: "image/png", byteSize: 1200,
            atlasMasterContentHash: row.masterContentHash,
            atlasRevisionId: row.id,
          }],
          createdAt: "2026-08-25T21:12:22Z",
        });
      }
      if (value.includes("/storage/v1/object/sign/wrap-files/")) {
        return Response.json({ signedURL: "/object/sign/wrap-files/o?token=t" });
      }
      throw new Error(`unexpected ${url}`);
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const atlas = await fetch(`${base}/api/jobs/${generationId}/atlas`, {
    headers: { cookie: "dp_session=test-token" },
  });
  assert.equal(atlas.status, 200);
  const [revision] = await atlas.json();
  assert.equal(revision.callOnePanels.length, 6);
  assert.equal(typeof revision.masterUrl, "string");

  const views = await fetch(`${base}/api/jobs/${generationId}/approved-views`, {
    headers: { cookie: "dp_session=test-token" },
  });
  assert.equal(views.status, 200);
  const rows = await views.json();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].surfaceKey, "driver");
  assert.equal(rows[0].atlasBinding.masterContentHash, row.masterContentHash);
});

test("a superseded flat-first view set is withheld and said so, not served", async (t) => {
  // The sibling-surface fence refuses a view set authored under the earlier
  // parent/child shape. RevisionStudio must still open on the master, the six
  // panels and the whole revision record -- so the verdict is reported rather
  // than allowed to take the entire read down with it.
  const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const generationId = "90000000-0000-4000-8000-0000000000c4";
  const server = createGateway({
    env,
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.endsWith("/auth/v1/user")) return Response.json({ id: userId });
      if (value.includes("/rest/v1/designpro_workflow_runs")) return Response.json([]);
      if (value.endsWith("/rest/v1/rpc/designpro_generation_workspace")) {
        return Response.json({
          requestId: "10000000-0000-4000-8000-0000000000c4",
          generationId, ownerId: userId, state: "outputs_ready",
          brief: "A masculine automotive wrap",
          viewsSuperseded: true, views: [],
          createdAt: "2026-08-25T21:12:22Z",
        });
      }
      throw new Error(`unexpected ${url}`);
    },
  });
  t.after(() => server.close());
  const base = await listen(server);
  const response = await fetch(`${base}/api/jobs/${generationId}/approved-views`, {
    headers: { cookie: "dp_session=test-token" },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);
  assert.equal(
    response.headers.get("x-designpro-views-superseded"),
    "flat_first_atlas_new_run_required",
  );
});

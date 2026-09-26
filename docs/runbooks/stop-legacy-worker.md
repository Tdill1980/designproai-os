# Runbook: silence the legacy `designpro-worker` background loops on 137.184.0.4 (owner-run)

**Why:** issue sheet `05-legacy-workers-and-404-healthcheck.md` (2026-09-25 audit). Target outcome: 0 `claim_workflow_stage`, 0 `production_panels` polls, and the claimants refusing to claim, while the HTTP API at `worker.designproai.com` keeps serving `generate-2d-proof` and `panel-artboard-generator`.
**Who:** the owner, or someone with root SSH to the droplet. **Duration:** about 20 min plus a 24 h log check. **Nothing here touches the database.**

## 0. Pre-checks (read-only)
```bash
ssh root@137.184.0.4
docker ps --format 'table {{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
# Expect: designproai-runtime-* / designproai-gateway-* (the real system) AND one "designpro-worker" (legacy).
docker inspect designpro-worker --format '{{.Config.Image}} {{.State.StartedAt}} {{.HostConfig.RestartPolicy.Name}}'
# Env NAMES only, never values:
docker inspect designpro-worker --format '{{range .Config.Env}}{{println .}}{{end}}' | cut -d= -f1 | sort
docker logs --since 30m designpro-worker 2>&1 | grep -E 'DESIGNPRO-WORKFLOW|DESIGNPRO-ENTICE|PANEL' | tail -40
```
Record the image tag. It is your rollback target.

**Stop and escalate** if there is more than one legacy worker container, or if the real runtime containers are unhealthy.

## A. Preferred: redeploy the fixed worker with the poller off (keeps HTTP)
1. Merge the Issue 5 PR (owner approval). A 404 probe now fails closed (`worker/edge-auth-probe.cjs`).
2. Set the poller flag in the env file the container reads. `deploy-worker.yml` uses `--env-file /opt/designproai-os/shared/runtime.env`:
   ```bash
   cp /opt/designproai-os/shared/runtime.env /root/runtime.env.bak.$(date +%Y%m%d%H%M)
   grep -q '^DESIGNPRO_PANEL_POLLER_ENABLED=' /opt/designproai-os/shared/runtime.env \
     && sed -i 's/^DESIGNPRO_PANEL_POLLER_ENABLED=.*/DESIGNPRO_PANEL_POLLER_ENABLED=false/' /opt/designproai-os/shared/runtime.env \
     || echo 'DESIGNPRO_PANEL_POLLER_ENABLED=false' >> /opt/designproai-os/shared/runtime.env
   ```
   ⚠ The runtime containers read the same file. The runtime has no reference to this variable (`rg DESIGNPRO_PANEL_POLLER_ENABLED runtime/` returns nothing), so it is safe for them.
3. Run the GitHub workflow **"Deploy the DesignPro worker to the droplet"** (`deploy-worker.yml`) on the merged `main` SHA. It rebuilds `designpro-worker` and health-checks `https://worker.designproai.com/health`.
4. Confirm the loops are off:
   ```bash
   docker logs --since 10m designpro-worker 2>&1 | grep -E 'refusing to claim|poller disabled'
   # Expect: "[DESIGNPRO-WORKFLOW] refusing to claim: run-production-flow is not deployed (HTTP 404)…"
   #         "[WORKER] legacy production_panels poller disabled; …"
   curl -fsS https://worker.designproai.com/health | head -c 300; echo
   ```

## B. Quick interim (no code merge): turn off only the poller
Do step A.2, then `docker restart designpro-worker`. This removes the 17k/day `production_panels` polls immediately. The claimants keep probing and claiming until step A lands.

## C. Optional, only if the owner retires the HTTP users
Only after confirming nobody uses `generate-2d-proof` or `panel-artboard-generator` (0 calls in `function_edge_logs` for 7 days):
```bash
docker update --restart=no designpro-worker
docker stop designpro-worker          # rollback: docker start designpro-worker
# after 7 quiet days: docker rm designpro-worker
```
Also disable `.github/workflows/deploy-worker.yml` so the container isn't recreated.

## Verify (the next day, via Supabase logs or ask an agent to run these read-only)
- `function_edge_logs`: `POST run-production-flow` from 137.184.0.4. After A: about 48/day (a 404 is now re-probed hourly, and the claimants do not claim). After C: 0.
- `edge_logs`: `rpc/claim_workflow_stage` from 137.184.0.4 = **0** (was 34,371/24 h on 9/25).
- `edge_logs`: `GET /rest/v1/production_panels` = **0** (was 17,114/24 h).
- `claim_designpro_generation_request_v2`, `claim_designpro_stage` and `claim_designpro_atlas_call1_node` unchanged. These come from the real runtime.

## Rollback
- A: re-run `deploy-worker.yml` on the previous SHA, or `docker run` the recorded previous image tag with the same flags. Restore `runtime.env` from the `.bak` copy.
- B: remove the flag line and `docker restart designpro-worker`.
- C: `docker start designpro-worker`.

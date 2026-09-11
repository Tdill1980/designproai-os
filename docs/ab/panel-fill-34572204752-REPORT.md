# Test 16 — masked generative fill on the flat panel (generation 5d727ea9, master 2165a36c7f52)

Model `gemini-3-pro-image`, edit turn (subject + gate mask + master reference), 4K, no aspect (an edit follows its input). Mask dilated 24px, feathered 10px at composite. The model's pixels are taken ONLY inside the mask; drift is the model's raw output measured against the original outside the mask (mean abs RGB, 0-255).

| surface | candidate | deterministic gate | colour-blind non-artwork | model drift outside / change inside mask | time |
|---|---|---|---|---|---|
| driver | original | REFUSE · 3 cut-out · largest 0.08016 | 11.47% | | |
| driver | deterministic fill | pass · 0 cut-out · largest 0 | 11.18% | | |
| driver | masked AI fill 1 | pass · 0 cut-out · largest 0 | 3.39% | out 10.74 / in 88.88 | 42.3s |
| driver | masked AI fill 2 | pass · 0 cut-out · largest 0 | 3.39% | out 10.55 / in 85.59 | 38.9s |
| passenger | original | REFUSE · 3 cut-out · largest 0.07734 | 8.05% | | |
| passenger | deterministic fill | pass · 0 cut-out · largest 0 | 7.96% | | |
| passenger | masked AI fill 1 | pass · 0 cut-out · largest 0 | 0.00% | out 14.05 / in 89.66 | 40.6s |
| passenger | masked AI fill 2 | pass · 0 cut-out · largest 0.01211 | 1.23% | out 64.31 / in 95.96 | 43.8s |

Files per surface: `-0-original`, `-1-mask`, `-1-mask-overlay`, `-2-deterministic-fill`, `-3-ai-raw-N` (the model's whole output), `-4-composite-N` (what the pipeline would keep).

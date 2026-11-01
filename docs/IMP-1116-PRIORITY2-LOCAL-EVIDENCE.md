# IMP-1116 Priority 2 / IMP-710 — converter candidate evidence

Date: 2026-10-02. Status: LOCAL PASS; DEV rollout and DEV proof pending.

This document records converter-owned implementation and controlled synthetic
tests. It does not replace the FE real Briefcase assembly, Confié HTML, protected
photo access, or browser/PDF/paper acceptance receipt. Priority 1 membership
delivery remains separate and already deployed at backend revision e150c877.

## Result and contract

- Retain Puppeteer 25.12.0 / Chrome 154.0.8037.57 and the existing PDF engine.
- Each render owns an isolated browser context. Completion, errors, render
  deadline and client disconnect close that context. A wedged cleanup recycles
  the owned Chromium process after a bounded 3-second cleanup wait; subsequent
  work launches a fresh browser. One cached launch prevents simultaneous cold
  starts from launching duplicate browsers.
- Before PDF output, wait for requested fonts and all HTML img elements to
  decode. Broken requested images/fonts return 422. This does not validate CSS
  background images, semantic correctness or real protected photo credentials.
- Render deadline defaults to 60,000 ms; navigation/Puppeteer defaults remain
  at most 30,000 ms. PDF timeout zero is rejected (400), and a caller's timeout
  cannot exceed the server render deadline. Disconnect cancels active work.
- Based on local measurements, provisional admission defaults are one active
  render and two queued requests, shared by PDF and screenshot routes. The
  gate precedes body parsing. Queue overflow returns 503 with Retry-After: 1;
  queue wait is bounded at 60,000 ms and expiry returns 504. Disconnected queued
  requests never start rendering. Health and diagnostics bypass the gate.
- These limits are conservative candidate defaults, not a demonstrated safe
  maximum for DEV or a promise that 1,000 members fit in memory. A backend
  caller's finite total deadline can expire before queue plus render time.
- Authenticated GET /1/resources exposes Node RSS, the owned Chromium process
  tree RSS/PSS, own cgroup usage/kernel peak/limit/headroom when readable,
  measured peaks, admission counters and source revision. Existing converter
  bearer authentication is required. Missing values stay null/absent. Public
  health remains small and reveals no process measurements.
- EXPORT_HTML_MAX_DURATION_MS, EXPORT_HTML_MAX_CONCURRENT,
  EXPORT_HTML_MAX_QUEUED and EXPORT_HTML_QUEUE_WAIT_MS configure the above.
  Invalid integer values fail startup rather than silently disabling bounds.
- A published image carries EXPORT_HTML_SOURCE_REVISION and responds with
  X-Converter-Revision when that value is a full source SHA. The publish workflow
  checks out its exact GITHUB_SHA and passes it into the image build.

## Reproduction and evidence

The isolated Linux Docker test used 51 unique synthetic JPEG images, each
1280 x 960, served by a separate fixture container on a private test network.
No customer data or actual FE document was used. Images were URLs so the
existing request body limit did not need to increase. The PDF was inspected
with PDF.js, not merely checked for HTTP 200 or its file signature.

| Check | Result |
| --- | --- |
| Unit tests: lifecycle, launch races, late context/page cleanup, queue, metrics, auth | PASS 23/23 |
| ESLint src/test | PASS |
| Production Docker build, with no source bind mount | PASS |
| Existing PDF, every-page numbering, PNG screenshot, auth/validation, three simultaneous requests | PASS |
| Photo PDF | PASS: 4 pages, all 51 unique row identities exactly once, 51 raster operators, marker on each page |
| Two repeat requests | PASS: 687 ms and 600 ms |
| Three requested concurrently, admitted sequentially | PASS: 600 ms, 1,223 ms, 2,014 ms |
| First photo render | PASS: 944 ms, 1,292,737 PDF bytes |
| Broken image / broken requested font | PASS: 422 / 422 |
| Caller disabled timeout | PASS: 400 |
| Active cancellation | PASS: baseline page count restored in 416 ms including 300 ms before client abort |
| Queue cancellation, overflow and remaining work | PASS: 503 + Retry-After 1; final active 0 / queued 0 |
| Separate controlled deadline test | PASS: configured 500 ms, HTTP 504 in 594 ms, final page count 1 |

The deadline receipt was collected on the source-mounted candidate before final
packaging, and is not represented as final-package or deployed DEV evidence.
Final-package resource and admission receipts are in the accompanying JSON files.

## Resource interpretation

Final packaged test image configuration ID:
sha256:04d3d4913c7487604616a139304524ae41b5abdcc13013c9a12282038523713e.
Local manifest: sha256:d5fcef61ba4b64e01bd85d8bac1fdbdda2c80337f8b563077e217c5711e1d0b1.
These identify a LOCAL artifact; neither is claimed as a published GHCR digest.
Source was an uncommitted candidate at build time, so sourceRevision correctly
returned null. The five production files' SHA256 hashes were compared between
the packaged container and the worktree and matched exactly.

| Final packaged workload measurement | Bytes |
| --- | ---: |
| cgroup kernel lifetime peak | 582,541,312 |
| sampled cgroup current peak | 576,851,968 |
| Chromium process-tree sampled PSS peak | 546,512,896 |
| Chromium process-tree sampled RSS peak | 1,319,784,448 |
| Node sampled RSS peak | 150,999,040 |
| cgroup current after cleanup | 245,878,784 |
| Chromium PSS after cleanup | 196,911,104 |

Process measurements are sampled at 100 ms and may miss instantaneous peaks.
The cgroup kernel value is a container-lifetime high-water mark. RSS sums shared
pages and must not be equated to charged container memory or added to PSS/cgroup
usage. PSS apportions shared pages. Exit races produce incomplete process samples
and are counted explicitly (8 incomplete samples in the final receipt).

Earlier controlled local stages showed retained context memory: before isolated
contexts, 938,921,984 bytes remained after work; after context isolation with
three active renders, 238,936,064 remained but peak reached 1,098,027,008 bytes.
With one active render the corresponding peak was 532,598,784 bytes. These are
different candidate stages and independent runs, not an exact matched benchmark
or a deployment capacity certification. They justify isolation and a bounded
admission candidate rather than increasing limits without DEV measurements.

The local cgroup limit was unlimited. Its roughly 24 GB host RAM and free RAM
are local Docker-host measurements, not Azure capacity. Read-only Azure inspection
found the DEV converter on a Basic B1 plan shared by six web apps; actual readable
DEV cgroup limit/headroom and backend health under load still require deployment.

## Deployment gate and closure

DEV converter inspected before rollout remains pinned to:
ghcr.io/svidify-sarl/export-html@sha256:7efca52ecfc60e707e922ce416767655237b0232a6d97ea6badee68cb6ec6cac.
Target: be-dev-html-pdf in be-dev-rosurce-group. No image/settings mutation,
GHCR publication or manual pipeline run was performed for this candidate.

After explicit publication/DEV rollout approval:

1. Publish the exact reviewed converter source commit with its source SHA;
   record the resulting immutable registry digest and workflow run.
2. Pin this DEV app to that exact digest, retaining the above rollback digest
   and existing bearer credential. Verify health and X-Converter-Revision.
3. Read authenticated resources before/during/after the controlled 51-photo
   multipage run, repeats, active/queued cancellation and small concurrency;
   collect exact peaks, limit scope, latencies and backend health observations.
4. Reconfirm Priority 1 deployed membership evidence remains valid; record the
   backend cancellation-client revision deployed by automatic backend CI.
5. If metrics are unavailable, report UNKNOWN with scope; diagnose the deployed
   container without inferring a safe memory budget from the member guard.
6. FE supplies actual Confié HTML and representative authorized image URLs for
   real image-access integration and coordinated multipage acceptance.

Until step 3 passes, Priority 2 BE/converter is OPEN. Even after BE evidence is
complete, original-ticket closure requires the separately owned FE receipt.

# IMP-710 manual deployment and rollback

## Scope

This release upgrades the converter from Puppeteer 22.7.0 / Chrome 124 to
Puppeteer 25.12.0 / Chrome 154. It also requires a bearer token for `/1/pdf`
and `/1/screenshot`. Health endpoints remain unauthenticated.

There is intentionally no automatic deployment. The existing DEV App Service
must remain on its current image until the candidate image and backend token
support have passed all local checks and the DEV change is explicitly approved.

## Immutable inputs

- Base image:
  `ghcr.io/puppeteer/puppeteer:25.12.0@sha256:60ad89b1d8ca14877120250b9c96694dd19a4eda5890fdbad64f4740c6a27361`
- Current DEV rollback image:
  `bedrockio/export-html@sha256:316b1547538df2b6451b77626b345273972274bfe78058e1e82d335d2f1c1d70`
- Current DEV App Service: `be-dev-html-pdf`
- Resource group: `be-dev-rosurce-group`

Record the candidate image digest produced by the approved registry build. Do
not deploy a mutable `latest` tag.

## Required configuration

Generate one strong random token through the approved secret-management path.
Never commit or print it.

- Converter App Service setting: `EXPORT_HTML_BEARER_TOKEN`
- BusinessExplorer App Service setting: `PdfGenerator__BearerToken`

The backend change is backward compatible: when the setting is absent it sends
no Authorization header, and when present it sends `Authorization: Bearer ...`.
This permits the backend token support to be deployed before the converter is
switched, because the current converter ignores the extra request header.

## Pre-deployment checks

Run locally against the candidate container:

```text
yarn lint
yarn test
EXPORT_HTML_BEARER_TOKEN=<temporary-test-token> \
EXPORT_HTML_TEST_URL=http://127.0.0.1:2306 \
yarn test:integration
```

The integration test must prove:

- health endpoints return 200 without credentials;
- conversion endpoints return 401 without valid credentials;
- invalid conversion input returns 400;
- PDF and PNG responses are valid binary files;
- a three-page CSS margin-counter PDF contains `1 / 3`, `2 / 3`, `3 / 3`;
- five concurrent PDF requests succeed.

Run the focused BusinessExplorer tests for `HttpServicesRegistrationTests`.

## Manual DEV sequence

Each change below is a separate, explicitly approved manual action.

1. Deploy the tested BusinessExplorer commit containing optional bearer-token
   support.
2. Store the shared token in BusinessExplorer as `PdfGenerator__BearerToken`.
3. Verify the current Chrome 124 converter still generates a PDF when the
   backend sends the additional header.
4. Store the same token in `be-dev-html-pdf` as
   `EXPORT_HTML_BEARER_TOKEN`.
5. Change `be-dev-html-pdf` to the exact approved candidate image digest.
6. Set the health check path to `/check-status` and wait for healthy status.
7. Verify unauthenticated `/1/pdf` returns 401 and authenticated backend PDF
   generation returns 200.
8. Download a real three-page Confié PDF and verify page markers and Chrome
   metadata.
9. Run invoice and representative PDF/screenshot smoke checks.

The bearer requirement removes anonymous conversion access even if the health
host remains internet-reachable. A future private endpoint or VNet/NAT design
can additionally remove public network reachability. Direct IP allowlisting is
not used here because the current backend has no VNet integration or stable NAT
egress and can use a large set of possible outbound addresses.

## Rollback

If the converter switch fails:

1. Restore the exact rollback image digest listed above.
2. Keep the backend bearer-token setting; the old converter tolerates the
   additional header.
3. Confirm the health endpoint and one backend PDF request.
4. Capture the failed candidate digest and failure evidence before retrying.

Rollback restores the previous converter behavior, including the known lack of
CSS page-margin counters. It does not close IMP-710.

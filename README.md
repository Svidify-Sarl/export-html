# Export HTML to PDF Service

This is a simple Docker container that runs a JSON API service that allows HTML to be converted to PDF or PNG/JPG images. This service accomplishes this by using a [Chrome headless browser](https://github.com/GoogleChrome/puppeteer) to ensure full rendering capabilities on par with Google Chrome.

_Security Note: This is intended to run as a micro service - do not directly expose to the public internet_

Conversion endpoints require an `Authorization: Bearer <token>` header. Set the
token with the `EXPORT_HTML_BEARER_TOKEN` environment variable. Tokens must be
at least 32 bytes. The `/` and
`/check-status` health endpoints do not require credentials.

## Usage

```bash
docker run -e "EXPORT_HTML_BEARER_TOKEN=replace-me" -p 2305:2305 <image>
```

Or:

```
git clone git@github.com:Svidify-Sarl/export-html.git
cd export-html
yarn install
yarn start
```

## Generating a PDF

```bash
curl \
-d '{"html": "<h1>Hello World</h1>"}' \
-H "Content-Type: application/json" \
-H "Authorization: Bearer <token>" \
--output hello.pdf \
-XPOST "http://localhost:2305/1/pdf"
```

Now open `hello.pdf`

The default format is "Letter" (US) but it can be set to other paper formats like so:

```bash
curl \
-d '{"html": "<h1>Hello World</h1>", "export": {"format": "A4"}}' \
-H "Content-Type: application/json" \
-H "Authorization: Bearer <token>" \
--output hello-a4.pdf \
-XPOST "http://localhost:2305/1/pdf"
```

## Generating a PNG

```bash
curl \
-d '{"html": "<h1>Hello World</h1>", "export": {"type": "png"}}' \
-H "Content-Type: application/json" \
-H "Authorization: Bearer <token>" \
--output hello.png \
-XPOST "http://localhost:2305/1/screenshot"
```

Now open `hello.png`

## Advanced Options

Each API call allows Puppeteer options via `body.export`

- [POST /1/pdf](https://pptr.dev/api/puppeteer.pdfoptions)
- [POST /1/screenshot](https://pptr.dev/api/puppeteer.screenshotoptions)

## Validation

Run unit checks with `yarn test` and `yarn lint`. For container integration
checks, start the image on port 2306 and run:

```bash
EXPORT_HTML_BEARER_TOKEN=<token> \
EXPORT_HTML_TEST_URL=http://127.0.0.1:2306 \
yarn test:integration
```

The integration check verifies authentication, request validation, PDF binary
output, CSS page-margin counters, screenshot output, and concurrent requests.

## Kubernetes Deployment Notes

This module runs a full browser and each request will open a virtual broeser tab. Many concurrent requests can increase memory usage signicantly.

Here's an example of a Kubernetes deployment that limits resources (this is used in production for generating invoices):

```
apiVersion: apps/v1
kind: Deployment
metadata:
  name: export-html-deployment
spec:
  replicas: 3
  selector:
    matchLabels:
      name: export-html
  template:
    metadata:
      labels:
        name: export-html
    spec:
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              podAffinityTerm:
                labelSelector:
                  matchExpressions:
                    - key: name
                      operator: In
                      values:
                        - export-html
                topologyKey: kubernetes.io/hostname
      containers:
        - image: <immutable-image-digest>
          imagePullPolicy: Always
          name: export-html
          resources:
            requests:
              memory: "1000Mi"
              cpu: "500m"
            limits:
              memory: "3000Mi"
              cpu: "2500m"
          env:
            - name: EXPORT_HTML_BEARER_TOKEN
              valueFrom:
                secretKeyRef:
                  name: export-html
                  key: bearer-token
          ports:
            - name: http-server
              containerPort: 2305
          volumeMounts:
            - name: export-html-cache
              mountPath: /workdir/data
      volumes:
        - name: export-html-cache
          emptyDir: {}
```

## Credits

This service is based on the excellent [Puppeteer module](https://github.com/GoogleChrome/puppeteer)

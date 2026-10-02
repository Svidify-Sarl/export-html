// Dedicated local Docker fixture; never mounted into the production service.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const images = JSON.parse(await readFile("/images.json", "utf8")).map(image => Buffer.from(image, "base64"));
createServer((request, response) => {
  const match = /^\/images\/(\d+)\.jpg$/.exec(request.url);
  const image = match && images[Number(match[1])];
  if (!image) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { "content-type": "image/jpeg", "content-length": image.length });
  response.end(image);
}).listen(2310, "0.0.0.0");

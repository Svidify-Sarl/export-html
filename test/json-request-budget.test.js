const assert = require("node:assert/strict");
const test = require("node:test");
const http = require("node:http");
const Koa = require("koa");
const bodyParser = require("koa-body").default;
const { jsonRequestBudgetBytes, maximumJsonRequestBytes } = require("../src/utils/json-request-budget");
const { createBearerAuth } = require("../src/utils/middleware/bearer-auth");
const errorHandler = require("../src/utils/middleware/error-handler");
const token = "synthetic-parser-contract-test-token-20261101";

test("default matches the published BE filter ceiling; overrides remain finite and fail closed", () => {
  assert.equal(jsonRequestBudgetBytes(), 104857600);
  assert.equal(jsonRequestBudgetBytes(""), maximumJsonRequestBytes);
  assert.equal(jsonRequestBudgetBytes("4194304"), 4194304);
  for (const v of ["0", "-1", "Infinity", "NaN", "1.5", "1e6", " ", "unlimited", String(maximumJsonRequestBytes+1)])
    assert.throws(() => jsonRequestBudgetBytes(v), /EXPORT_HTML_JSON_MAX_BYTES/);
});

async function withServer(limit, run) {
  const app = new Koa(); let downstream = 0;
  app.use(errorHandler).use(createBearerAuth(token))
    .use(bodyParser({ multipart:true, jsonLimit:jsonRequestBudgetBytes(limit) }))
    .use(ctx=>{downstream++;ctx.body={bytes:Buffer.byteLength(ctx.request.body.html)};});
  app.on("error",()=>{});
  const server = app.listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  try { await run(server.address().port,()=>downstream); }
  finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
}

function send(port, bytes, {chunked=false, authorized=true}={}) {
  const empty=JSON.stringify({html:""});
  const body=JSON.stringify({html:"x".repeat(bytes-Buffer.byteLength(empty))});
  return new Promise((resolve,reject)=>{
    const headers={"Content-Type":"application/json"};
    if(!chunked) headers["Content-Length"]=Buffer.byteLength(body);
    if(authorized) headers.Authorization="Bearer "+token;
    const req=http.request({host:"127.0.0.1",port,path:"/1/pdf",method:"POST",headers}, res=>{
      res.resume();res.on("end",()=>resolve(res.statusCode));
    });req.on("error",reject);
    if(chunked){for(let i=0;i<body.length;i+=65536) req.write(body.slice(i,i+65536));req.end();}
    else req.end(body);
  });
}

test("the reported 2,834,931-byte document is parsed unchanged instead of an unrelated1MiB refusal", async()=>{
  await withServer(undefined,async(port,calls)=>{
    assert.equal(await send(port,2834931),200);
    assert.equal(calls(),1);
  });
});

test("exact configured boundary is accepted; known-length and chunked overflow never reach conversion",async()=>{
  const limit=3*1024*1024;
  await withServer(String(limit),async(port,calls)=>{
    assert.equal(await send(port,limit),200);
    assert.equal(await send(port,limit+1),413);
    assert.equal(await send(port,limit+1,{chunked:true}),413);
    assert.equal(calls(),1);
  });
});

test("authentication still precedes reading or parsing a large document",async()=>{
  await withServer("1048576",async(port,calls)=>{
    assert.equal(await send(port,2834931,{authorized:false}),401);
    assert.equal(calls(),0);
  });
});

# OpenTelemetry

Exports the SDK's traces and metrics, so a slow classification can be
attributed to a specific stage rather than guessed at.

The SDK depends only on `@opentelemetry/api`, which does nothing until a
provider is registered. **If your application already runs OpenTelemetry, you
need none of this** — the spans and metrics below will appear alongside
everything else you collect. This sample exists for the case where you do not,
or where you want to see the data without wiring up a collector first.

## Running it

```bash
npm install

export ATHENA_ENV_FILE=../../.env          # or export the vars yourself
export ATHENA_IMAGE_DIR=/path/to/images
export ATHENA_DEPLOYMENT_ID=...
export ATHENA_WORKERS=2                    # concurrent callers
export ATHENA_ITEMS=10

npm start
```

With no `OTEL_EXPORTER_OTLP_ENDPOINT` set, spans and metrics print to the
console. Point it at a collector to send them somewhere real:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

`instrumentation.js` is loaded through `node --import` so the provider is
registered before the SDK is imported. Nothing in it is Athena-specific.

## What you get

### Spans

```
Athena.classifySingle                 total, as your code experiences it
├── Athena.prepareImage               decode, resize, hash, compress
│     events: decoded / resized / compressed, each with duration_ms
├── Athena.authenticate               only when a token is actually fetched
└── Athena.rpc classifySingle         the gRPC call on its own
```

`Athena.listDeployments` is also traced, and is useful as a control: it carries
no payload, so its duration is close to a pure round trip.

### The attributes that matter

On `Athena.prepareImage`:

| Attribute | Why it is there |
| --- | --- |
| `athena.image.source_width` / `_height` | Preparation cost scales with these, and they are unrecoverable once the image is resized to 448×448 |
| `athena.image.source_bytes` | What you handed us |
| `athena.request.payload_bytes` | What actually goes on the wire — with `resize: true` this is a fixed 588 KiB of raw BGR, usually far larger than your source file |
| `athena.request.encoding` | `uncompressed` or `brotli` |

On `Athena.rpc classifySingle`:

| Attribute | Why it is there |
| --- | --- |
| `athena.correlation_id` | Joins your trace to our server-side record of the same call |
| `athena.event_loop.max_delay_ms` | The worst event-loop delay this process has seen |

### Metrics

| Instrument | Unit | |
| --- | --- | --- |
| `athena.client.classify_single.duration` | ms | End to end |
| `athena.client.prepare.duration` | ms | Local CPU |
| `athena.client.auth.duration` | ms | Token fetches only |
| `athena.client.rpc.duration` | ms | The wire |
| `athena.client.request.payload_size` | By | Bytes sent |
| `athena.client.event_loop.delay` | ms | Gauge, tagged `mean` / `p50` / `p99` / `max` |

Durations are milliseconds rather than the seconds OpenTelemetry usually
prefers, so they line up with the server-side numbers we would quote you.

## Reading the result

Subtract as you go down the tree. `classifySingle` minus `prepareImage` minus
`authenticate` should leave roughly `rpc`; if it does not, the missing time is
your own event loop between the awaits.

Then compare `athena.client.rpc.duration` against the duration we report for
the same `correlation_id`. The difference is network transfer **plus any time
this process was too busy to read the response** — those two are not
distinguishable from inside the call, which is what
`athena.event_loop.max_delay_ms` is for.

That distinction matters more than it sounds. A synchronous CPU block anywhere
in the process, in code that has nothing to do with Athena, inflates the
measured duration of every call that is in flight at the time: the reply has
arrived and is sitting in the socket, but nothing can read it until the loop is
free. The call looks slow and the server looks slow, and neither is true. If
`athena.event_loop.max_delay_ms` is large, that is what is happening, and no
amount of tuning on our side will move it.

## Event-loop monitoring

On by default. It costs a single timer, measured on Node's timer thread so it
keeps working while JavaScript is blocked, and it does not keep the process
alive. To opt out:

```js
new ClassifierSdk({ monitorEventLoop: false, ... });
```

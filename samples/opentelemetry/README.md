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
cd ../..
npm install
npm run build

cd samples/opentelemetry
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
| `athena.event_loop.busy_ms` | How long this process's event loop was occupied during this call |
| `athena.event_loop.utilization` | The same, as a fraction (0–1) of the call's duration |

Both are measured per call, from a snapshot taken when the RPC starts, so
concurrent calls each get their own window and cannot disturb one another.

### Metrics

| Instrument | Unit | |
| --- | --- | --- |
| `athena.client.classify_single.duration` | ms | End to end |
| `athena.client.prepare.duration` | ms | Local CPU |
| `athena.client.auth.duration` | ms | Token fetches only |
| `athena.client.rpc.duration` | ms | The wire |
| `athena.client.request.payload_size` | By | Bytes sent |
| `athena.client.rpc.event_loop_utilization` | 1 | Per-RPC utilization, for aggregating without traces |
| `athena.client.event_loop.delay` | ms | Opt-in gauge, tagged `mean` / `p50` / `p99` / `max`, covering the interval since the previous collection |

Durations are milliseconds rather than the seconds OpenTelemetry usually
prefers, so they line up with the server-side numbers we would quote you.

## Reading the result

Subtract as you go down the tree. `classifySingle` minus `prepareImage` minus
`authenticate` should leave roughly `rpc`; if it does not, the missing time is
your own event loop between the awaits.

Then look at `athena.event_loop.busy_ms` on the RPC span. On a healthy call it
is a few milliseconds: the process spends the call idle, waiting on the
network. Subtract it from the RPC duration, and compare what is left against
the duration we report for the same `correlation_id`. The remainder is network
transfer and our service; `busy_ms` is time the reply could have been sitting
in the socket unread.

That distinction matters more than it sounds. A synchronous CPU block anywhere
in the process, in code that has nothing to do with Athena, inflates the
measured duration of every call that is in flight at the time: the reply has
arrived and is sitting in the socket, but nothing can read it until the loop is
free. The call looks slow and the server looks slow, and neither is true.

For reference, this is what the three cases look like against live, two
workers, 1024×768 images:

| | RPC duration | `busy_ms` | `utilization` |
| --- | --- | --- | --- |
| Healthy | 280–800 ms | 3–55 | 0.01–0.09 |
| A 1500 ms synchronous stall **during** the calls | ~1735 ms | ~1510 | ~0.87 |
| The same stall immediately **before** each call | ~270 ms | 3 | ~0.01 |

The middle row is the one to recognise. The RPC took 1735 ms, but 1510 ms of
that was this process being busy; the network and the service accounted for
the remaining ~225 ms. If your spans look like that, no amount of tuning on our
side will move it. The last row shows the measurement does not blame a call for
a stall that finished before the call began.

## Event-loop monitoring

`busy_ms` and `utilization` are always recorded. They read two counters that
libuv already maintains, start no timer, and cost nothing measurable.

The `athena.client.event_loop.delay` gauge is opt-in, because it samples on a
timer. It adds a process-wide view of individual stalls between collections,
which a per-call average can understate when a short stall lands inside a long
call. This sample switches it on; in your own application:

```js
new ClassifierSdk({ monitorEventLoop: true, ... });
```

Its statistics cover the interval since the previous metric collection, not
the life of the process. If you register more than one metric reader, each
collection resets the underlying histogram, so the readers will share the
interval between them.

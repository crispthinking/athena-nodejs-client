/**
 * Cold-connection transport probe.
 *
 * Opens a throwaway TLS connection per sample and splits the setup cost into
 * DNS, TCP and TLS. This is the part of a client-observed call that our
 * server-side `athena.classify_single.duration` histogram cannot see: that
 * timer starts once the gRPC handler is entered, so everything measured here
 * is invisible from the service side.
 */

import tls from 'tls';
import { performance } from 'perf_hooks';

export interface ConnectSample {
  dnsMs: number;
  tcpMs: number;
  tlsMs: number;
  totalMs: number;
}

export interface TransportDetails {
  alpnProtocol: string | false | null;
  tlsProtocol: string | null;
  cipher: string | undefined;
  peer: string | undefined;
}

export interface TransportResult {
  samples: ConnectSample[];
  details: TransportDetails | undefined;
  failures: string[];
}

/**
 * Opens one TLS connection and times each stage of the handshake.
 *
 * @param host Hostname to connect to.
 * @param port TCP port.
 * @param timeoutMs Abort the probe after this long.
 */
function probeOnce(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<{ sample: ConnectSample; details: TransportDetails }> {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    let lookupAt: number | undefined;
    let connectAt: number | undefined;
    let settled = false;

    // ALPN h2 is requested explicitly: gRPC runs over HTTP/2, and negotiating
    // it here means the probe exercises the same listener path the SDK will.
    const socket = tls.connect({
      host,
      port,
      servername: host,
      ALPNProtocols: ['h2'],
    });

    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      if (error) {
        reject(error);
      }
    };

    socket.setTimeout(timeoutMs, () => {
      finish(new Error(`timed out after ${timeoutMs} ms`));
    });

    socket.once('lookup', () => {
      lookupAt = performance.now();
    });

    socket.once('connect', () => {
      connectAt = performance.now();
    });

    socket.once('secureConnect', () => {
      if (settled) {
        return;
      }
      const secureAt = performance.now();
      // A cached OS-level resolution makes 'lookup' fire ~instantly; treat a
      // missing event as zero DNS cost rather than folding it into TCP.
      const dnsEnd = lookupAt ?? start;
      const tcpEnd = connectAt ?? dnsEnd;

      const sample: ConnectSample = {
        dnsMs: dnsEnd - start,
        tcpMs: tcpEnd - dnsEnd,
        tlsMs: secureAt - tcpEnd,
        totalMs: secureAt - start,
      };

      const details: TransportDetails = {
        alpnProtocol: socket.alpnProtocol,
        tlsProtocol: socket.getProtocol(),
        cipher: socket.getCipher()?.name,
        peer: socket.remoteAddress,
      };

      settled = true;
      socket.destroy();
      resolve({ sample, details });
    });

    socket.once('error', (error: Error) => {
      finish(error);
    });
  });
}

/**
 * Runs the cold-connect probe `samples` times, sequentially.
 *
 * Sequential on purpose: running them in parallel would measure contention
 * between the probes rather than the handshake itself.
 */
export async function probeTransport(
  host: string,
  port: number,
  samples: number,
  timeoutMs: number,
): Promise<TransportResult> {
  const collected: ConnectSample[] = [];
  const failures: string[] = [];
  let details: TransportDetails | undefined;

  for (let i = 0; i < samples; i++) {
    try {
      const result = await probeOnce(host, port, timeoutMs);
      collected.push(result.sample);
      details ??= result.details;
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  return { samples: collected, details, failures };
}

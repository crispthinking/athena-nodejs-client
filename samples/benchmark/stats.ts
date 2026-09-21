/**
 * Summary statistics for a set of latency samples.
 */
export interface Summary {
  count: number;
  min: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

/**
 * Nearest-rank percentile over an already-sorted ascending array.
 */
function percentileOfSorted(sorted: number[], percentile: number): number {
  if (sorted.length === 0) {
    return Number.NaN;
  }
  const rank = Math.ceil((percentile / 100) * sorted.length);
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[index] as number;
}

/**
 * Summarises latency samples. Returns a zero-count summary for an empty set
 * rather than throwing, so a phase that produced no successful calls still
 * reports cleanly alongside its error counts.
 */
export function summarise(samples: number[]): Summary {
  if (samples.length === 0) {
    return {
      count: 0,
      min: Number.NaN,
      p50: Number.NaN,
      p90: Number.NaN,
      p95: Number.NaN,
      p99: Number.NaN,
      max: Number.NaN,
      mean: Number.NaN,
    };
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const total = sorted.reduce((acc, value) => acc + value, 0);

  return {
    count: sorted.length,
    min: sorted[0] as number,
    p50: percentileOfSorted(sorted, 50),
    p90: percentileOfSorted(sorted, 90),
    p95: percentileOfSorted(sorted, 95),
    p99: percentileOfSorted(sorted, 99),
    max: sorted[sorted.length - 1] as number,
    mean: total / sorted.length,
  };
}

/** Formats a millisecond value for the console report. */
export function ms(value: number): string {
  if (Number.isNaN(value)) {
    return '—';
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)} s`;
  }
  return `${value.toFixed(1)} ms`;
}

/** Formats a byte count for the console report. */
export function bytes(value: number): string {
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(2)} MiB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KiB`;
  }
  return `${value} B`;
}

/**
 * Renders a summary as an aligned console row.
 */
export function summaryRow(label: string, summary: Summary): string {
  const cells = [
    label.padEnd(26),
    ms(summary.p50).padStart(10),
    ms(summary.p90).padStart(10),
    ms(summary.p95).padStart(10),
    ms(summary.p99).padStart(10),
    ms(summary.max).padStart(10),
    String(summary.count).padStart(7),
  ];
  return cells.join(' ');
}

/** Header matching {@link summaryRow}. */
export function summaryHeader(): string {
  return [
    'phase'.padEnd(26),
    'p50'.padStart(10),
    'p90'.padStart(10),
    'p95'.padStart(10),
    'p99'.padStart(10),
    'max'.padStart(10),
    'n'.padStart(7),
  ].join(' ');
}

/**
 * Runs `total` tasks with at most `concurrency` in flight at once.
 *
 * Results are returned in completion order, which is fine for latency
 * aggregation and avoids holding a sparse array for long runs.
 */
export async function runPool<T>(
  total: number,
  concurrency: number,
  task: (index: number) => Promise<T>,
): Promise<T[]> {
  const results: T[] = [];
  let next = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(total, 1)) },
    async () => {
      for (;;) {
        const index = next++;
        if (index >= total) {
          return;
        }
        results.push(await task(index));
      }
    },
  );

  await Promise.all(workers);
  return results;
}

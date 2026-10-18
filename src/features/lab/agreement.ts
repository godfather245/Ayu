import type { Measurement } from '../../data/schema';

// Agreement screen data (screen itself is built in the Pulse phase). Demo records never reach it:
// seeded values are illustrative and must not appear as paired results.

export function agreementRecords(measurements: Measurement[]): Measurement[] {
  return measurements.filter((m) => m.demo !== true && m.experimental);
}

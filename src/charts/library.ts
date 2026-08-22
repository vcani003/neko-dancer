/**
 * Charts this build ships with.
 *
 * Validated at module load rather than at play time: a malformed shipped chart
 * is a build problem, and finding out when the song starts is far too late.
 */
import tutorial from './fixtures/click-128-tutorial.json';
import { parseChart } from './validator.ts';
import type { Chart } from './schema.ts';

export const TUTORIAL_CHART: Chart = parseChart(tutorial);
export const BUILT_IN_CHARTS: readonly Chart[] = [TUTORIAL_CHART];

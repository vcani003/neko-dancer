/**
 * The single-player run. Phase 4.
 *
 * Lives next to playback, not in Game Core: it is allowed to hold an adapter
 * and a catalog. The engine still only ever sees a number.
 */
export type { Catalog } from './Catalog.ts';
export { PlaySession } from './PlaySession.ts';
export type { PlayPhase } from './PlaySession.ts';
export { mediaSourceOf } from './media.ts';
export { HttpCatalog, browserSend } from './HttpCatalog.ts';
export type { HttpSend, HttpResponse, RoomListing, CreatedChart, CreateChartInput } from './HttpCatalog.ts';
export { DANCE_HOLD_MS, DANCE_SHEET_ORDER, danceFrameIndex } from './dancer.ts';
export type { DancePose, DancerKind } from './dancer.ts';

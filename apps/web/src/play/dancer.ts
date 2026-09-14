/**
 * Re-export of the sheet contract. The figure itself lives on the stage
 * in `LaneRenderer` / `SpriteDancer`.
 */
export {
  DANCE_SHEET_ORDER,
  danceFrameIndex,
  dancePoseOf,
} from '../../../../src/render/SpriteDancer.ts';
export type { DancePose, DancerKind } from '../../../../src/render/SpriteDancer.ts';
export { POSE_HOLD_MS as DANCE_HOLD_MS } from '../../../../src/render/CatPose.ts';

/**
 * Drawing the cat.
 *
 * Every shape is generated from numbers — no sprite sheet, no imported art.
 * That is a requirement rather than a preference: the original's cat belongs
 * to Atelier 801, and copying it is the one thing that would turn a private
 * learning project into someone else's problem. This cat is circles and curves
 * we wrote, and it is ours.
 *
 * It is also the approach hop//beat settled on for its player figure, for a
 * reason that still applies: a drawn figure costs nothing to load, scales to
 * any size, and can be posed continuously instead of snapping between frames.
 */
import { Container, Graphics } from 'pixi.js';
import { poseAt, type CatState } from './CatPose.ts';

export interface CatColours {
  fur: number;
  belly: number;
  outline: number;
  accent: number;
}

export const DEFAULT_COLOURS: CatColours = {
  fur: 0xf7e3ef,
  belly: 0xffffff,
  outline: 0x2a1b26,
  accent: 0xf472b6,
};

export class CatDancer {
  readonly view = new Container();
  private graphics = new Graphics();
  private colours: CatColours;

  constructor(colours: CatColours = DEFAULT_COLOURS) {
    this.colours = colours;
    this.view.addChild(this.graphics);
  }

  /**
   * @param size body height in pixels. Everything else is a fraction of it, so
   *   the cat is the same shape at any scale.
   */
  draw(state: CatState, x: number, y: number, size: number): void {
    const pose = poseAt(state);
    const g = this.graphics;
    g.clear();

    const { fur, belly, outline, accent } = this.colours;

    // A crouch shortens the body and drops the whole figure; a hop lifts it.
    const bodyHeight = size * (1 - pose.crouch * 0.28);
    const bodyWidth = size * 0.52;
    const groundY = y - pose.hop * size;
    const hipY = groundY - size * 0.28;
    const shoulderY = hipY - bodyHeight * 0.52;
    // Leaning moves the shoulders further than the hips, as a body does.
    const leanX = pose.lean * size * 0.16;
    const headY = shoulderY - size * 0.3;
    const headR = size * 0.29;

    // ---- tail: a curve that sways behind ----
    const tailBase = { x: x - leanX * 0.3 - bodyWidth * 0.42, y: hipY - size * 0.02 };
    g.moveTo(tailBase.x, tailBase.y)
      .quadraticCurveTo(
        tailBase.x - size * 0.34,
        tailBase.y - size * 0.1 + pose.tail * size * 0.22,
        tailBase.x - size * 0.2,
        tailBase.y - size * 0.42 + pose.tail * size * 0.3,
      )
      .stroke({ width: size * 0.09, color: fur, cap: 'round' });

    // ---- legs ----
    const legSpread = bodyWidth * 0.34;
    for (const side of [-1, 1]) {
      const hipX = x - leanX * 0.35 + side * legSpread;
      const footX = x + side * legSpread * 1.15 + pose.lean * size * 0.05;
      g.moveTo(hipX, hipY)
        .quadraticCurveTo(hipX + side * size * 0.03, groundY - size * 0.12, footX, groundY)
        .stroke({ width: size * 0.11, color: fur, cap: 'round' });
    }

    // ---- body ----
    g.ellipse(x - leanX * 0.35, (hipY + shoulderY) / 2, bodyWidth / 2, bodyHeight * 0.34)
      .fill({ color: fur });
    g.ellipse(x - leanX * 0.35, (hipY + shoulderY) / 2 + size * 0.04, bodyWidth * 0.3, bodyHeight * 0.22)
      .fill({ color: belly, alpha: 0.75 });

    // ---- arms: raise runs from hanging down to straight overhead ----
    const arm = (side: -1 | 1, raise: number) => {
      const shoulderX = x - leanX * 0.6 + side * bodyWidth * 0.42;
      // -0.2 (a low reach) through 1 (overhead) mapped onto an arc.
      const angle = (Math.PI / 2) * (1 - raise) + 0.25 * side;
      const length = size * 0.42;
      const handX = shoulderX + Math.cos(angle) * length * side;
      const handY = shoulderY + size * 0.05 - Math.sin(angle - Math.PI / 2) * length;

      g.moveTo(shoulderX, shoulderY + size * 0.04)
        .quadraticCurveTo(
          shoulderX + side * length * 0.5,
          shoulderY + (handY - shoulderY) * 0.4,
          handX,
          handY,
        )
        .stroke({ width: size * 0.1, color: fur, cap: 'round' });
      g.circle(handX, handY, size * 0.065).fill({ color: fur });
    };
    arm(-1, pose.leftArm);
    arm(1, pose.rightArm);

    // ---- head, drawn tilted ----
    const headX = x - leanX;
    const tilt = pose.tilt;
    const rotate = (dx: number, dy: number) => ({
      x: headX + dx * Math.cos(tilt) - dy * Math.sin(tilt),
      y: headY + dx * Math.sin(tilt) + dy * Math.cos(tilt),
    });

    // Ears first, so the head covers their base.
    for (const side of [-1, 1]) {
      const base = rotate(side * headR * 0.62, -headR * 0.55);
      const tip = rotate(side * headR * 0.92, -headR * 1.5);
      const inner = rotate(side * headR * 0.18, -headR * 0.82);
      g.poly([base.x, base.y, tip.x, tip.y, inner.x, inner.y]).fill({ color: fur });
      const innerTip = rotate(side * headR * 0.72, -headR * 1.16);
      g.poly([
        base.x, base.y,
        innerTip.x, innerTip.y,
        inner.x, inner.y,
      ]).fill({ color: accent, alpha: 0.5 });
    }

    g.circle(headX, headY, headR).fill({ color: fur });

    // ---- face ----
    for (const side of [-1, 1]) {
      const eye = rotate(side * headR * 0.36, -headR * 0.05);
      // Eyes close on a crouch or a droop, which is most of what sells a miss.
      const squint = Math.min(1, pose.crouch * 1.2);
      if (squint > 0.5) {
        g.moveTo(eye.x - headR * 0.13, eye.y)
          .lineTo(eye.x + headR * 0.13, eye.y)
          .stroke({ width: size * 0.03, color: outline, cap: 'round' });
      } else {
        g.circle(eye.x, eye.y, headR * 0.11).fill({ color: outline });
      }
    }

    const nose = rotate(0, headR * 0.22);
    g.circle(nose.x, nose.y, headR * 0.07).fill({ color: accent });

    // Whiskers.
    for (const side of [-1, 1]) {
      for (const lift of [-0.08, 0.06]) {
        const from = rotate(side * headR * 0.2, headR * 0.24 + lift * headR);
        const to = rotate(side * headR * 0.85, headR * (0.14 + lift * 1.6));
        g.moveTo(from.x, from.y)
          .lineTo(to.x, to.y)
          .stroke({ width: size * 0.014, color: outline, alpha: 0.5 });
      }
    }
  }

  destroy(): void {
    this.graphics.destroy();
    this.view.destroy({ children: true });
  }
}

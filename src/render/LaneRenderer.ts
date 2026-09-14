/**
 * The falling-arrow field, in PixiJS.
 *
 * Four lanes, arrows travelling toward a receptor line. Thirty years of rhythm
 * games have settled on this and it is readable in a way hop//beat's approach
 * rings never became: distance to the receptor IS time to the beat, so a
 * player reads timing spatially without being taught anything.
 *
 * The renderer owns no game state. It is handed a frame's worth and draws it,
 * so it can be destroyed and rebuilt without disturbing a song in progress.
 */
import { Application, Assets, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { Judgment } from '../engine/LaneJudge.ts';
import { LANES, LANE_INDEX, type Lane } from '../charts/schema.ts';
import { SpriteDancer, loadDanceSheets, type DanceSheets, type DancerKind } from './SpriteDancer.ts';
import { createWalker, depthScale, steer, step, type Point, type Walker } from './Wander.ts';

const LANE_COLOUR: Record<Lane, number> = {
  left: 0xf472b6,
  down: 0x38bdf8,
  up: 0x4ade80,
  right: 0xf5c451,
};

const JUDGMENT_COLOUR: Record<Judgment, number> = {
  PERFECT: 0x4ade80,
  GREAT: 0x38bdf8,
  GOOD: 0xf5c451,
  OKAY: 0xfb923c,
  MISS: 0xf87171,
};

/**
 * How far ahead an arrow appears, in milliseconds of song.
 *
 * Time rather than distance, so scroll speed is the same musical distance on
 * every screen: an arrow always spends this long travelling, whatever the
 * window height.
 */
export const DEFAULT_LEAD_MS = 1600;

/**
 * The lane strip: a narrow column down the left, not the whole screen.
 *
 * The arrows are the thing being read, but they are not the thing being
 * watched. Giving them a column leaves the rest of the room to the cats, which
 * is the point of a dancing game — you play in the corner of your eye and look
 * at the party.
 */
const LANE_STRIP_WIDTH = 0.34;
const LANE_INSET_FALLBACK = 20;

/** Inner screen of the club plate, as fractions of the PNG. */
const PLATE_BEZEL = { x: 0.245, y: 0.075, w: 0.51, h: 0.355 };

const PLATE_URL: Record<'cat' | 'bunny', string> = {
  cat: '/rooms/cat-room.png',
  bunny: '/rooms/bunny-room.png',
};

/** Where the receptor sits within the strip, as a fraction of its height. */
const RECEPTOR_Y = 0.78;

/** Fallbacks if computed style has not loaded the tokens yet. */
const NOTE_SIZE_FALLBACK = 64;
const RECEPTOR_SIZE_FALLBACK = 72;
const LANE_WIDTH_FALLBACK = 420;

export interface RoomPlayerView {
  id: string;
  name: string;
  isMe: boolean;
  /** The lane they last hit, so their figure poses. */
  lane?: Lane | null;
  hitAtMs?: number;
  missAtMs?: number;
  /** Which dance sheet. Defaults to the cat. */
  kind?: DancerKind;
  /** Last thing they said, drawn as a bubble. */
  say?: string;
  sayAtMs?: number;
}

interface Popup {
  text: Text;
  bornAt: number;
  lane: Lane;
}

interface Flash {
  graphic: Graphics;
  bornAt: number;
  colour: number;
  lane: Lane;
}

export interface LaneRenderState {
  /**
   * What `drawArrows` actually reads. The prototype engine's `ActiveArrow`
   * satisfies this; so does a mapped `ActiveNote` from Game Core.
   */
  arrows: ReadonlyArray<{
    timeMs: number;
    judgment: Judgment | null;
    arrow: { lane: Lane };
  }>;
  playbackTimeMs: number;
  heldLanes: ReadonlySet<Lane>;
  leadMs: number;
  nowMs: number;
  /** Tempo for the idle bob. Zero means stand still. */
  bpm?: number;
  /** Everyone in the room, including the local player. */
  players?: readonly RoomPlayerView[];
  /** Figures stop strolling and dance in place while a round runs. */
  roundRunning?: boolean;
}

const POPUP_MS = 520;
const FLASH_MS = 260;
const SAY_MS = 4_500;

export class LaneRenderer {
  private app: Application | null = null;
  private roomLayer = new Container();
  private fieldLayer = new Container();
  private catLayer = new Container();
  private arrowLayer = new Container();
  private effectLayer = new Container();
  private roomGraphics = new Graphics();
  private plate: Sprite | null = null;
  private plateMask = new Graphics();
  private host: HTMLElement | null = null;

  /** One figure and one walker per player, kept between frames. */
  private cats = new Map<
    string,
    {
      dancer: SpriteDancer;
      walker: Walker;
      label: Text;
      bubble: Text;
      bubbleBg: Graphics;
      kind: DancerKind;
    }
  >();
  private sheets: DanceSheets | null = null;
  private lastFrameMs = 0;

  /** What the cat is reacting to. */
  private lastLane: Lane | null = null;
  private lastHitAtMs = 0;
  private lastMissAtMs = 0;
  private fieldGraphics = new Graphics();
  private arrowGraphics = new Graphics();

  private popups: Popup[] = [];
  private flashes: Flash[] = [];

  private width = 0;
  private height = 0;
  private pendingSteer: Point | null = null;
  private onFieldPointer = (event: PointerEvent): void => {
    this.handleFloorClick(event);
  };

  /**
   * PixiJS creates its own canvas rather than being handed one.
   *
   * Learned the hard way in hop//beat: React StrictMode mounts every effect
   * twice, and two Applications sharing a canvas means destroying the
   * cancelled one takes the WebGL context out from under the live one. The
   * symptom is a game that runs perfectly while drawing nothing.
   */
  async init(container: HTMLElement): Promise<void> {
    const app = new Application();
    await app.init({
      resizeTo: container,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });

    app.canvas.className = 'field__canvas';
    container.appendChild(app.canvas);
    this.host = container;
    // The cat sits behind the arrows: she is the reason to look at the screen,
    // but never the thing in the way of reading one.
    app.stage.addChild(
      this.roomLayer,
      this.catLayer,
      this.fieldLayer,
      this.arrowLayer,
      this.effectLayer,
    );
    this.roomLayer.addChild(this.roomGraphics, this.plateMask);
    this.fieldLayer.addChild(this.fieldGraphics);
    this.arrowLayer.addChild(this.arrowGraphics);

    this.app = app;
    this.resize();
    container.addEventListener('pointerdown', this.onFieldPointer);
    this.sheets = await loadDanceSheets();
    await this.loadPlate(container);
  }

  private async loadPlate(container: HTMLElement): Promise<void> {
    const theme = container.closest('[data-room]')?.getAttribute('data-room');
    const url = theme === 'bunny' ? PLATE_URL.bunny : PLATE_URL.cat;
    try {
      const texture = (await Assets.load(url)) as Texture;
      const plate = new Sprite(texture);
      plate.anchor.set(0.5);
      plate.mask = this.plateMask;
      this.roomLayer.addChildAt(plate, 0);
      this.plate = plate;
    } catch {
      this.plate = null;
    }
  }

  resize(): void {
    if (!this.app) return;
    // `screen` is the view in CSS pixels — the same space the layout is in.
    this.width = this.app.renderer.screen.width;
    this.height = this.app.renderer.screen.height;
  }

  isReady(): boolean {
    return this.app !== null;
  }

  /** Inset from the canvas left so the strip sits off the wall. */
  private stripLeft(): number {
    return this.readCssPx('--lane-inset', LANE_INSET_FALLBACK);
  }

  /** The strip the lanes live in: inset, full height, capped at --lane-width. */
  private stripWidth(): number {
    return Math.min(this.width * LANE_STRIP_WIDTH, this.readCssPx('--lane-width', LANE_WIDTH_FALLBACK));
  }

  /** Room starts just after the lane panel. */
  private roomLeft(): number {
    return this.stripLeft() + this.stripWidth();
  }

  private laneWidth(): number {
    return this.stripWidth() / LANES.length;
  }

  private noteSize(): number {
    return this.readCssPx('--note-size', NOTE_SIZE_FALLBACK);
  }

  private receptorSize(): number {
    return this.readCssPx('--receptor-size', RECEPTOR_SIZE_FALLBACK);
  }

  private laneCentreX(lane: Lane): number {
    return this.stripLeft() + this.laneWidth() * (LANE_INDEX[lane] + 0.5);
  }

  private receptorY(): number {
    return this.height * RECEPTOR_Y;
  }

  render(state: LaneRenderState): void {
    if (!this.app) return;
    this.resize();
    const deltaMs = this.lastFrameMs ? Math.min(200, state.nowMs - this.lastFrameMs) : 16;
    this.lastFrameMs = state.nowMs;

    this.drawRoom(state);
    this.drawCats(state, deltaMs);
    this.drawField(state);
    this.drawArrows(state);
    this.updateEffects(state.nowMs);
  }

  private drawField(state: LaneRenderState): void {
    const g = this.fieldGraphics;
    g.clear();

    const laneWidth = this.laneWidth();
    const receptorY = this.receptorY();
    const size = this.receptorSize();
    const left = this.stripLeft();
    const strip = this.stripWidth();
    const panel = this.readCssColor('--panel', 0x16101c);
    const shell = Number.parseFloat(
      getComputedStyle(this.host ?? document.documentElement).getPropertyValue('--lane-shell-opacity'),
    );
    const shellAlpha = Number.isFinite(shell) && shell > 0 ? shell : 0.72;

    g.roundRect(left, 0, strip, this.height, 12).fill({ color: panel, alpha: shellAlpha });

    for (const lane of LANES) {
      const cx = this.laneCentreX(lane);
      const colour = LANE_COLOUR[lane];
      const held = state.heldLanes.has(lane);

      // Lane column, barely there — it separates without competing.
      g.rect(cx - laneWidth / 2, 0, laneWidth, this.height)
        .fill({ color: colour, alpha: held ? 0.09 : 0.03 });

      this.paintGlowArrow(g, cx, receptorY, size, lane, colour, held ? 1 : 0.72);
    }

    // The receptor line itself, so the row reads as one target rather than four.
    g.moveTo(left, receptorY).lineTo(left + strip, receptorY)
      .stroke({ width: 1, color: 0xffffff, alpha: 0.14 });

    const glow = this.readCssColor('--room-glow', 0xd84bff);
    g.roundRect(left, 0, strip, this.height, 12)
      .stroke({ width: 2, color: glow, alpha: 0.45 });
  }

  private readCssColor(name: string, fallback: number): number {
    const raw = getComputedStyle(this.host ?? document.documentElement).getPropertyValue(name).trim();
    if (raw.startsWith('#') && (raw.length === 7 || raw.length === 4)) {
      const hex = raw.length === 4
        ? `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`
        : raw;
      return Number.parseInt(hex.slice(1), 16);
    }
    const rgb = raw.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgb) return (Number(rgb[1]) << 16) | (Number(rgb[2]) << 8) | Number(rgb[3]);
    return fallback;
  }

  private readCssPx(name: string, fallback: number): number {
    const n = Number.parseFloat(
      getComputedStyle(this.host ?? document.documentElement).getPropertyValue(name),
    );
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  private drawArrows(state: LaneRenderState): void {
    const g = this.arrowGraphics;
    g.clear();

    const size = this.noteSize();
    const receptorY = this.receptorY();

    for (const active of state.arrows) {
      if (active.judgment !== null) continue;

      const remaining = active.timeMs - state.playbackTimeMs;
      if (remaining > state.leadMs || remaining < -200) continue;

      // Distance to the receptor IS time to the beat. That is the whole idea:
      // the player reads timing spatially and never has to be told how.
      const progress = 1 - remaining / state.leadMs;
      const y = progress * receptorY;
      const cx = this.laneCentreX(active.arrow.lane);
      const colour = LANE_COLOUR[active.arrow.lane];

      // Fade in at the top so arrows arrive rather than blink into being.
      const alpha = Math.min(1, progress * 5);

      this.paintGlowArrow(g, cx, y, size, active.arrow.lane, colour, alpha);
    }
  }

  /**
   * A neon chevron: a few larger, dimmer copies behind the solid arrow.
   * Pixi has no box-shadow; this is the glow.
   */
  private paintGlowArrow(
    g: Graphics,
    cx: number,
    cy: number,
    size: number,
    lane: Lane,
    colour: number,
    alpha: number,
  ): void {
    const bloom = [
      { scale: 1.55, fill: 0.08 },
      { scale: 1.28, fill: 0.16 },
      { scale: 1.12, fill: 0.28 },
    ];
    for (const layer of bloom) {
      this.drawArrowShape(g, cx, cy, size * layer.scale, lane);
      g.fill({ color: colour, alpha: alpha * layer.fill });
    }
    this.drawArrowShape(g, cx, cy, size, lane);
    g.fill({ color: colour, alpha: alpha * 0.95 });
    this.drawArrowShape(g, cx, cy, size, lane);
    g.stroke({ width: 2, color: 0xffffff, alpha: alpha * 0.35 });
  }

  /** A chevron pointing the way its lane does. */
  private drawArrowShape(g: Graphics, cx: number, cy: number, size: number, lane: Lane): void {
    const h = size / 2;
    const rotations: Record<Lane, number> = {
      left: Math.PI / 2,
      down: 0,
      up: Math.PI,
      right: -Math.PI / 2,
    };
    const angle = rotations[lane];
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // A downward chevron, rotated into the lane's direction.
    const points: Array<[number, number]> = [
      [0, h], [-h, 0], [-h * 0.45, 0], [-h * 0.45, -h], [h * 0.45, -h], [h * 0.45, 0], [h, 0],
    ];
    const mapped = points.map(([x, y]) => [cx + x * cos - y * sin, cy + x * sin + y * cos]);
    g.poly(mapped.flat());
  }

  /**
   * The room: the club plate to the right of the lane strip.
   *
   * Cover-fit, never stretch — a wide window crops the sides rather than
   * turning the floor mark into an oval. If the PNG is missing we keep the
   * old box so the cats still have a floor.
   */
  private drawRoom(state: LaneRenderState): void {
    const g = this.roomGraphics;
    g.clear();

    const left = this.roomLeft();
    const width = this.width - left;
    if (width <= 0) return;

    if (this.layoutPlate(left, 0, width, this.height)) return;

    const horizon = this.height * 0.42;

    // Back wall, then floor, with the join left visible.
    g.rect(left, 0, width, horizon).fill({ color: 0x1a1220 });
    g.rect(left, horizon, width, this.height - horizon).fill({ color: 0x241a2c });
    g.moveTo(left, horizon).lineTo(this.width, horizon)
      .stroke({ width: 1, color: 0xffffff, alpha: 0.06 });

    for (let i = 1; i < 7; i++) {
      const t = i / 7;
      const y = horizon + (this.height - horizon) * t * t;
      g.moveTo(left, y).lineTo(this.width, y)
        .stroke({ width: 1, color: 0xffffff, alpha: 0.04 });
    }

    const glowY = this.height * 0.78;
    g.ellipse(left + width / 2, glowY, width * 0.42, this.height * 0.16)
      .fill({ color: 0xf472b6, alpha: state.roundRunning ? 0.07 : 0.035 });
  }

  /** True when the plate is on screen. Writes --tv-* so the YouTube hole matches. */
  private layoutPlate(x: number, y: number, w: number, h: number): boolean {
    const plate = this.plate;
    if (!plate || !plate.texture) return false;

    const imgW = plate.texture.width;
    const imgH = plate.texture.height;
    if (imgW <= 0 || imgH <= 0) return false;

    const scale = Math.max(w / imgW, h / imgH);
    plate.position.set(x + w / 2, y + h / 2);
    plate.scale.set(scale);

    this.plateMask.clear();
    this.plateMask.rect(x, y, w, h).fill({ color: 0xffffff });

    const drawnW = imgW * scale;
    const drawnH = imgH * scale;
    const originX = x + w / 2 - drawnW / 2;
    const originY = y + h / 2 - drawnH / 2;
    const host = this.host;
    if (host) {
      host.style.setProperty('--tv-x', `${originX + PLATE_BEZEL.x * drawnW}px`);
      host.style.setProperty('--tv-y', `${originY + PLATE_BEZEL.y * drawnH}px`);
      host.style.setProperty('--tv-w', `${PLATE_BEZEL.w * drawnW}px`);
      host.style.setProperty('--tv-h', `${PLATE_BEZEL.h * drawnH}px`);
    }
    return true;
  }

  /**
   * Everyone's cat, walking about between rounds and dancing during one.
   *
   * Cats are drawn back to front so a nearer one overlaps a further one, which
   * is the whole payoff of giving the room any depth at all.
   */
  private drawCats(state: LaneRenderState, deltaMs: number): void {
    const players = state.players ?? [];
    const left = this.roomLeft();
    const width = this.width - left;

    // Retire cats whose player has gone.
    const present = new Set(players.map((p) => p.id));
    for (const [id, entry] of this.cats) {
      if (present.has(id)) continue;
      this.retireCat(entry);
      this.cats.delete(id);
    }

    if (!this.sheets) return;

    const drawn: Array<{
      y: number;
      entry: {
        dancer: SpriteDancer;
        label: Text;
        bubble: Text;
        bubbleBg: Graphics;
      };
      player: RoomPlayerView;
      size: number;
      x: number;
    }> = [];

    for (const player of players) {
      const kind = player.kind ?? 'cat';
      let entry = this.cats.get(player.id);
      if (entry && entry.kind !== kind) {
        this.retireCat(entry);
        this.cats.delete(player.id);
        entry = undefined;
      }
      if (!entry) {
        const dancer = new SpriteDancer(this.sheets[kind]);
        const label = new Text({
          text: player.name,
          style: {
            fill: player.isMe ? 0xf472b6 : 0xf2ecf7,
            fontSize: this.readCssPx('--type-name', 14),
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
            fontWeight: '600',
            dropShadow: {
              color: 0x000000,
              alpha: 0.75,
              blur: 3,
              distance: 1,
            },
          },
        });
        label.anchor.set(0.5);
        const bubble = new Text({
          text: '',
          style: {
            fill: 0xf2ecf7,
            fontSize: 13,
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
            fontWeight: '600',
            wordWrap: true,
            wordWrapWidth: 150,
          },
        });
        bubble.anchor.set(0.5, 1);
        const bubbleBg = new Graphics();
        this.catLayer.addChild(dancer.view, label, bubbleBg, bubble);
        entry = { dancer, walker: createWalker(player.id, state.nowMs), label, bubble, bubbleBg, kind };
        this.cats.set(player.id, entry);
      }

      if (player.isMe && this.pendingSteer) {
        entry.walker = steer(entry.walker, this.pendingSteer, state.nowMs);
        this.pendingSteer = null;
      }

      // Unsteered figures stay put during a song. A click-steered one still
      // walks — pose is drawn after this, so they dance on the way.
      entry.walker = step(entry.walker, player.id, state.nowMs, deltaMs, {
        frozen: state.roundRunning === true && !entry.walker.steered,
      });

      const scale = depthScale(entry.walker.position.y);
      const x = left + entry.walker.position.x * width;
      const y = entry.walker.position.y * this.height;
      const base = this.readCssPx(
        players.length >= 5 ? '--avatar-5-6' : '--avatar-1-4',
        players.length >= 5 ? 115 : 130,
      );
      const size = base * scale;

      drawn.push({ y, entry, player, size, x });
    }

    // Painter's algorithm: further up the room is further away.
    drawn.sort((a, b) => a.y - b.y);
    for (const item of drawn) {
      this.catLayer.setChildIndex(item.entry.dancer.view, this.catLayer.children.length - 1);
      this.catLayer.setChildIndex(item.entry.label, this.catLayer.children.length - 1);
      this.catLayer.setChildIndex(item.entry.bubbleBg, this.catLayer.children.length - 1);
      this.catLayer.setChildIndex(item.entry.bubble, this.catLayer.children.length - 1);

      // The local player's cat is posed from what the renderer itself saw,
      // which is a frame earlier than anything that could arrive over a socket.
      const mine = item.player.isMe;
      item.entry.dancer.draw(
        {
          lane: mine ? this.lastLane : (item.player.lane ?? null),
          hitAtMs: mine ? this.lastHitAtMs : (item.player.hitAtMs ?? 0),
          missAtMs: mine ? this.lastMissAtMs : (item.player.missAtMs ?? 0),
          bpm: state.roundRunning ? (state.bpm ?? 0) : 0,
          playbackMs: state.playbackTimeMs,
          nowMs: state.nowMs,
        },
        item.x,
        item.y,
        item.size,
      );

      item.entry.label.position.set(item.x, item.y + item.size * 0.16);
      item.entry.label.scale.set(1);
      this.drawSay(item.entry, item.player, item.x, item.y, item.size, state.nowMs);
    }
  }

  private retireCat(entry: {
    dancer: SpriteDancer;
    label: Text;
    bubble: Text;
    bubbleBg: Graphics;
  }): void {
    entry.dancer.destroy();
    entry.label.destroy();
    entry.bubble.destroy();
    entry.bubbleBg.destroy();
  }

  private drawSay(
    entry: { bubble: Text; bubbleBg: Graphics },
    player: RoomPlayerView,
    x: number,
    y: number,
    size: number,
    nowMs: number,
  ): void {
    const text = player.say?.trim() ?? '';
    const born = player.sayAtMs ?? 0;
    const live = text.length > 0 && born > 0 && nowMs - born < SAY_MS;
    entry.bubble.visible = live;
    entry.bubbleBg.visible = live;
    if (!live) return;
    const clipped = text.length > 48 ? `${text.slice(0, 47)}…` : text;
    if (entry.bubble.text !== clipped) entry.bubble.text = clipped;
    const fade = Math.min(1, (SAY_MS - (nowMs - born)) / 400);
    entry.bubble.alpha = fade;
    entry.bubble.position.set(x, y - size * 0.72);
    const bounds = entry.bubble.getLocalBounds();
    const padX = 8;
    const padY = 5;
    entry.bubbleBg.clear();
    entry.bubbleBg.roundRect(
      x - bounds.width / 2 - padX,
      y - size * 0.72 - bounds.height - padY,
      bounds.width + padX * 2,
      bounds.height + padY * 2,
      8,
    );
    entry.bubbleBg.fill({ color: 0x16101c, alpha: 0.92 * fade });
    entry.bubbleBg.stroke({ color: 0x2e2338, width: 1, alpha: fade });
  }

  /** Feedback for one judgment, fired straight from the engine's output. */
  showJudgment(judgment: Judgment, lane: Lane, nowMs: number): void {
    if (!this.app) return;

    // The cat reacts to what the player did, so the movement is a consequence
    // of playing rather than an animation running alongside it.
    if (judgment === 'MISS') {
      this.lastMissAtMs = nowMs;
    } else {
      this.lastLane = lane;
      this.lastHitAtMs = nowMs;
    }

    const colour = JUDGMENT_COLOUR[judgment];
    const cx = this.laneCentreX(lane);

    if (judgment !== 'MISS') {
      const graphic = new Graphics();
      graphic.position.set(cx, this.receptorY());
      this.effectLayer.addChild(graphic);
      this.flashes.push({ graphic, bornAt: nowMs, colour, lane });
    }

    const text = new Text({
      text: judgment,
      style: {
        fill: colour,
        fontSize: this.readCssPx('--type-combo', 22) + (judgment === 'PERFECT' ? 4 : 0),
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontWeight: '700',
        letterSpacing: 1.2,
      },
    });
    text.anchor.set(0.5);
    text.position.set(cx, this.receptorY() - this.laneWidth() * 0.55);
    this.effectLayer.addChild(text);
    this.popups.push({ text, bornAt: nowMs, lane });
  }

  private updateEffects(nowMs: number): void {
    const size = this.receptorSize();

    this.flashes = this.flashes.filter((flash) => {
      const age = (nowMs - flash.bornAt) / FLASH_MS;
      if (age >= 1) {
        flash.graphic.destroy();
        return false;
      }
      const eased = 1 - (1 - age) ** 3;
      flash.graphic.clear();
      flash.graphic
        .circle(0, 0, size * (0.6 + eased * 1.1))
        .stroke({ width: 3 * (1 - age), color: flash.colour, alpha: 1 - age });
      return true;
    });

    this.popups = this.popups.filter((popup) => {
      const age = (nowMs - popup.bornAt) / POPUP_MS;
      if (age >= 1) {
        popup.text.destroy();
        return false;
      }
      popup.text.alpha = 1 - age ** 2;
      popup.text.y -= 0.5;
      return true;
    });
  }

  clearEffects(): void {
    for (const f of this.flashes) f.graphic.destroy();
    for (const p of this.popups) p.text.destroy();
    this.flashes = [];
    this.popups = [];
    this.lastLane = null;
    this.lastHitAtMs = 0;
    this.lastMissAtMs = 0;
  }

  private handleFloorClick(event: PointerEvent): void {
    const host = this.host;
    if (!host || this.width <= 0) return;
    const hit = event.target;
    if (hit instanceof Element && hit.closest('.tv, .hud, .overlay, .readybar, .nowplaying, .lane-card')) {
      return;
    }

    const rect = host.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const left = this.roomLeft();
    const span = this.width - left;
    if (span <= 0 || x < left) return;

    this.pendingSteer = {
      x: (x - left) / span,
      y: y / this.height,
    };
  }

  destroy(): void {
    this.host?.removeEventListener('pointerdown', this.onFieldPointer);
    this.clearEffects();
    this.app?.destroy(true, { children: true });
    this.app = null;
    this.plate = null;
    this.host = null;
    this.pendingSteer = null;
  }

  /** Pose the cat from a key press, before any judgment is known. */
  reactToPress(lane: Lane, nowMs: number): void {
    this.lastLane = lane;
    this.lastHitAtMs = nowMs;
  }
}

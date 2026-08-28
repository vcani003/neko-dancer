/**
 * The standing cat, in the real renderer.
 *
 * A page rather than a screenshot, because the thing worth checking is what
 * PixiJS does with the cut parts — texture edges, scaling, layer order — and
 * none of that is visible in a composite made by anything else.
 *
 * `npm run dev`, then open `/cat.html`.
 */
import { Application } from 'pixi.js';
import { CAT_HEADS, CAT_TAILS, type CatHead, type CatTail } from './catParts.ts';
import { CatSprite, loadCatParts } from './CatSprite.ts';

const stage = document.getElementById('stage') as HTMLElement;
const controls = document.getElementById('controls') as HTMLElement;

async function main(): Promise<void> {
  const app = new Application();
  await app.init({ background: '#0a0510', resizeTo: stage, antialias: true });
  stage.appendChild(app.canvas);

  await loadCatParts();

  const cat = new CatSprite();
  app.stage.addChild(cat.view);

  let size = 260;
  const redraw = () => cat.draw(app.screen.width / 2, app.screen.height / 2, size);
  redraw();
  app.renderer.on('resize', redraw);

  const group = (label: string, values: readonly string[], onPick: (v: string) => void) => {
    const wrap = document.createElement('div');
    wrap.className = 'group';
    wrap.append(Object.assign(document.createElement('span'), { textContent: label }));
    for (const value of values) {
      const button = document.createElement('button');
      button.textContent = value;
      button.onclick = () => {
        onPick(value);
        redraw();
      };
      wrap.appendChild(button);
    }
    controls.appendChild(wrap);
  };

  group('expression', CAT_HEADS, (v) => cat.setHead(v as CatHead));
  group('tail', CAT_TAILS, (v) => cat.setTail(v as CatTail));
  group('size', ['140', '260', '420'], (v) => {
    size = Number(v);
  });
}

void main();

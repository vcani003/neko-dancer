/**
 * The Phase 2 gate, run by a person.
 *
 * **Load, play, `currentTimeMs()` advances, pause, seek, error detected** —
 * against the real YouTube, in a real browser, exactly once. Everything else in
 * this layer is proven on fakes, because Part 4's rule is absolute: no
 * automated test may require YouTube. This is the deliberate exception, and the
 * reason it is a page rather than a test file is that it *cannot* be a test
 * file without breaking that rule.
 *
 * What it is actually checking is the half a fake cannot: that the assumptions
 * encoded in the fakes are true of the real player. A fake that agrees with
 * itself proves nothing about YouTube's clock resolution, about whether `CUED`
 * really arrives, or about whether an error code shows up where the code
 * expects it.
 *
 * Open `http://<this machine>:5180/smoke.html` with `npm run dev` running.
 * A `.local` hostname, not a bare IP — YouTube refuses restriction-bearing
 * videos on a numeric origin, which cost an evening once already.
 */
import { YouTubeAdapter } from './YouTubeAdapter.ts';
import { YouTubeProvider } from './YouTubeProvider.ts';
import { checkVideoPlayable } from './checkVideoPlayable.ts';
import type { YouTubePlaybackError } from './YouTubeErrors.ts';

const log = document.getElementById('log') as HTMLElement;
const stage = document.getElementById('stage') as HTMLElement;
const input = document.getElementById('url') as HTMLInputElement;
const run = document.getElementById('run') as HTMLButtonElement;

let failures = 0;

function line(status: 'pass' | 'fail' | 'info', label: string, detail = ''): void {
  if (status === 'fail') failures += 1;
  const row = document.createElement('div');
  row.className = `row row--${status}`;
  row.textContent = `${status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : '·'}  ${label}${detail ? `  — ${detail}` : ''}`;
  log.appendChild(row);
}

function check(label: string, condition: boolean, detail = ''): void {
  line(condition ? 'pass' : 'fail', label, detail);
}

/** Real elapsed time, which is the one thing this page is allowed to use. */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function smoke(url: string): Promise<void> {
  log.replaceChildren();
  stage.replaceChildren();
  failures = 0;

  // ---------------------------------------------------------- resolve ----
  const provider = new YouTubeProvider();
  const source = await provider.resolve(url);
  line('info', `resolved: ${source.title}`, source.providerMediaId);
  check('the title came from the video, not from a field', source.title.length > 0);

  // ------------------------------------------------------------- load ----
  let lateError: YouTubePlaybackError | null = null;
  const adapter = new YouTubeAdapter({
    container: stage,
    onLateError: (error) => {
      lateError = error;
      line('info', 'late error', `${error.code}: ${error.message}`);
    },
  });

  await adapter.load(source);
  check('load resolves and the adapter is ready', adapter.isReady());
  check('duration is known once loaded', (adapter.durationMs() ?? 0) > 0, `${adapter.durationMs()} ms`);

  // ------------------------------------------------------------- play ----
  adapter.play();
  await sleep(1500);
  const first = adapter.currentTimeMs();
  await sleep(1500);
  const second = adapter.currentTimeMs();

  check('playing', adapter.isPlaying(), adapter.state());
  check('currentTimeMs advances while playing', second > first, `${first} → ${second}`);
  // The number this layer exists to accommodate: YouTube's clock is coarse, and
  // `MediaClock` is tuned against whatever it actually is.
  line('info', 'observed advance over ~1.5 s', `${Math.round(second - first)} ms`);

  // ------------------------------------------------------------ pause ----
  adapter.pause();
  await sleep(800);
  const paused = adapter.currentTimeMs();
  await sleep(800);
  check('currentTimeMs stops when paused', Math.abs(adapter.currentTimeMs() - paused) < 100);
  check('state says paused', adapter.state() === 'paused', adapter.state());

  // ------------------------------------------------------------- seek ----
  adapter.seek(60_000);
  await sleep(1200);
  const sought = adapter.currentTimeMs();
  check('seek moves the position', Math.abs(sought - 60_000) < 3_000, `${Math.round(sought)} ms`);

  // ------------------------------------------------------------ reload ----
  // The path a queue takes between rounds: same player, different video.
  await adapter.load(source);
  check('a second load reuses the player and resolves', adapter.isReady());

  adapter.dispose();
  check('dispose leaves it not ready', !adapter.isReady());

  // ------------------------------------------------------------ errors ----
  const bad = await checkVideoPlayable('aaaaaaaaaaa');
  check('an unplayable video is detected', bad.ok === false, bad.error ? `code ${bad.error.code}` : 'reported ok');
  if (bad.error) line('info', bad.error.message, bad.error.hint);

  const good = await checkVideoPlayable(source.providerMediaId);
  check('a playable video passes the preflight', good.ok === true);

  line('info', lateError ? 'a late error occurred during the run' : 'no late errors');
  line(failures === 0 ? 'pass' : 'fail', `${failures === 0 ? 'GATE PASSED' : `${failures} CHECK(S) FAILED`}`);
}

run.addEventListener('click', () => {
  run.disabled = true;
  smoke(input.value)
    .catch((error: unknown) => {
      line('fail', 'the run threw', error instanceof Error ? error.message : String(error));
    })
    .finally(() => {
      run.disabled = false;
    });
});

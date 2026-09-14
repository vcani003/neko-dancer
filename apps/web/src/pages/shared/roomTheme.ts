/**
 * Room paint. Not the Home costume.
 *
 * A bunny sprite can stand in the purple room. `?theme=bunny` is the only
 * switch for now — Public defaults to cat.
 */
export type RoomTheme = 'cat' | 'bunny';

export function readRoomTheme(): RoomTheme {
  return new URLSearchParams(window.location.search).get('theme') === 'bunny'
    ? 'bunny'
    : 'cat';
}

export const ROOM_PLATE: Record<RoomTheme, string> = {
  cat: '/rooms/cat-room.png',
  bunny: '/rooms/bunny-room.png',
};

/** Product cap on Public. Protocol allows more; ROOM-LOOPS.md does not. */
export const PUBLIC_CAP = 6;

/**
 * `?dev=1` leaves the YouTube player clickable so a chart can be paused
 * while working. Without it, play locks the iframe — a pause would desync
 * the chart.
 */
export function videoClicksAllowed(): boolean {
  return new URLSearchParams(window.location.search).get('dev') === '1';
}

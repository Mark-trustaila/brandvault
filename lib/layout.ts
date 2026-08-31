/**
 * The three columns, as a system.
 *
 * The values live in app/globals.css as custom properties; these constants
 * mirror them for documentation and for the tests, and a test asserts the two
 * agree. Kept in a plain module rather than in AppShell.tsx because a .tsx
 * cannot be imported by the tests under this project's jsx: preserve.
 *
 * The rail and the panel are separate widths. The rail is a column you read
 * alongside the centre; the panel is a column you read instead of it, and they
 * want different amounts of room. When a panel opens with space to spare, the
 * rail column takes the panel's width and the centre narrows to make room —
 * nothing is covered and no backdrop appears, because the panel is in the flow
 * rather than over it.
 *
 * Nav fixed. Its content is short labels and a long index; wider only pushes
 * the counts away from the labels.
 *
 * Centre takes the remainder, floored at the width where the results table
 * stays legible without scrolling, and uncapped above it.
 *
 * Columns with no panel open (nav / centre / rail):
 *
 *   1280   240 /  720 / 320
 *   1440   240 /  880 / 320
 *   1680   240 / 1120 / 320
 *   1920   240 / 1360 / 320
 *
 * With a panel open, from 1320 up:
 *
 *   1320   240 /  640 / 440   centre at its floor
 *   1440   240 /  760 / 440
 *   1680   240 / 1000 / 440
 *   1920   240 / 1240 / 440
 *
 * Below 1320 taking the panel's width would push the centre under its floor,
 * so the panel falls back to the slide-over it already was. Below 1280 the rail
 * leaves the flow entirely.
 */
export const NAV_WIDTH = 240;
export const RAIL_WIDTH = 320;
export const PANEL_WIDTH = 440;
export const CENTRE_FLOOR = 640;
/** At and above this viewport width a panel opens in the flow. */
export const PANEL_IN_FLOW_FROM = 1320;
/** Below this the rail leaves the flow. */
export const RAIL_IN_FLOW_FROM = 1280;

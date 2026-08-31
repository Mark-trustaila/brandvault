/**
 * The three columns, as a system.
 *
 * The values live in app/globals.css as custom properties, because the rail's
 * width is also the slide-over panels' width and one variable is the only way
 * those two cannot drift. These constants mirror them for documentation and for
 * the tests, and a test asserts the two agree.
 *
 * Nav fixed. Its content is short labels and a long index; wider only pushes
 * the counts away from the labels.
 *
 * Rail fixed, and the second widest column rather than the narrowest: it is the
 * reading column. At 440 its cards take two comfortable sentences per line, the
 * panels' field grids run two columns, and four footer actions fit with labels.
 * Between 1280 and 1440 it gives up 40px so the centre keeps its floor.
 *
 * Centre takes the remainder, floored at the width where the results table
 * stays legible without scrolling, and uncapped above it — lists and tables use
 * width honestly.
 *
 * Resulting columns (nav / centre / rail):
 *
 *   1280   240 /  640 / 400   centre at its floor
 *   1440   240 /  760 / 440
 *   1680   240 / 1000 / 440
 *   1920   240 / 1240 / 440
 *
 * Below 1280 the rail leaves the flow rather than pushing the centre under its
 * floor. Panels are fixed-position slide-overs and are unaffected.
 */
export const NAV_WIDTH = 240;
export const RAIL_WIDTH = 440;
export const RAIL_WIDTH_NARROW = 400;
export const CENTRE_FLOOR = 640;
/** At and above this viewport width the rail is RAIL_WIDTH. */
export const RAIL_FULL_FROM = 1440;
/** Below this the rail leaves the flow. */
export const RAIL_IN_FLOW_FROM = 1280;

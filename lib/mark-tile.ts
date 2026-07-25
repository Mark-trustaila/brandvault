/**
 * Alt text for a device-mark image. Never empty: for a figurative mark the
 * image IS the mark, so a screen reader must get the identifier.
 *
 * Lives in lib/ rather than in the component so it is testable without a JSX
 * transform in the test run.
 */
export const deviceImageAlt = (applicationNumber?: string): string =>
  applicationNumber ? `device mark ${applicationNumber}` : 'device mark';

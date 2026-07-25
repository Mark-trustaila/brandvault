'use client';

import { deviceImageAlt } from '../../lib/mark-tile';

/**
 * The avatar tile for a mark.
 *
 * Two treatments, one rule:
 *  - image_url present (the verified GB device marks): render the mark image on
 *    white, object-fit contain, so the device is never cropped or stretched.
 *  - otherwise: a plain coloured tile with NO lettering. Initials used to be
 *    drawn here and read to an IP audience as the mark's logo or device
 *    version, which is misleading for a word mark that has no device at all.
 *
 * The caller passes its own className so each surface keeps the size and shape
 * its stylesheet already defines. Only the inner image is styled here, inline,
 * so this component never mixes a CSS Module with Tailwind.
 */

export type MarkTileProps = {
  /** Sizing/shape class owned by the calling surface. */
  className?: string;
  /** Tile colour used when there is no image. */
  color: string;
  imageUrl?: string;
  applicationNumber?: string;
};

export default function MarkTile({ className, color, imageUrl, applicationNumber }: MarkTileProps) {
  if (imageUrl) {
    return (
      <div
        className={className}
        style={{ background: '#fff', overflow: 'hidden', padding: 2 }}
      >
        <img
          src={imageUrl}
          alt={deviceImageAlt(applicationNumber)}
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
      </div>
    );
  }

  // No image: the plain delettered tile.
  return <div className={className} style={{ background: color }} aria-hidden="true" />;
}

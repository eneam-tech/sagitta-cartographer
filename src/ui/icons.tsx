import type { SVGProps } from 'react';

export interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

function createIconProps(size = 24, rest: SVGProps<SVGSVGElement>): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    ...rest
  };
}

export function ProjectIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...createIconProps(size, rest)}>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h3.2l2 2.2H17.5A2.5 2.5 0 0 1 20 8.7v8.8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5V6.5Z" />
      <path d="M8.5 13h7" />
      <path d="M8.5 16h4.5" />
    </svg>
  );
}

export function HandIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...createIconProps(size, rest)}>
      <path d="M8.5 12.5V6.8a1.3 1.3 0 0 1 2.6 0v4.2" />
      <path d="M11.1 11V5.2a1.3 1.3 0 0 1 2.6 0V11" />
      <path d="M13.7 11V6.3a1.3 1.3 0 0 1 2.6 0v5.7" />
      <path d="M16.3 11.4V8.8a1.3 1.3 0 0 1 2.6 0v5.6c0 3.3-2.5 5.6-5.9 5.6h-1.4c-2.5 0-4.3-1.4-5.4-3.7l-1.5-3.1a1.35 1.35 0 0 1 2.3-1.4l1.5 1.7Z" />
    </svg>
  );
}

export function SelectIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...createIconProps(size, rest)}>
      <path d="M5.5 4.2 18 11.5l-5.3 1.5-2.6 5.2-4.6-14Z" />
      <path d="m12.7 13 3.8 4.8" />
    </svg>
  );
}

/**
 * Pennello Terra: pennello diagonale con piccolo lembo pieno alla base,
 * progettato per distinguersi nettamente dall'onda Acqua anche in monocromia.
 */
export function LandIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...createIconProps(size, rest)}>
      <path d="m14.8 4.2 4.8 4.8-7.4 7.4-4.8-4.8 7.4-7.4Z" />
      <path d="m12.3 6.7 4.8 4.8" />
      <path
        d="M3.2 19.6c1.5-2.8 4.1-4.1 6.7-3.4 1.9.5 3.1 1.7 4.7 1.7 1.4 0 2.5-.5 3.6-1.3-.9 2.3-3 3.6-6.5 3.6H4.4c-.9 0-1.6-.2-1.2-.6Z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

/**
 * Pennello Acqua: onda arricciata con incisione interna e increspatura inferiore,
 * silhouette complementare ma inconfondibile rispetto a Terra.
 */
export function WaterIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...createIconProps(size, rest)}>
      <path d="M3.5 14.5c1.7-4.5 5.4-7 9.6-6.4 2.5.4 4.1 1.8 3.6 3.5-.4 1.3-1.8 1.8-2.9 1.2-1-.5-1-1.7-.1-2.2" />
      <path d="M12.2 14.8c2.6 0 4.9-.8 7.8-2.3" />
      <path d="M3.8 18.8c2.7-1.6 5.6-1.6 8.3 0 2.7 1.6 5.5 1.6 8.4 0" />
    </svg>
  );
}

/**
 * Rilievo / Elevazione: tre curve di livello topografiche concentriche.
 */
export function ElevationIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...createIconProps(size, rest)}>
      <path d="M3.5 16.2c.8-4.8 4.3-8.7 9-8.7 4.5 0 7.9 3.6 8 8.2-.1 2.2-2 3.3-4.6 3.3-3.1 0-5.1-.9-7.9-.9-2.4 0-4.9-.2-4.5-1.9Z" />
      <path d="M7.1 15.2c.6-2.7 2.6-4.7 5.3-4.7 2.6 0 4.6 1.9 4.7 4.5 0 1.3-1.4 1.8-3.1 1.8-1.9 0-3.3-.6-4.9-.6-1.3 0-2.2-.2-2-1Z" />
      <path d="M10.4 14.3c.3-.9 1.1-1.5 2-1.5 1 0 1.8.6 1.8 1.5s-.8 1.1-1.9 1.1c-1.1 0-2.1-.3-1.9-1.1Z" />
    </svg>
  );
}

/**
 * Copertura: chioma arborea con zolla di terreno alla base.
 */
export function CoverIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...createIconProps(size, rest)}>
      <path d="M12 4.2c-2.6 0-4.5 1.8-4.5 4.2 0 .4.1.8.2 1.2-1.7.5-2.9 2-2.9 3.8 0 2.2 1.8 3.9 4 3.9h6.4c2.2 0 4-1.7 4-3.9 0-1.8-1.2-3.3-2.9-3.8.1-.4.2-.8.2-1.2 0-2.4-1.9-4.2-4.5-4.2Z" />
      <path d="M12 12v7.8" />
      <path d="M5.5 20h13" />
    </svg>
  );
}

/**
 * POI: torre / segnaposto cartografico isolato.
 */
export function PoiIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...createIconProps(size, rest)}>
      <path d="M7.5 20h9" />
      <path d="M9 20V9.5h6V20" />
      <path d="M8 9.5h8l-4-5-4 5Z" />
      <path d="M11 20v-3.5a1 1 0 0 1 2 0V20" />
      <path d="M12 12.2v.6" />
    </svg>
  );
}

/**
 * Testo: lettera A cartografica con grazie essenziali.
 */
export function LabelIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...createIconProps(size, rest)}>
      <path d="M12 4.5 6.2 19.5" />
      <path d="m12 4.5 5.8 15" />
      <path d="M8.3 14.5h7.4" />
      <path d="M4.5 19.5h3.6" />
      <path d="M15.9 19.5h3.6" />
    </svg>
  );
}

export function UndoIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...createIconProps(size, rest)}>
      <path d="M8.5 7.5 4.5 11.5l4 4" />
      <path d="M4.8 11.5h9a5.2 5.2 0 1 1 0 10.4H11" transform="translate(0 -3)" />
    </svg>
  );
}

export function RedoIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...createIconProps(size, rest)}>
      <path d="m15.5 7.5 4 4-4 4" />
      <path d="M19.2 11.5h-9a5.2 5.2 0 1 0 0 10.4H13" transform="translate(0 -3)" />
    </svg>
  );
}

export function ExportPdfIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...createIconProps(size, rest)}>
      <path d="M6.5 3.5h7.5L18.5 8v12.5h-12V3.5Z" />
      <path d="M14 3.5V8h4.5" />
      <path d="M12 11.5v5.5" />
      <path d="m9.5 14.5 2.5 2.5 2.5-2.5" />
    </svg>
  );
}

export function ZoomInIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...createIconProps(size, rest)}>
      <path d="M12 6v12" />
      <path d="M6 12h12" />
    </svg>
  );
}

export function ZoomOutIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...createIconProps(size, rest)}>
      <path d="M6 12h12" />
    </svg>
  );
}

export function FitViewIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...createIconProps(size, rest)}>
      <path d="M4.5 9V5.5A1 1 0 0 1 5.5 4.5H9" />
      <path d="M15 4.5h3.5a1 1 0 0 1 1 1V9" />
      <path d="M19.5 15v3.5a1 1 0 0 1-1 1H15" />
      <path d="M9 19.5H5.5a1 1 0 0 1-1-1V15" />
      <rect x="8.5" y="8.5" width="7" height="7" rx="0.5" />
    </svg>
  );
}

export function CheckSavedIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...createIconProps(size, rest)}>
      <path d="m5.5 12.5 4.2 4.2 8.8-9.2" />
    </svg>
  );
}

export function AlertErrorIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...createIconProps(size, rest)}>
      <path d="M12 4.2 3.8 18.8a1.2 1.2 0 0 0 1 1.8h14.4a1.2 1.2 0 0 0 1-1.8L12 4.2Z" />
      <path d="M12 10v4.2" />
      <path d="M12 17.2v.4" />
    </svg>
  );
}

export function CloseIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...createIconProps(size, rest)}>
      <path d="M6.5 6.5 17.5 17.5" />
      <path d="M17.5 6.5 6.5 17.5" />
    </svg>
  );
}

export function PropertiesIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...createIconProps(size, rest)}>
      <rect x="4" y="4.5" width="16" height="15" rx="2" />
      <path d="M14.5 4.5v15" />
      <path d="M7.5 9.5h3.5" />
      <path d="M7.5 13.5h3.5" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...createIconProps(size, rest)}>
      <path d="m7 9.5 5 5 5-5" />
    </svg>
  );
}

/**
 * Fiumi e Strade: tracciato sinuoso con diramazione ed estremi di controllo.
 */
export function PathIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...createIconProps(size, rest)}>
      <path d="M4.8 18.5c2.2-4 3.4-6.8 7-6 3.5.8 4.3-3.4 7.4-7" />
      <path d="M12.2 12.6c1.4 1.6 3.3 2.4 6.2 2.4" />
      <circle cx="4.8" cy="18.5" r="1.4" />
      <circle cx="19.2" cy="5.5" r="1.4" />
    </svg>
  );
}

export function ResizeCanvasIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...createIconProps(size, rest)}>
      <path d="M4.5 9V5.5a1 1 0 0 1 1-1H9" />
      <path d="M15 4.5h3.5a1 1 0 0 1 1 1V9" />
      <path d="M19.5 15v3.5a1 1 0 0 1-1 1H15" />
      <path d="M9 19.5H5.5a1 1 0 0 1-1-1V15" />
      <path d="m9.5 14.5 5-5" />
      <path d="M11.5 9.5h3v3" />
      <path d="M12.5 14.5h-3v-3" />
    </svg>
  );
}

export function ThemePaletteIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...createIconProps(size, rest)}>
      <path d="M12 3.8a8.2 8.2 0 1 0 0 16.4h1.3a1.7 1.7 0 0 0 1.3-2.8l-.2-.3a1.5 1.5 0 0 1 1.2-2.4h2a4.3 4.3 0 0 0 4.3-4.3A8.2 8.2 0 0 0 12 3.8Z" />
      <circle cx="8.5" cy="10" r="1" />
      <circle cx="12" cy="7.8" r="1" />
      <circle cx="15.8" cy="9.8" r="1" />
      <circle cx="8.8" cy="14.2" r="1" />
    </svg>
  );
}

export function ShortcutsIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...createIconProps(size, rest)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.5 9.4a2.6 2.6 0 0 1 5 .8c0 1.6-2.5 2.1-2.5 3.6" />
      <path d="M12 16.8v.4" />
    </svg>
  );
}

export function SwapOrientationIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...createIconProps(size, rest)}>
      <path d="M7.5 18.5v-13" />
      <path d="m4.5 8.5 3-3 3 3" />
      <path d="M16.5 5.5v13" />
      <path d="m13.5 15.5 3 3 3-3" />
    </svg>
  );
}

export function LockClosedIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...createIconProps(size, rest)}>
      <rect x="5.5" y="11" width="13" height="9" rx="2" />
      <path d="M8.5 11V8a3.5 3.5 0 1 1 7 0v3" />
    </svg>
  );
}

export function RaiseIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...createIconProps(size, rest)}>
      <path d="M4.5 18.5 12 7l7.5 11.5" />
      <path d="M12 12v6.5" />
      <path d="m9.5 14.5 2.5-2.5 2.5 2.5" />
    </svg>
  );
}

export function LowerIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...createIconProps(size, rest)}>
      <path d="M4.5 6.5 12 18l7.5-11.5" />
      <path d="M12 5.5V12" />
      <path d="m9.5 9.5 2.5 2.5 2.5-2.5" />
    </svg>
  );
}

export function FlattenIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...createIconProps(size, rest)}>
      <path d="M4.5 12h15" />
      <path d="M12 4.8v4.4" />
      <path d="m9.5 6.8 2.5 2.4 2.5-2.4" />
      <path d="M12 19.2v-4.4" />
      <path d="m9.5 17.2 2.5-2.4 2.5 2.4" />
    </svg>
  );
}

export function SmoothIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...createIconProps(size, rest)}>
      <path d="M4 15.5c2.5-4.5 5-4.5 8 0s5.5 4.5 8 0" />
      <path d="M4 9.5c2.5-2.8 5-2.8 8 0s5.5 2.8 8 0" />
    </svg>
  );
}

export function PlateauIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...createIconProps(size, rest)}>
      <path d="M3.5 18.5 8 10h8l4.5 8.5" />
      <path d="M7.5 10h9" />
      <path d="M6.5 14.5h11" opacity="0.55" />
    </svg>
  );
}

export function GenerateWorldIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...createIconProps(size, rest)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M5 10.5c2.2-1.2 4.3.6 5.8-.5 1.3-.9 1.6-2.7 3.4-2.8 1.5-.1 2.7 1.2 4.3 1.4" />
      <path d="M6 15.8c2-.8 3.6.9 5.6.2 1.8-.6 2.5-2.2 4.7-1.9" />
      <path d="m12 2.2.8 1.5 1.5.8-1.5.8L12 6.8l-.8-1.5-1.5-.8 1.5-.8z" />
    </svg>
  );
}

export function ApplePencilIcon({ size = 24, ...rest }: IconProps) {
  return (
    <svg {...createIconProps(size, rest)}>
      <path d="m4.2 19.8 1.3-4.3L16.7 4.3a2.1 2.1 0 0 1 3 3L8.5 18.5l-4.3 1.3Z" />
      <path d="m14.8 6.2 3 3" />
      <path d="m5.5 15.5 3 3" />
    </svg>
  );
}

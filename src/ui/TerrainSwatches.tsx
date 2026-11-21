import { COVER_MATERIALS, CoverToolId } from '../model/document';
import { CoverSubTool } from '../state/editorStore';
import { ThemeColors } from '../theme/theme';

export interface BrushPreviewSwatchProps {
  tool: 'land' | 'water';
  diameterDoc: number;
  colors: ThemeColors;
}

export function BrushPreviewSwatch({ tool, diameterDoc, colors }: BrushPreviewSwatchProps) {
  // Mappa il diametro 10..400 u a un raggio visivo proporzionale dentro il campione 248×72
  const normalized = Math.max(0, Math.min(1, (diameterDoc - 10) / 390));
  const previewRadius = 5 + normalized * 23;
  const isLand = tool === 'land';

  return (
    <div
      className="swatch-frame"
      aria-label={`Campione pennello ${isLand ? 'Terra' : 'Acqua'}, diametro ${diameterDoc} unità`}
    >
      <svg className="swatch-svg" viewBox="0 0 248 72" width="248" height="72" aria-hidden="true">
        <rect x="0" y="0" width="248" height="72" fill={colors.sea} />
        <path
          d="M0 16 C42 12, 72 48, 118 42 C156 37, 178 14, 248 22 L248 72 L0 72 Z"
          fill={colors.land}
          stroke={colors.ink}
          strokeWidth="1.6"
        />
        <path
          d="M0 24 C44 20, 74 54, 120 48 C158 43, 180 20, 248 28"
          fill="none"
          stroke={colors.seaBathymetry}
          strokeWidth="1"
          strokeDasharray="3 3"
          opacity="0.7"
        />
        <circle
          cx="124"
          cy="36"
          r={previewRadius}
          fill={isLand ? colors.land : colors.sea}
          fillOpacity={0.82}
          stroke={colors.ink}
          strokeWidth="1.2"
          strokeDasharray="3 2"
        />
        <circle
          cx="124"
          cy="36"
          r={previewRadius}
          fill="none"
          stroke="#17232D"
          strokeWidth="3"
        />
        <circle
          cx="124"
          cy="36"
          r={previewRadius}
          fill="none"
          stroke="#F3EEDF"
          strokeWidth="1.4"
        />
      </svg>
      <div className="swatch-caption">
        <span>{isLand ? 'Aggiunge terra emersa' : 'Scava mare e azzera quota'}</span>
        <span className="tabular-nums">{diameterDoc} u</span>
      </div>
    </div>
  );
}

export interface BrushDiameterFeedbackProps {
  diameterDoc: number;
  caption?: string;
}

/**
 * Circular proportional scale indicator for terrain brush diameters (`10–400 u`).
 */
export function BrushDiameterFeedback({
  diameterDoc,
  caption = 'Scala pennello'
}: BrushDiameterFeedbackProps) {
  const normalized = Math.max(0, Math.min(1, (diameterDoc - 10) / 390));
  const previewRadius = 2.5 + normalized * 18.5;

  return (
    <div
      className="brush-scale-feedback"
      aria-label={`${caption}: diametro ${diameterDoc} unità`}
    >
      <svg
        className="brush-scale-svg"
        viewBox="0 0 48 48"
        width="48"
        height="48"
        aria-hidden="true"
      >
        <rect x="0" y="0" width="48" height="48" rx="4" fill="#17232D" />
        <path
          d="M24 4v40M4 24h40"
          stroke="rgba(129, 147, 154, 0.25)"
          strokeWidth="1"
        />
        <circle
          cx="24"
          cy="24"
          r={previewRadius}
          fill="rgba(224, 187, 121, 0.16)"
          stroke="#E0BB79"
          strokeWidth="1.5"
        />
        <circle cx="24" cy="24" r="1.5" fill="#F3EEDF" />
      </svg>
      <div className="brush-scale-meta">
        <span className="brush-scale-title">{caption}</span>
        <span className="brush-scale-sub tabular-nums">
          Diametro {diameterDoc} u · raggio {Math.round(diameterDoc / 2)} u
        </span>
      </div>
    </div>
  );
}

export interface ElevationBandSwatchProps {
  colors: ThemeColors;
}

export function ElevationBandSwatch({ colors }: ElevationBandSwatchProps) {
  return (
    <div
      className="swatch-frame"
      aria-label="Campione delle quattro fasce altimetriche: spiaggia, pianura, collina, montagna"
    >
      <svg className="swatch-svg" viewBox="0 0 248 76" width="248" height="76" aria-hidden="true">
        <rect x="0" y="0" width="248" height="76" fill={colors.sea} />
        <path
          d="M22 76 C26 52, 24 24, 30 0 L248 0 L248 76 Z"
          fill={colors.beach}
          stroke={colors.ink}
          strokeWidth="1.6"
        />
        <path
          d="M66 76 C70 50, 64 26, 72 0 L248 0 L248 76 Z"
          fill={colors.land}
        />
        <path
          d="M124 76 C132 54, 122 24, 132 0 L248 0 L248 76 Z"
          fill={colors.hill}
        />
        <path
          d="M134 56 Q152 44 166 56 M142 30 Q158 18 172 30"
          fill="none"
          stroke={colors.stone}
          strokeWidth="1.4"
          strokeLinecap="round"
          opacity="0.6"
        />
        <path
          d="M180 76 L192 48 L186 22 L198 0 L248 0 L248 76 Z"
          fill={colors.mountain}
        />
        <path
          d="M214 14 L232 36 L216 58 L234 72 L248 72 L248 14 Z"
          fill={colors.stone}
          opacity="0.48"
        />
        <path
          d="M196 58 L214 14 L204 38 L220 52 L206 70"
          fill="none"
          stroke={colors.mountainCrest}
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="elevation-legend">
        <span>Spiaggia</span>
        <span>Pianura</span>
        <span>Collina</span>
        <span>Montagna</span>
      </div>
    </div>
  );
}

function renderMaterialIllustration(tool: CoverToolId, colors: ThemeColors) {
  switch (tool) {
    case 'natural':
      return (
        <>
          <rect x="0" y="0" width="116" height="48" fill={colors.sea} />
          <path
            d="M0 38 C28 32, 62 39, 116 33 L116 0 L0 0 Z"
            fill={colors.beach}
            stroke={colors.ink}
            strokeWidth="1.4"
          />
          <path
            d="M0 31 C30 26, 66 32, 116 25 L116 0 L0 0 Z"
            fill={colors.land}
          />
          <path
            d="M54 0 C66 13, 84 20, 116 14 L116 0 Z"
            fill={colors.hill}
          />
          <path
            d="M66 9 Q84 16 104 9"
            fill="none"
            stroke={colors.stone}
            strokeWidth="1.2"
            strokeLinecap="round"
            opacity="0.55"
          />
        </>
      );
    case 'forest':
      return (
        <>
          <rect x="0" y="0" width="116" height="48" fill={colors.land} />
          <path d="M0 48 C34 36, 74 42, 116 32 L116 48 Z" fill={colors.hill} opacity="0.5" />
          <circle cx="20" cy="24" r="10" fill={colors.forestShadow} />
          <circle cx="18" cy="22" r="9" fill={colors.forest} />
          <circle cx="38" cy="18" r="11" fill={colors.forestShadow} />
          <circle cx="36" cy="16" r="10" fill={colors.forest} />
          <circle cx="58" cy="27" r="10" fill={colors.forestShadow} />
          <circle cx="56" cy="25" r="9" fill={colors.forest} />
          <circle cx="78" cy="17" r="11" fill={colors.forestShadow} />
          <circle cx="76" cy="15" r="9.5" fill={colors.forest} />
          <circle cx="98" cy="25" r="9.5" fill={colors.forestShadow} />
          <circle cx="96" cy="23" r="8.5" fill={colors.forest} />
        </>
      );
    case 'fields':
      return (
        <>
          <rect x="0" y="0" width="116" height="48" fill={colors.land} />
          <rect x="8" y="8" width="44" height="32" rx="2" fill={colors.fields} />
          <path
            d="M13 15h34M13 21h34M13 27h34M13 33h34"
            stroke={colors.fieldsFurrow}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <rect x="60" y="8" width="48" height="32" rx="2" fill={colors.fields} />
          <path
            d="M68 13v22M76 13v22M84 13v22M92 13v22M100 13v22"
            stroke={colors.fieldsFurrow}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      );
    case 'meadow':
      return (
        <>
          <rect x="0" y="0" width="116" height="48" fill={colors.meadow} />
          <path
            d="M0 32 C32 22, 68 38, 116 26 L116 48 L0 48 Z"
            fill={colors.land}
            opacity="0.22"
          />
          <path
            d="M16 32l-3-7M19 32l1-9M22 32l4-7M48 23l-3-7M51 23l1-8M54 23l3-6M82 34l-3-7M85 34l1-9M88 34l4-7M99 19l-2-6M102 19l1-7M105 19l3-6"
            stroke={colors.meadowAccent}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </>
      );
    case 'sand':
      return (
        <>
          <rect x="0" y="0" width="116" height="48" fill={colors.sand} />
          <path
            d="M0 18 Q28 7 58 20 T116 14 L116 48 L0 48 Z"
            fill={colors.sandShadow}
            opacity="0.68"
          />
          <path
            d="M0 34 Q36 22 72 34 T116 28 L116 48 L0 48 Z"
            fill={colors.sand}
          />
          <path
            d="M0 18 Q28 7 58 20 T116 14"
            fill="none"
            stroke={colors.beach}
            strokeWidth="1.3"
          />
        </>
      );
    case 'rock':
      return (
        <>
          <rect x="0" y="0" width="116" height="48" fill={colors.rock} />
          <polygon points="8,44 28,12 52,22 66,44" fill={colors.rockShadow} opacity="0.65" />
          <polygon points="48,44 74,8 98,18 112,44" fill={colors.rockShadow} opacity="0.8" />
          <path
            d="M28 12 L42 36 M74 8 L86 38 M28 12 L16 28"
            stroke={colors.mountainCrest}
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.7"
          />
        </>
      );
    case 'snow':
      return (
        <>
          <rect x="0" y="0" width="116" height="48" fill={colors.snow} />
          <path
            d="M0 24 C26 14, 52 28, 78 16 C94 10, 106 14, 116 20 L116 48 L0 48 Z"
            fill={colors.snowShadow}
            opacity="0.7"
          />
          <path
            d="M0 36 C32 28, 74 42, 116 32 L116 48 L0 48 Z"
            fill={colors.snow}
          />
          <path
            d="M24 14l4 4M28 14l-4 4M86 24l4 4M90 24l-4 4"
            stroke={colors.rock}
            strokeWidth="1.2"
            strokeLinecap="round"
            opacity="0.45"
          />
        </>
      );
    case 'swamp':
      return (
        <>
          <rect x="0" y="0" width="116" height="48" fill={colors.swamp} />
          <ellipse cx="38" cy="30" rx="22" ry="9" fill={colors.swampWater} />
          <ellipse cx="86" cy="20" rx="19" ry="8" fill={colors.swampWater} />
          <path
            d="M18 32V16M23 33V19M70 28V12M75 29V15M98 38V23M103 39V26"
            stroke={colors.forestShadow}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </>
      );
    case 'brick':
      return (
        <>
          <rect x="0" y="0" width="116" height="48" fill={colors.brickMortar} />
          <rect x="4" y="4" width="32" height="11" rx="1.5" fill={colors.brick} />
          <rect x="40" y="4" width="34" height="11" rx="1.5" fill={colors.brick} />
          <rect x="78" y="4" width="34" height="11" rx="1.5" fill={colors.brick} />
          <rect x="4" y="19" width="16" height="11" rx="1.5" fill={colors.brick} opacity="0.92" />
          <rect x="24" y="19" width="34" height="11" rx="1.5" fill={colors.brick} />
          <rect x="62" y="19" width="32" height="11" rx="1.5" fill={colors.brick} opacity="0.88" />
          <rect x="98" y="19" width="14" height="11" rx="1.5" fill={colors.brick} />
          <rect x="4" y="34" width="34" height="10" rx="1.5" fill={colors.brick} />
          <rect x="42" y="34" width="32" height="10" rx="1.5" fill={colors.brick} opacity="0.92" />
          <rect x="78" y="34" width="34" height="10" rx="1.5" fill={colors.brick} />
        </>
      );
    case 'lava':
      return (
        <>
          <rect x="0" y="0" width="116" height="48" fill={colors.rockShadow} />
          <path
            d="M6 42 C24 30, 38 34, 54 22 C70 10, 86 18, 110 6"
            fill="none"
            stroke={colors.lava}
            strokeWidth="7"
            strokeLinecap="round"
          />
          <path
            d="M54 22 C66 28, 82 32, 96 44"
            fill="none"
            stroke={colors.lava}
            strokeWidth="5"
            strokeLinecap="round"
          />
          <path
            d="M6 42 C24 30, 38 34, 54 22 C70 10, 86 18, 110 6 M54 22 C66 28, 82 32, 96 44"
            fill="none"
            stroke={colors.lavaGlow}
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </>
      );
  }
}

export interface CoverSurfaceSwatchProps {
  activeCover: CoverSubTool;
  onSelectCover: (tool: CoverSubTool) => void;
  colors: ThemeColors;
}

/**
 * 2-column grid of all 10 cartographic cover materials (`COVER_MATERIALS` 0..9)
 * rendered with miniature theme-faithful procedural swatches and clear description.
 */
export function CoverSurfaceSwatch({
  activeCover,
  onSelectCover,
  colors
}: CoverSurfaceSwatchProps) {
  const activeMaterial =
    COVER_MATERIALS.find((m) => m.tool === activeCover) ?? COVER_MATERIALS[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ui-space-2)' }}>
      <div
        className="cover-swatch-grid"
        role="group"
        aria-label="Materiali di copertura"
      >
        {COVER_MATERIALS.map((material) => {
          const isSelected = activeCover === material.tool;
          return (
            <button
              key={material.tool}
              type="button"
              className="cover-swatch-card cover-swatch-card--tile"
              aria-pressed={isSelected}
              aria-label={`${material.label} — ${material.description}`}
              title={material.description}
              onClick={() => onSelectCover(material.tool)}
            >
              <div className="cover-swatch-thumb">
                <svg
                  className="swatch-svg"
                  viewBox="0 0 116 48"
                  width="116"
                  height="48"
                  aria-hidden="true"
                >
                  {renderMaterialIllustration(material.tool, colors)}
                </svg>
                {isSelected ? (
                  <span className="cover-swatch-active-dot" aria-hidden="true" />
                ) : null}
              </div>
              <div className="cover-swatch-meta cover-swatch-meta--compact">
                <span className="cover-swatch-name">{material.label}</span>
              </div>
            </button>
          );
        })}
      </div>

      <p className="panel-hint" role="status" aria-live="polite">
        <strong style={{ color: 'var(--ui-text)' }}>{activeMaterial.label}:</strong>{' '}
        {activeMaterial.description}
      </p>
    </div>
  );
}

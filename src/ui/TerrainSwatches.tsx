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
    <div className="swatch-frame" aria-label={`Campione pennello ${isLand ? 'Terra' : 'Acqua'}, diametro ${diameterDoc} unità`}>
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
        {/* Impronta indicativa del tratto */}
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

export interface ElevationBandSwatchProps {
  colors: ThemeColors;
}

export function ElevationBandSwatch({ colors }: ElevationBandSwatchProps) {
  return (
    <div className="swatch-frame" aria-label="Campione delle quattro fasce altimetriche: spiaggia, pianura, collina, montagna">
      <svg className="swatch-svg" viewBox="0 0 248 76" width="248" height="76" aria-hidden="true">
        {/* Mare a sinistra e battigia */}
        <rect x="0" y="0" width="248" height="76" fill={colors.sea} />
        {/* Spiaggia */}
        <path
          d="M22 76 C26 52, 24 24, 30 0 L248 0 L248 76 Z"
          fill={colors.beach}
          stroke={colors.ink}
          strokeWidth="1.6"
        />
        {/* Pianura */}
        <path
          d="M66 76 C70 50, 64 26, 72 0 L248 0 L248 76 Z"
          fill={colors.land}
        />
        {/* Collina con morbide curve di livello e ombra da NO */}
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
        {/* Montagna e creste illuminate */}
        <path
          d="M180 76 L192 48 L186 22 L198 0 L248 0 L248 76 Z"
          fill={colors.mountain}
        />
        {/* Versante in ombra (sud-est) */}
        <path
          d="M214 14 L232 36 L216 58 L234 72 L248 72 L248 14 Z"
          fill={colors.stone}
          opacity="0.48"
        />
        {/* Creste illuminate (luce da nord-ovest) */}
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

export interface CoverSurfaceSwatchProps {
  activeCover: CoverSubTool;
  onSelectCover: (tool: CoverSubTool) => void;
  colors: ThemeColors;
}

const COVER_OPTIONS: readonly {
  id: CoverSubTool;
  label: string;
  hint: string;
}[] = [
  { id: 'forest', label: 'Foresta', hint: 'Chiome fitte in piano, rade sui pendii' },
  { id: 'fields', label: 'Campi', hint: 'Solchi e parcelle lungo le curve del terreno' },
  { id: 'natural', label: 'Naturale', hint: 'Riaffiora il rilievo sottostante' }
] as const;

export function CoverSurfaceSwatch({ activeCover, onSelectCover, colors }: CoverSurfaceSwatchProps) {
  return (
    <div className="cover-swatch-list" role="group" aria-label="Materiali di copertura">
      {COVER_OPTIONS.map((option) => {
        const isSelected = activeCover === option.id;
        return (
          <button
            key={option.id}
            type="button"
            className="cover-swatch-card"
            aria-pressed={isSelected}
            onClick={() => onSelectCover(option.id)}
          >
            <svg className="swatch-svg" viewBox="0 0 248 56" width="248" height="56" aria-hidden="true">
              {/* Base rilievo condivisa con battigia leggibile */}
              <rect x="0" y="0" width="248" height="56" fill={colors.sea} />
              <path
                d="M0 44 C48 38, 108 46, 168 42 C206 39, 228 43, 248 40 L248 0 L0 0 Z"
                fill={colors.beach}
                stroke={colors.ink}
                strokeWidth="1.5"
              />
              <path
                d="M0 37 C52 32, 110 40, 170 35 C208 32, 230 36, 248 33 L248 0 L0 0 Z"
                fill={colors.land}
              />
              <path
                d="M118 0 C134 14, 152 24, 186 24 C216 24, 232 14, 248 8 L248 0 Z"
                fill={colors.hill}
              />

              {option.id === 'forest' && (
                <g>
                  {/* Chiome raccolte in pianura con aperture verso il pendio */}
                  <circle cx="32" cy="22" r="9" fill={colors.forestShadow} />
                  <circle cx="30" cy="20" r="8" fill={colors.forest} />
                  <circle cx="46" cy="18" r="10" fill={colors.forestShadow} />
                  <circle cx="44" cy="16" r="9" fill={colors.forest} />
                  <circle cx="62" cy="24" r="9" fill={colors.forestShadow} />
                  <circle cx="60" cy="22" r="8" fill={colors.forest} />
                  <circle cx="80" cy="17" r="10" fill={colors.forestShadow} />
                  <circle cx="78" cy="15" r="9" fill={colors.forest} />
                  <circle cx="96" cy="25" r="8" fill={colors.forestShadow} />
                  <circle cx="94" cy="23" r="7" fill={colors.forest} />
                  {/* Chiome più rade sul versante di collina */}
                  <circle cx="148" cy="14" r="7" fill={colors.forestShadow} />
                  <circle cx="146" cy="12" r="6" fill={colors.forest} />
                  <circle cx="176" cy="17" r="6.5" fill={colors.forestShadow} />
                  <circle cx="175" cy="15" r="5.5" fill={colors.forest} />
                  <circle cx="212" cy="12" r="6" fill={colors.forestShadow} />
                  <circle cx="210" cy="10" r="5" fill={colors.forest} />
                </g>
              )}

              {option.id === 'fields' && (
                <g>
                  {/* Parcelle coltivate in pianura e solchi che seguono la collina */}
                  <rect x="20" y="10" width="44" height="20" rx="2" fill={colors.fields} />
                  <path
                    d="M24 14h36M24 19h36M24 24h36"
                    stroke={colors.fieldsFurrow}
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                  <rect x="72" y="12" width="40" height="19" rx="2" fill={colors.fields} />
                  <path
                    d="M78 15v13M85 15v13M92 15v13M99 15v13M106 15v13"
                    stroke={colors.fieldsFurrow}
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                  {/* Solchi lungo il fianco della collina */}
                  <path
                    d="M128 10 Q158 20 194 18 M134 15 Q162 24 198 22"
                    fill="none"
                    stroke={colors.fieldsFurrow}
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </g>
              )}

              {option.id === 'natural' && (
                <g>
                  {/* Curve morbide del rilievo senza copertura */}
                  <path
                    d="M148 11 Q174 20 212 13 M164 6 Q188 13 222 7"
                    fill="none"
                    stroke={colors.stone}
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    opacity="0.55"
                  />
                </g>
              )}
            </svg>
            <div className="cover-swatch-meta">
              <span>{option.label}</span>
              {isSelected ? <span className="cover-swatch-tag">Attivo</span> : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}

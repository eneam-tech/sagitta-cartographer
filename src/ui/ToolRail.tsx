import { useCallback, useId, useState } from 'react';
import type { FocusEvent, MouseEvent, ReactNode } from 'react';
import { COVER_MATERIALS } from '../model/document';
import { EditorSnapshot, EditorStore, useEditorStore } from '../state/editorStore';
import {
  BuildingIcon,
  CityWallIcon,
  CoverIcon,
  DistrictIcon,
  ElevationIcon,
  HandIcon,
  LabelIcon,
  LandIcon,
  PathIcon,
  PlazaIcon,
  PoiIcon,
  SelectIcon,
  StreetGridIcon,
  WaterIcon
} from './icons';

export interface ToolRailProps {
  store: EditorStore;
}

interface ToolDef {
  id: string;
  label: string;
  shortcut: string;
  isActive: (snap: EditorSnapshot) => boolean;
  onSelect: (store: EditorStore) => void;
  icon: ReactNode;
  dividerAfter?: boolean;
}

const COVER_TOOL_SET = new Set<string>(COVER_MATERIALS.map((m) => m.tool));

const TOOL_DEFS: readonly ToolDef[] = [
  {
    id: 'hand',
    label: 'Mano',
    shortcut: 'H',
    isActive: (s) => s.activeTool === 'hand' || s.spacePanActive,
    onSelect: (store) => store.setTool('hand'),
    icon: <HandIcon />
  },
  {
    id: 'select',
    label: 'Selezione',
    shortcut: 'V',
    isActive: (s) => !s.spacePanActive && s.activeTool === 'select',
    onSelect: (store) => store.setTool('select'),
    icon: <SelectIcon />,
    dividerAfter: true
  },
  {
    id: 'land',
    label: 'Terra',
    shortcut: 'B',
    isActive: (s) => !s.spacePanActive && s.activeTool === 'land',
    onSelect: (store) => store.setTool('land'),
    icon: <LandIcon />
  },
  {
    id: 'water',
    label: 'Acqua',
    shortcut: 'W',
    isActive: (s) => !s.spacePanActive && s.activeTool === 'water',
    onSelect: (store) => store.setTool('water'),
    icon: <WaterIcon />
  },
  {
    id: 'elevation',
    label: 'Rilievo',
    shortcut: 'E',
    isActive: (s) =>
      !s.spacePanActive &&
      (s.activeTool === 'raise' ||
        s.activeTool === 'plateau' ||
        s.activeTool === 'lower' ||
        s.activeTool === 'flatten' ||
        s.activeTool === 'smooth'),
    onSelect: (store) => store.selectElevationGroup(),
    icon: <ElevationIcon />
  },
  {
    id: 'cover',
    label: 'Superfici',
    shortcut: 'C',
    isActive: (s) => !s.spacePanActive && COVER_TOOL_SET.has(s.activeTool),
    onSelect: (store) => store.selectCoverGroup(),
    icon: <CoverIcon />,
    dividerAfter: true
  },
  {
    id: 'path',
    label: 'Fiumi e Strade',
    shortcut: 'R',
    isActive: (s) => !s.spacePanActive && s.activeTool === 'path',
    onSelect: (store) => store.setTool('path'),
    icon: <PathIcon />
  },
  {
    id: 'poi',
    label: 'POI',
    shortcut: 'P',
    isActive: (s) => !s.spacePanActive && s.activeTool === 'poi',
    onSelect: (store) => store.setTool('poi'),
    icon: <PoiIcon />
  },
  {
    id: 'label',
    label: 'Testo',
    shortcut: 'T',
    isActive: (s) => !s.spacePanActive && s.activeTool === 'label',
    onSelect: (store) => store.setTool('label'),
    icon: <LabelIcon />
  }
];

const CITY_TOOL_DEFS: readonly ToolDef[] = [
  {
    id: 'hand',
    label: 'Mano',
    shortcut: 'H',
    isActive: (s) => s.activeTool === 'hand' || s.spacePanActive,
    onSelect: (store) => store.setTool('hand'),
    icon: <HandIcon />
  },
  {
    id: 'select',
    label: 'Selezione',
    shortcut: 'V',
    isActive: (s) => !s.spacePanActive && s.activeTool === 'select',
    onSelect: (store) => store.setTool('select'),
    icon: <SelectIcon />,
    dividerAfter: true
  },
  {
    id: 'district',
    label: 'Quartiere intelligente',
    shortcut: 'Q',
    isActive: (s) => !s.spacePanActive && s.activeTool === 'district',
    onSelect: (store) => store.setTool('district'),
    icon: <DistrictIcon />
  },
  {
    id: 'building',
    label: 'Edificio',
    shortcut: 'U',
    isActive: (s) => !s.spacePanActive && s.activeTool === 'building',
    onSelect: (store) => store.setTool('building'),
    icon: <BuildingIcon />
  },
  {
    id: 'street',
    label: 'Strade',
    shortcut: 'R',
    isActive: (s) => !s.spacePanActive && s.activeTool === 'street',
    onSelect: (store) => store.setTool('street'),
    icon: <PathIcon />
  },
  {
    id: 'streetGrid',
    label: 'Griglia stradale',
    shortcut: 'G',
    isActive: (s) => !s.spacePanActive && s.activeTool === 'streetGrid',
    onSelect: (store) => store.setTool('streetGrid'),
    icon: <StreetGridIcon />
  },
  {
    id: 'plaza',
    label: 'Piazza',
    shortcut: 'K',
    isActive: (s) => !s.spacePanActive && s.activeTool === 'plaza',
    onSelect: (store) => store.setTool('plaza'),
    icon: <PlazaIcon />
  },
  {
    id: 'cityWall',
    label: 'Mura cittadine',
    shortcut: 'M',
    isActive: (s) => !s.spacePanActive && s.activeTool === 'cityWall',
    onSelect: (store) => store.setTool('cityWall'),
    icon: <CityWallIcon />,
    dividerAfter: true
  },
  {
    id: 'water',
    label: 'Acqua e Suolo',
    shortcut: 'W',
    isActive: (s) => !s.spacePanActive && (s.activeTool === 'water' || s.activeTool === 'land'),
    onSelect: (store) => store.setTool('water'),
    icon: <WaterIcon />
  },
  {
    id: 'cover',
    label: 'Superfici',
    shortcut: 'C',
    isActive: (s) => !s.spacePanActive && COVER_TOOL_SET.has(s.activeTool),
    onSelect: (store) => store.selectCoverGroup(),
    icon: <CoverIcon />
  },
  {
    id: 'poi',
    label: 'POI',
    shortcut: 'P',
    isActive: (s) => !s.spacePanActive && s.activeTool === 'poi',
    onSelect: (store) => store.setTool('poi'),
    icon: <PoiIcon />
  },
  {
    id: 'label',
    label: 'Testo',
    shortcut: 'T',
    isActive: (s) => !s.spacePanActive && s.activeTool === 'label',
    onSelect: (store) => store.setTool('label'),
    icon: <LabelIcon />
  }
];

interface ActiveTooltip {
  id: string;
  label: string;
  shortcut: string;
  top: number;
  left: number;
}

export function ToolRail({ store }: ToolRailProps) {
  const snap = useEditorStore(store);
  const tooltipDomId = useId();
  const [tooltip, setTooltip] = useState<ActiveTooltip | null>(null);
  const isCity = snap.doc.manifest.kind === 'city';
  const visibleTools = isCity ? CITY_TOOL_DEFS : TOOL_DEFS;

  const showTooltipForButton = useCallback((el: HTMLButtonElement, tool: ToolDef) => {
    const rect = el.getBoundingClientRect();
    const isCompact = typeof window !== 'undefined' && window.innerWidth < 760;
    if (isCompact) {
      const clampedLeft = Math.max(8, Math.min((window.innerWidth || 390) - 140, rect.left));
      setTooltip({
        id: tool.id,
        label: tool.label,
        shortcut: tool.shortcut,
        top: rect.bottom + 8,
        left: clampedLeft
      });
    } else {
      setTooltip({
        id: tool.id,
        label: tool.label,
        shortcut: tool.shortcut,
        top: rect.top + rect.height / 2 - 14,
        left: rect.right + 10
      });
    }
  }, []);

  const hideTooltip = useCallback((toolId: string) => {
    setTooltip((prev) => (prev?.id === toolId ? null : prev));
  }, []);

  const handleMouseEnter = (e: MouseEvent<HTMLButtonElement>, tool: ToolDef) => {
    showTooltipForButton(e.currentTarget, tool);
  };

  const handleFocus = (e: FocusEvent<HTMLButtonElement>, tool: ToolDef) => {
    let focusVisible = true;
    try {
      focusVisible = e.currentTarget.matches(':focus-visible');
    } catch {
      focusVisible = true;
    }
    if (focusVisible) {
      showTooltipForButton(e.currentTarget, tool);
    }
  };

  return (
    <nav
      className="editor-rail"
      role="toolbar"
      aria-label={isCity ? 'Strumenti cartografia urbana' : 'Strumenti cartografici'}
    >
      {visibleTools.map((tool) => {
        const active = tool.isActive(snap);
        const describedBy = tooltip?.id === tool.id ? tooltipDomId : undefined;
        return (
          <div key={tool.id} style={{ display: 'contents' }}>
            <button
              type="button"
              className="tool-btn"
              aria-pressed={active}
              aria-label={`${tool.label} (${tool.shortcut})`}
              aria-describedby={describedBy}
              onClick={() => tool.onSelect(store)}
              onMouseEnter={(e) => handleMouseEnter(e, tool)}
              onMouseLeave={() => hideTooltip(tool.id)}
              onFocus={(e) => handleFocus(e, tool)}
              onBlur={() => hideTooltip(tool.id)}
            >
              {tool.icon}
            </button>
            {tool.dividerAfter ? <div className="tool-rail-divider" role="separator" /> : null}
          </div>
        );
      })}

      {tooltip ? (
        <div
          id={tooltipDomId}
          role="tooltip"
          className="tool-tooltip"
          style={{ top: `${tooltip.top}px`, left: `${tooltip.left}px` }}
        >
          <span>{tooltip.label}</span>
          <span className="tool-tooltip-kbd">{tooltip.shortcut}</span>
        </div>
      ) : null}
    </nav>
  );
}

import { useCallback, useId, useState } from 'react';
import type { FocusEvent, MouseEvent, ReactNode } from 'react';
import { EditorSnapshot, EditorStore, useEditorStore } from '../state/editorStore';
import {
  CoverIcon,
  ElevationIcon,
  HandIcon,
  LabelIcon,
  LandIcon,
  PoiIcon,
  SelectIcon,
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
    isActive: (s) => !s.spacePanActive && (s.activeTool === 'raise' || s.activeTool === 'lower'),
    onSelect: (store) => store.selectElevationGroup(),
    icon: <ElevationIcon />
  },
  {
    id: 'cover',
    label: 'Copertura',
    shortcut: 'C',
    isActive: (s) =>
      !s.spacePanActive &&
      (s.activeTool === 'forest' || s.activeTool === 'fields' || s.activeTool === 'natural'),
    onSelect: (store) => store.selectCoverGroup(),
    icon: <CoverIcon />,
    dividerAfter: true
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
    <nav className="editor-rail" role="toolbar" aria-label="Strumenti cartografici">
      {TOOL_DEFS.map((tool) => {
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

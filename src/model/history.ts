import { DirtyRectPx, HistoryCommand } from './commands';
import { MapDocument } from './document';

export const DEFAULT_MAX_RASTER_HISTORY_BYTES = 128 * 1024 * 1024;

export interface HistoryChangeResult {
  command: HistoryCommand;
  affectsTerrain: boolean;
  dirtyRect?: DirtyRectPx;
}

export class HistoryManager {
  private undoStack: HistoryCommand[] = [];
  private redoStack: HistoryCommand[] = [];
  private totalRasterBytes = 0;

  constructor(private readonly maxRasterBytes: number = DEFAULT_MAX_RASTER_HISTORY_BYTES) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoCount(): number {
    return this.undoStack.length;
  }

  get redoCount(): number {
    return this.redoStack.length;
  }

  get currentRasterBytes(): number {
    return this.totalRasterBytes;
  }

  get nextUndoLabel(): string | undefined {
    return this.undoStack[this.undoStack.length - 1]?.label;
  }

  get nextRedoLabel(): string | undefined {
    return this.redoStack[this.redoStack.length - 1]?.label;
  }

  execute(doc: MapDocument, command: HistoryCommand, options: { alreadyApplied?: boolean } = {}): HistoryChangeResult {
    if (!options.alreadyApplied) {
      command.apply(doc);
    }
    doc.manifest.revision += 1;
    if (command.affectsTerrain) {
      doc.terrainVersion += 1;
    }

    for (const dropped of this.redoStack) {
      if (dropped.affectsTerrain) {
        this.totalRasterBytes -= dropped.byteSize;
      }
    }
    this.redoStack = [];

    this.undoStack.push(command);
    if (command.affectsTerrain) {
      this.totalRasterBytes += command.byteSize;
    }
    this.evictOldestIfOverBudget();

    return {
      command,
      affectsTerrain: command.affectsTerrain,
      dirtyRect: command.dirtyRect
    };
  }

  undo(doc: MapDocument): HistoryChangeResult | null {
    const command = this.undoStack.pop();
    if (!command) return null;

    command.revert(doc);
    doc.manifest.revision += 1;
    if (command.affectsTerrain) {
      doc.terrainVersion += 1;
    }
    this.redoStack.push(command);

    return {
      command,
      affectsTerrain: command.affectsTerrain,
      dirtyRect: command.dirtyRect
    };
  }

  redo(doc: MapDocument): HistoryChangeResult | null {
    const command = this.redoStack.pop();
    if (!command) return null;

    command.apply(doc);
    doc.manifest.revision += 1;
    if (command.affectsTerrain) {
      doc.terrainVersion += 1;
    }
    this.undoStack.push(command);
    this.evictOldestIfOverBudget();

    return {
      command,
      affectsTerrain: command.affectsTerrain,
      dirtyRect: command.dirtyRect
    };
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.totalRasterBytes = 0;
  }

  private evictOldestIfOverBudget(): void {
    while (this.totalRasterBytes > this.maxRasterBytes && this.undoStack.length > 1) {
      const oldest = this.undoStack.shift();
      if (oldest?.affectsTerrain) {
        this.totalRasterBytes = Math.max(0, this.totalRasterBytes - oldest.byteSize);
      }
    }
  }
}

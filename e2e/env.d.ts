import type { CameraState } from '../src/model/coordinates';
import type { MapDocument } from '../src/model/document';

export interface E2eEditorDebugHandle {
  store: {
    getSnapshot(): {
      doc: MapDocument;
      camera: CameraState;
    };
  };
  getDocument: () => MapDocument;
}

declare global {
  interface Window {
    __MAP_EDITOR_DEBUG__?: E2eEditorDebugHandle;
  }
}

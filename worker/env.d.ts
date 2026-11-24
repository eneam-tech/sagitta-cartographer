import type { PairingRoomDurableObject } from './index';

export interface Env {
  PAIRING_ROOMS: DurableObjectNamespace<PairingRoomDurableObject>;
  ASSETS?: Fetcher;
  ALLOWED_ORIGINS?: string;
}

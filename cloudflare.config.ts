import { bindings, defineConfig, exports } from 'cf/config';
import * as entrypoint from './worker/index.ts' with { type: 'cf-worker' };

export default defineConfig({
  worker: {
    name: 'em-sagitta-cartografo',
    entrypoint,
    compatibilityDate: '2026-11-24',
    observability: {
      enabled: true,
      traces: {
        enabled: true
      }
    },
    exports: {
      PairingRoomDurableObject: exports.durableObject({
        storage: 'sqlite'
      })
    },
    env: {
      ASSETS: bindings.assets(),
      PAIRING_ROOMS: bindings.durableObject({
        worker: 'em-sagitta-cartografo',
        exportName: 'PairingRoomDurableObject'
      })
    },
    assets: {
      htmlHandling: 'auto-trailing-slash',
      notFoundHandling: 'single-page-application',
      runWorkerFirst: [
        '/api/*',
        '/.env*',
        '/X-API-KEY.json',
        '/password.txt',
        '/secrets-config.json',
        '/wp-login.php',
        '/wp-admin/*',
        '/.git/*'
      ]
    }
  }
});

import type { AppConfig } from '../config.js';

export interface ServerDeps {
  config: AppConfig;
  handle: (userId: string, text: string) => Promise<string>;
  claimMessage: (messageId: string, nowIso: string) => Promise<boolean>;
  releaseMessage: (messageId: string) => Promise<void>;
  now?: () => Date;
  sendMetaText?: (to: string, body: string) => Promise<void>;
}

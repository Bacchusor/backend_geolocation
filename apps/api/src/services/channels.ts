import type { ChannelType } from '@georeminder/shared';
import { HomeAssistantClient } from '../integrations/home-assistant.js';
import type { SecretBox } from '../crypto.js';

export interface NotificationMessage {
  title: string;
  message: string;
  url?: string | null;
  /** Stable tag so repeated notifications for the same place replace each other on the phone. */
  tag?: string;
}

export interface DeliveryResult {
  ok: boolean;
  channel_type: ChannelType;
  target: string;
  error?: string;
}

/** The only abstraction in the service: where a message goes. FCM/APNs will implement it later. */
export interface NotificationChannel {
  readonly type: ChannelType;
  send(target: string, msg: NotificationMessage): Promise<DeliveryResult>;
  test(): Promise<{ ok: boolean; error?: string; message?: string }>;
  /** Optional discovery of valid targets (HA: notify.mobile_app_* services). */
  listTargets?(): Promise<string[]>;
}

export interface ChannelRecord {
  id: string;
  type: string;
  config: Record<string, unknown>;
  secret_enc: string | null;
}

export class HomeAssistantChannel implements NotificationChannel {
  readonly type = 'home_assistant' as const;
  readonly client: HomeAssistantClient;

  constructor(baseUrl: string, token: string) {
    this.client = new HomeAssistantClient(baseUrl, token);
  }

  async send(target: string, msg: NotificationMessage): Promise<DeliveryResult> {
    try {
      const data: Record<string, unknown> = {};
      if (msg.url) {
        data.url = msg.url; // iOS Companion
        data.clickAction = msg.url; // Android Companion
      }
      if (msg.tag) data.tag = msg.tag;
      await this.client.notify(target, {
        title: msg.title,
        message: msg.message,
        ...(Object.keys(data).length ? { data } : {}),
      });
      return { ok: true, channel_type: this.type, target };
    } catch (err) {
      return {
        ok: false,
        channel_type: this.type,
        target,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  test() {
    return this.client.test();
  }

  listTargets() {
    return this.client.listNotifyServices();
  }
}

/** Placeholder so the admin can pre-create an FCM channel; sending is not implemented yet. */
export class FcmChannel implements NotificationChannel {
  readonly type = 'fcm' as const;
  async send(target: string): Promise<DeliveryResult> {
    return { ok: false, channel_type: this.type, target, error: 'FCM channel not implemented yet' };
  }
  async test() {
    return { ok: false, error: 'FCM channel not implemented yet' };
  }
}

export class ChannelFactory {
  constructor(private readonly secrets: SecretBox) {}

  build(row: ChannelRecord): NotificationChannel {
    switch (row.type) {
      case 'home_assistant': {
        const baseUrl = String(row.config.base_url ?? '');
        const token = row.secret_enc ? this.secrets.decrypt(row.secret_enc) : '';
        return new HomeAssistantChannel(baseUrl, token);
      }
      case 'fcm':
        return new FcmChannel();
      default:
        throw new Error(`unknown channel type ${row.type}`);
    }
  }
}

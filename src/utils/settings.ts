import Store from 'electron-store';
import keytar from 'keytar';
import crypto from 'crypto';

const SERVICE_NAME = 'dolphin-enquiries-tray';
const ACCOUNT_NAME = 'encryption-key';

interface SMTPConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  to: string;
}

interface StoreSchema {
  smtp: SMTPConfig;
}

class Settings {
  private store?: Store<StoreSchema>;

  private async initStore() {
    if (!this.store) {
      let key = await keytar.getPassword(SERVICE_NAME, ACCOUNT_NAME);
      if (!key) {
        key = crypto.randomBytes(32).toString('hex');
        await keytar.setPassword(SERVICE_NAME, ACCOUNT_NAME, key);
      }

      this.store = new Store<StoreSchema>({
        name: 'smtp-config',
        encryptionKey: key,
        defaults: {
          smtp: {
            host: '',
            port: 587,
            secure: true,
            user: '',
            pass: '',
            to: ''
          }
        }
      });
    }
  }

  async getSMTPConfig(): Promise<SMTPConfig | null> {
    await this.initStore();
    const config = this.store!.get('smtp');
    return config && config.host ? config : null;
  }

  async setSMTPConfig(config: SMTPConfig): Promise<void> {
    await this.initStore();
    this.store!.set('smtp', config);
  }

  async hasSMTPConfig(): Promise<boolean> {
    await this.initStore();
    const config = this.store!.get('smtp');
    return Boolean(config?.host);
  }
}

export const settings = new Settings();

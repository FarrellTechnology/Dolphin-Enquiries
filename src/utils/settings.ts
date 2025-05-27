import Store from 'electron-store';
import keytar from 'keytar';
import crypto from 'crypto';

const SERVICE_NAME = 'dolphin-enquiries-tray';
const ACCOUNT_NAME = 'encryption-key';

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
          },
          sftpOne: {
            host: '',
            port: 22,
            username: '',
            password: ''
          },
          sftpTwo: {
            host: '',
            port: 22,
            username: '',
            password: ''
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

  async getSFTPConfigOne(): Promise<SFTPConfig | null> {
    await this.initStore();
    const config = this.store!.get('sftpOne');
    return config && config.host ? config : null;
  }
  async getSFTPConfigTwo(): Promise<SFTPConfig | null> {
    await this.initStore();
    const config = this.store!.get('sftpTwo');
    return config && config.host ? config : null;
  }

  async setSMTPConfig(config: SMTPConfig): Promise<void> {
    await this.initStore();
    this.store!.set('smtp', config);
  }

  async setSFTPConfigOne(config: SFTPConfig): Promise<void> {
    await this.initStore();
    this.store!.set('sftpOne', config);
  }

  async setSFTPConfigTwo(config: SFTPConfig): Promise<void> {
    await this.initStore();
    this.store!.set('sftpTwo', config);
  }

  async hasSMTPConfig(): Promise<boolean> {
    await this.initStore();
    const config = this.store!.get('smtp');
    return Boolean(config?.host);
  }

  async hasSFTPConfigOne(): Promise<boolean> {
    await this.initStore();
    const config = this.store!.get('sftpOne');
    return Boolean(config?.host);
  }

  async hasSFTPConfigTwo(): Promise<boolean> {
    await this.initStore();
    const config = this.store!.get('sftpTwo');
    return Boolean(config?.host);
  }
}

export const settings = new Settings();

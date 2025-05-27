import Store from 'electron-store';
import { app } from 'electron';
import crypto from 'crypto';

// Encryption key will be derived from a combination of machine-specific data
const getEncryptionKey = () => {
  const machineId = app.getPath('userData');
  return crypto.createHash('sha256').update(machineId).digest('hex');
};

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

const store = new Store<StoreSchema>({
  name: 'smtp-config',
  encryptionKey: getEncryptionKey(),
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

export const settings = {
  getSMTPConfig: (): SMTPConfig | null => {
    try {
      const config = store.get('smtp');
      return config && config.host ? config : null;
    } catch {
      return null;
    }
  },

  setSMTPConfig: (config: SMTPConfig): void => {
    store.set('smtp', config);
  },

  hasSMTPConfig: (): boolean => {
    const config = store.get('smtp');
    return Boolean(config?.host);
  }
}; 
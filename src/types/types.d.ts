interface SFTPConfig {
    host: string;
    port: number;
    username: string;
    password: string;
    remotePath?: string;
    uploadPath?: string;
}

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
    sftpOne: SFTPConfig;
    sftpTwo: SFTPConfig;
}
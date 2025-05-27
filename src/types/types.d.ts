type SFTPConfig = {
    host: string;
    port: number;
    username: string;
    password: string;
    remotePath?: string;
    uploadPath?: string;
}

type SMTPConfig = {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    to: string;
}

type StoreSchema = {
    smtp: SMTPConfig;
    sftpOne: SFTPConfig;
    sftpTwo: SFTPConfig;
}


type ScheduledTask = {
    task: () => void;
    schedule?: string; // optional, default to 1:00 AM
};

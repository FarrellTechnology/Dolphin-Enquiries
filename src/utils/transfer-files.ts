import SFTPClient from 'ssh2-sftp-client';
import { FileInfo, Client as FTPClient } from 'basic-ftp';
import path from 'path';

export class TransferClient {
    private sftpClient: SFTPClient | null = null;
    private ftpClient: FTPClient | null = null;
    private isSFTP: boolean;

    constructor(private config: FTPConfig) {
        this.isSFTP = config.port === 22 || config.port === 54872 || config.port === 42870;
    }

    async connect(): Promise<void> {
        if (this.isSFTP) {
            this.sftpClient = new SFTPClient();
            await this.sftpClient.connect({
                host: this.config.host,
                port: this.config.port,
                username: this.config.username,
                password: this.config.password,
            });
        } else {
            this.ftpClient = new FTPClient();
            await this.ftpClient.access({
                host: this.config.host,
                port: this.config.port,
                user: this.config.username,
                password: this.config.password,
            });
        }
    }

    async list(remotePath: string): Promise<SFTPClient.FileInfo[] | FileInfo[]> {
        if (this.isSFTP && this.sftpClient) {
            return await this.sftpClient.list(remotePath);
        } else if (this.ftpClient) {
            await this.ftpClient.cd(remotePath);
            return await this.ftpClient.list();
        }
        return [];
    }

    async get(remoteFile: string, localFile: string): Promise<void> {
        if (this.isSFTP && this.sftpClient) {
            await this.sftpClient.get(remoteFile, localFile);
        } else if (this.ftpClient) {
            await this.ftpClient.downloadTo(localFile, path.basename(remoteFile));
        }
    }

    async put(localFile: string, remoteFile: string): Promise<void> {
        if (this.isSFTP && this.sftpClient) {
            await this.sftpClient.put(localFile, remoteFile);
        } else if (this.ftpClient) {
            await this.ftpClient.uploadFrom(localFile, path.basename(remoteFile));
        }
    }

    async delete(remoteFile: string): Promise<void> {
        if (this.isSFTP && this.sftpClient) {
            await this.sftpClient.delete(remoteFile);
        } else if (this.ftpClient) {
            await this.ftpClient.remove(path.basename(remoteFile));
        }
    }

    async end(): Promise<void> {
        if (this.sftpClient) await this.sftpClient.end();
        if (this.ftpClient) this.ftpClient.close();
    }
}

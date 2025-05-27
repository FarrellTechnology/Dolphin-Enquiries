import Client from 'ssh2-sftp-client';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { settings } from '../../utils';

const sftp1 = new Client();
const sftp2 = new Client();

const documentsFolder = app.getPath("documents");

function logFileMovement(fileName: string, destinationFolder: string, timeTaken: number) {
    const logDir = path.join(documentsFolder, "DolphinEnquiries", "logs");
    const logFile = path.join(logDir, `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.txt`);

    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }

    const logEntry = `${new Date().toLocaleTimeString()} - ${fileName} - ${destinationFolder} - ${timeTaken}ms\n`;
    fs.appendFile(logFile, logEntry, (err) => {
        if (err) console.error('Failed to write log', err);
    });
}

let isTransferring = false;

export async function watchAndTransferFiles(pollIntervalMs = 5000) {
    const sftpOneConfig = await settings.getSFTPConfigOne();
    const sftpTwoConfig = await settings.getSFTPConfigTwo();

    if (!sftpOneConfig || !sftpTwoConfig) {
        throw new Error('SFTP configuration is missing.');
    }

    if (!sftpOneConfig.host || !sftpTwoConfig.host) {
        throw new Error('SFTP host is not configured.');
    }

    if (!sftpOneConfig.remotePath || !sftpTwoConfig.uploadPath) {
        throw new Error('SFTP remote path or upload path is not configured.');
    }

    if (!sftpOneConfig.username || !sftpTwoConfig.username) {
        throw new Error('SFTP username is not configured.');
    }

    if (!sftpOneConfig.password || !sftpTwoConfig.password) {
        throw new Error('SFTP password is not configured.');
    }

    await sftp1.connect({ ...sftpOneConfig });
    await sftp2.connect({ ...sftpTwoConfig });

    const remotePath = sftpOneConfig.remotePath || '';
    const uploadPath = sftpTwoConfig.uploadPath || '';
    const localPath = path.join(documentsFolder, "DolphinEnquiries", "completed");

    const transferredFiles = new Set<string>();

    async function poll() {
        if (isTransferring) return;
        isTransferring = true;

        try {
            const fileList = await sftp1.list(remotePath);

            for (const file of fileList) {
                if (file.type === '-' && !transferredFiles.has(file.name)) {
                    const remoteFile = `${remotePath}${file.name}`;
                    const localFile = path.join(localPath, file.name);
                    const destRemoteFile = `${uploadPath}${file.name}`;

                    const startTime = Date.now();

                    await sftp1.get(remoteFile, localFile);
                    console.log(`Downloaded ${file.name}`);

                    await sftp1.delete(remoteFile);
                    console.log(`Deleted source file ${file.name}`);

                    await sftp2.put(localFile, destRemoteFile);
                    console.log(`Uploaded ${file.name} to destination`);

                    logFileMovement(file.name, destRemoteFile, Date.now() - startTime);
                    console.log(`Moved ${file.name} to ${destRemoteFile}`);

                    transferredFiles.add(file.name);
                }
            }
        } catch (err) {
            console.error('Error during file transfer:', err);
        } finally {
            isTransferring = false;
        }
    }

    setInterval(poll, pollIntervalMs);

    poll();
}

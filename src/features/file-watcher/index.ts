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

async function transferFiles() {
    try {
        const [sftpOneConfig, sftpTwoConfig] = await Promise.all([
            settings.getSFTPConfigOne(),
            settings.getSFTPConfigTwo()
        ]);

        if (!sftpOneConfig || !sftpTwoConfig) {
            throw new Error('SFTP configuration is missing.');
        }

        const requiredFields: (keyof SFTPConfig)[] = ['host', 'port', 'username', 'password'];

        const configs: [string, SFTPConfig][] = [
            ['SFTP One', sftpOneConfig],
            ['SFTP Two', sftpTwoConfig],
        ];

        for (const [name, config] of configs) {
            for (const field of requiredFields) {
                if (!config[field]) {
                    throw new Error(`${name} configuration is missing "${field}".`);
                }
            }
        }

        await sftp1.connect({
            host: sftpOneConfig.host,
            port: sftpOneConfig.port,
            username: sftpOneConfig.username,
            password: sftpOneConfig.password,
        });

        await sftp2.connect({
            host: sftpTwoConfig.host,
            port: sftpTwoConfig.port,
            username: sftpTwoConfig.username,
            password: sftpTwoConfig.password,
        });

        const remotePath = sftpOneConfig.remotePath || '';
        const uploadPath = sftpTwoConfig.uploadPath || '';
        const localPath = path.join(documentsFolder, "DolphinEnquiries", "completed");

        const fileList = await sftp1.list(remotePath);

        for (const file of fileList) {
            if (file.type === '-') {
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
            }
        }

        console.log('File transfer completed successfully.');

        await sftp1.end();
        await sftp2.end();
    } catch (err) {
        console.error('Error during file transfer:', err);
        throw new Error(`File transfer failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
}

export { transferFiles };

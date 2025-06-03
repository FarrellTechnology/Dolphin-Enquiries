import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { documentsFolder, isRegularFile, settings, TransferClient } from '../../utils';
const cronitor = require('cronitor')(app.isPackaged ? process.env.PROD_CRONITOR_API_KEY : process.env.PROD_CRONITOR_API_KEY);
const fileMonitor = new cronitor.Monitor('EFR-Electron-Mover');
const uploadingMonitor = new cronitor.Monitor('EFR-Electron-Uploading');

let isTransferring = false;

function logFileMovement(fileName: string, destinationFolder: string, timeTaken: number) {
    const logDir = path.join(documentsFolder(), "DolphinEnquiries", "logs");
    const logFile = path.join(logDir, `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.txt`);

    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }

    const logEntry = `${new Date().toLocaleTimeString()} - ${fileName} - ${destinationFolder} - ${timeTaken}ms\n`;
    fs.appendFile(logFile, logEntry, (err) => {
        if (err) console.error('Failed to write log', err);
    });
}

export async function watchAndTransferFiles() {
    const configOne = await settings.getSFTPConfigOne();
    const configTwo = await settings.getSFTPConfigTwo();

    if (!configOne || !configTwo) {
        console.error("SFTP configurations are not set up correctly.");
        return;
    }

    const client1 = new TransferClient(configOne);
    const client2 = new TransferClient(configTwo);

    await client1.connect();
    await client2.connect();

    const remotePath = configOne.remotePath || "/";
    const uploadPath = configTwo.uploadPath || "/";
    const todayFolderName = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // "yyyymmdd"
    const localPath = path.join(documentsFolder(), "DolphinEnquiries", "completed", todayFolderName);

    if (!fs.existsSync(localPath)) {
        fs.mkdirSync(localPath, { recursive: true });
    }

    const transferredFiles = new Set<string>();

    if (isTransferring) return;
    isTransferring = true;

    try {
        const fileList = await client1.list(remotePath);
        console.debug(`Found ${fileList.length} files in source directory`);

        for (const file of fileList) {
            const fileName = file.name;
            const isFile = isRegularFile(file);

            if (isFile && !transferredFiles.has(fileName)) {
                fileMonitor.ping({ state: 'run' });
                uploadingMonitor.ping({ message: fileName });
                const remoteFile = `${remotePath}${fileName}`;
                const localFile = path.join(localPath, fileName);
                const baseRemotePath = uploadPath;

                let destFolder = baseRemotePath;

                if (fileName.toLowerCase().startsWith('egr')) {
                    destFolder = path.posix.join(baseRemotePath, 'XML-EGR/');
                } else if (fileName.toLowerCase().startsWith('lwc')) {
                    destFolder = path.posix.join(baseRemotePath, 'XML-LWC/');
                }

                if (!destFolder.endsWith('/')) destFolder += '/';

                const destRemoteFile = destFolder + fileName;

                const startTime = Date.now();

                await client1.get(remoteFile, localFile);
                console.debug(`Downloaded ${fileName}`);

                await client1.delete(remoteFile);
                console.debug(`Deleted source file ${fileName}`);

                await client2.put(localFile, destRemoteFile);
                console.debug(`Uploaded ${fileName} to destination`);

                logFileMovement(fileName, destRemoteFile, Date.now() - startTime);
                transferredFiles.add(fileName);

                fileMonitor.ping({ state: 'complete' });
            }
        }
    } catch (err) {
        console.error("File transfer error:", err);
        fileMonitor.ping({ state: 'fail', message: 'Transfer failed' });
    } finally {
        await client1.end();
        await client2.end();
        isTransferring = false;
    }
}

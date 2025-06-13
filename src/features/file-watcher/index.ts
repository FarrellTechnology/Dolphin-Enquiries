import fs from 'fs';
import path from 'path';
import { documentsFolder, isRegularFile, settings, TransferClient } from '../../utils';
import { ping } from '..';

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
    const configThree = await settings.getSFTPConfigThree();

    if (!configOne || !configTwo || !configThree) {
        console.error("SFTP configurations are not set up correctly.");
        return;
    }

    const client1 = new TransferClient(configOne);
    const client2 = new TransferClient(configTwo);
    const client3 = new TransferClient(configThree);

    await client1.connect();
    await client2.connect();
    await client3.connect();

    const remotePath1 = configOne.remotePath || "/";
    const remotePath2 = configTwo.remotePath || "/";
    const uploadPath3 = configThree.uploadPath || "/";

    const todayFolderName = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const localPath = path.join(documentsFolder(), "DolphinEnquiries", "completed", todayFolderName);

    if (!fs.existsSync(localPath)) {
        fs.mkdirSync(localPath, { recursive: true });
    }

    const transferredFiles = new Set<string>();

    if (isTransferring) return;
    isTransferring = true;

    let currentFile: string | null = null;

    try {
        async function transferFilesFromClient(client: TransferClient, sourceRemotePath: string) {
            const fileList = await client.list(sourceRemotePath);
            console.debug(`Found ${fileList.length} files in source directory ${sourceRemotePath}`);

            for (const file of fileList) {
                const fileName = file.name;
                const isFile = isRegularFile(file);

                if (isFile && !transferredFiles.has(fileName)) {
                    currentFile = fileName;

                    ping('EFR-Electron-Mover', { state: 'run' });
                    ping('EFR-Electron-Uploading', { message: fileName });

                    const remoteFile = `${sourceRemotePath}${fileName}`;
                    const localFile = path.join(localPath, fileName);
                    let destFolder = uploadPath3;

                    if (fileName.toLowerCase().startsWith('egr')) {
                        destFolder = path.posix.join(destFolder, 'XML-EGR/');
                    } else if (fileName.toLowerCase().startsWith('lwc')) {
                        destFolder = path.posix.join(destFolder, 'XML-LWC/');
                    }

                    if (!destFolder.endsWith('/')) destFolder += '/';

                    const destRemoteFile = destFolder + fileName;
                    const startTime = Date.now();

                    await client.get(remoteFile, localFile);
                    console.debug(`Downloaded ${fileName} from ${sourceRemotePath}`);

                    await client.delete(remoteFile);
                    console.debug(`Deleted source file ${fileName} from ${sourceRemotePath}`);

                    await client3.put(localFile, destRemoteFile);
                    console.debug(`Uploaded ${fileName} to client3 at ${destRemoteFile}`);

                    logFileMovement(fileName, destFolder, Date.now() - startTime);
                    transferredFiles.add(fileName);

                    ping('EFR-Electron-Mover', { state: 'complete' });

                    currentFile = null;
                }
            }
        }

        await transferFilesFromClient(client1, remotePath1);
        await transferFilesFromClient(client2, remotePath2);

    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error("File transfer error:", err);

        ping('EFR-Electron-Mover', {
            state: 'fail',
            message: `Transfer failed${currentFile ? ` for file "${currentFile}"` : ''}: ${errorMessage}`
        });
    } finally {
        await client1.end();
        await client2.end();
        await client3.end();
        isTransferring = false;
    }
}

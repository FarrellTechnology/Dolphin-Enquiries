import fs from 'fs';
import path from 'path';
import { documentsFolder, isRegularFile, settings, TransferClient } from '../../utils';
import { ping } from '..';

let isTransferring = false;

function logFileMovement(fileName: string, destinationFolder: string, timeTaken: number) {
    const logDir = path.join(documentsFolder(), "DolphinEnquiries", "logs", "file-movements");
    const logFile = path.join(logDir, `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.txt`);

    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }

    const logEntry = `${new Date().toLocaleTimeString()} - ${fileName} - ${destinationFolder} - ${timeTaken}ms\n`;
    fs.appendFile(logFile, logEntry, (err) => {
        if (err) console.error('Failed to write log', err);
    });
}

const failureStorePath = path.join(documentsFolder(), "DolphinEnquiries", "cache", "file-transfer-failures.json");

function loadFailures(): { localFile: string; destRemoteFile: string; fileName: string }[] {
    try {
        if (fs.existsSync(failureStorePath)) {
            const content = fs.readFileSync(failureStorePath, 'utf-8');
            return JSON.parse(content);
        }
    } catch (err) {
        console.error('Failed to load failure cache', err);
    }
    return [];
}

function saveFailures(failures: { localFile: string; destRemoteFile: string; fileName: string }[]) {
    try {
        const dir = path.dirname(failureStorePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(failureStorePath, JSON.stringify(failures, null, 2));
    } catch (err) {
        console.error('Failed to save failure cache', err);
    }
}

async function tryUploadWithRetry(client: TransferClient, localFile: string, destRemoteFile: string, fileName: string, maxRetries = 3) {
    let attempts = 0;
    while (attempts < maxRetries) {
        try {
            await client.put(localFile, destRemoteFile);
            console.debug(`Uploaded ${fileName} to client3 at ${destRemoteFile} (attempt ${attempts + 1})`);
            return true;
        } catch (err) {
            attempts++;
            console.warn(`Upload attempt ${attempts} failed for ${fileName}:`, err);
            if (attempts >= maxRetries) {
                return false;
            }
            await new Promise(res => setTimeout(res, 1000));
        }
    }
    return false;
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
    let failureCache = loadFailures();

    try {
        async function transferFilesFromClient(client: TransferClient, sourceRemotePath: string) {
            const fileList = await client.list(sourceRemotePath);

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

                    const success = await tryUploadWithRetry(client3, localFile, destRemoteFile, fileName);

                    if (!success) {
                        console.error(`Failed to upload ${fileName} to client3 after multiple attempts.`);
                        failureCache.push({ localFile, destRemoteFile, fileName });
                        saveFailures(failureCache);
                    } else {
                        failureCache = failureCache.filter(f => f.fileName !== fileName);
                        saveFailures(failureCache);

                        logFileMovement(fileName, destFolder, Date.now() - startTime);
                        transferredFiles.add(fileName);
                    }

                    ping('EFR-Electron-Mover', { state: 'complete' });

                    currentFile = null;
                }
            }
        }

        if (failureCache.length > 0) {
            console.log(`Retrying ${failureCache.length} failed uploads from previous runs...`);
            for (const { localFile, destRemoteFile, fileName } of failureCache.slice()) {
                currentFile = fileName;
                ping('EFR-Electron-Mover', { state: 'run' });
                ping('EFR-Electron-Uploading', { message: `Retry ${fileName}` });

                const success = await tryUploadWithRetry(client3, localFile, destRemoteFile, fileName);
                if (success) {
                    failureCache = failureCache.filter(f => f.fileName !== fileName);
                    saveFailures(failureCache);

                    logFileMovement(fileName, path.posix.dirname(destRemoteFile), 0);
                    transferredFiles.add(fileName);

                    console.log(`Successfully retried upload for ${fileName}`);
                    ping('EFR-Electron-Mover', { state: 'complete' });
                } else {
                    console.error(`Retry upload failed for ${fileName}`);
                    ping('EFR-Electron-Mover', { state: 'fail', message: `Retry failed for ${fileName}` });
                }
                currentFile = null;
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

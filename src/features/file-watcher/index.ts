import fs from 'fs';
import path from 'path';
import { documentsFolder, isRegularFile, logToFile, settings, TransferClient } from '../../utils';
import { ping } from '..';

let isTransferring: boolean = false;
const failureStorePath: string = path.join(documentsFolder(), "DolphinEnquiries", "cache", "file-transfer-failures.json");

/**
 * Loads the failed transfer cache from disk.
 * @returns {Array<{ localFile: string; destRemoteFile: string; fileName: string }>} List of failed file transfers.
 */
function loadFailures(): { localFile: string; destRemoteFile: string; fileName: string }[] {
    try {
        if (fs.existsSync(failureStorePath)) {
            const content = fs.readFileSync(failureStorePath, 'utf-8');
            const parsed = JSON.parse(content);
            return Array.isArray(parsed) ? parsed : [];
        }
    } catch (err) {
        logToFile("file-movements", `Failed to load failure cache: ${err instanceof Error ? err.message : String(err)}`);
    }
    return [];
}

/**
 * Saves the failed transfer cache to disk.
 * @param {Array<{ localFile: string; destRemoteFile: string; fileName: string }>} failures - List of failed file transfers to save.
 */
function saveFailures(failures: { localFile: string; destRemoteFile: string; fileName: string }[]): void {
    try {
        const dir = path.dirname(failureStorePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(failureStorePath, JSON.stringify(failures, null, 2));
    } catch (err) {
        logToFile("file-movements", `Failed to save failure cache: ${err instanceof Error ? err.message : String(err)}`);
    }
}

/**
 * Resolves file paths based on base path, upload base, and file name.
 * @param {string} basePath - The base remote path.
 * @param {string} uploadBase - The upload base path.
 * @param {string} fileName - The name of the file.
 * @returns {Object} - Contains resolved file paths (remoteFile, localFile, destFolder, destRemoteFile).
 */
function resolveFilePaths(basePath: string, uploadBase: string, fileName: string) {
    const remoteFile = `${basePath}${fileName}`;
    const todayFolderName = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const localPath = path.join(documentsFolder(), "DolphinEnquiries", "completed", todayFolderName);
    const localFile = path.join(localPath, fileName);
    let destFolder = uploadBase;

    if (fileName.toLowerCase().startsWith('egr')) {
        destFolder = path.posix.join(destFolder, 'XML-EGR/');
    } else if (fileName.toLowerCase().startsWith('lwc')) {
        destFolder = path.posix.join(destFolder, 'XML-LWC/');
    }

    if (!destFolder.endsWith('/')) destFolder += '/';

    const destRemoteFile = destFolder + fileName;
    return { remoteFile, localFile, destFolder, destRemoteFile };
}

/**
 * Tries to upload a file with retry logic.
 * @param {TransferClient} client - The transfer client to use for uploading.
 * @param {string} localFile - The local file path.
 * @param {string} destRemoteFile - The destination remote file path.
 * @param {string} fileName - The name of the file.
 * @param {number} [maxRetries=3] - The maximum number of retry attempts.
 * @returns {Promise<boolean>} - Returns true if the upload succeeds, false otherwise.
 */
async function tryUploadWithRetry(client: TransferClient, localFile: string, destRemoteFile: string, fileName: string, maxRetries: number = 3): Promise<boolean> {
    let attempts = 0;
    while (attempts < maxRetries) {
        try {
            await client.put(localFile, destRemoteFile);
            logToFile("file-movements", `Successfully uploaded ${fileName} to client3 at ${destRemoteFile} (attempt ${attempts + 1})`);
            return true;
        } catch (err) {
            attempts++;
            logToFile("file-movements", `Upload attempt ${attempts} failed for ${fileName}: ${err instanceof Error ? err.message : String(err)}`);
            if (attempts >= maxRetries) {
                logToFile("file-movements", `All upload attempts failed for ${fileName}`);
                return false;
            }
            await new Promise(res => setTimeout(res, 1000));
        }
    }
    return false;
}

/**
 * Main function to watch and transfer files.
 * @returns {Promise<void>} - Resolves when the file transfer process is complete.
 */
export async function watchAndTransferFiles(): Promise<void> {
    const configOne = await settings.getSFTPConfigOne();
    const configTwo = await settings.getSFTPConfigTwo();
    const configThree = await settings.getSFTPConfigThree();

    if (!configOne || !configTwo || !configThree) {
        logToFile("file-movements", "SFTP configurations are not set up correctly.");
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

    logToFile("file-movements", `=== Begin transfer session at ${new Date().toISOString()} ===`);

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

                    const { remoteFile, localFile, destFolder, destRemoteFile } = resolveFilePaths(sourceRemotePath, uploadPath3, fileName);
                    const startTime = Date.now();

                    await client.get(remoteFile, localFile);
                    logToFile("file-movements", `Downloaded ${fileName} from ${sourceRemotePath}`);

                    await client.delete(remoteFile);
                    logToFile("file-movements", `Deleted source file ${fileName} from ${sourceRemotePath}`);

                    const success = await tryUploadWithRetry(client3, localFile, destRemoteFile, fileName);

                    if (!success) {
                        logToFile("file-movements", `Failed to upload ${fileName} to client3 after multiple attempts.`);
                        failureCache.push({ localFile, destRemoteFile, fileName });
                    } else {
                        failureCache = failureCache.filter(f => f.fileName !== fileName);
                        transferredFiles.add(fileName);

                        logToFile(
                            "file-movements",
                            `${fileName} - ${destFolder} - ${Date.now() - startTime}ms`
                        );
                    }

                    ping('EFR-Electron-Mover', { state: 'complete' });
                    currentFile = null;
                }
            }
        }

        if (failureCache.length > 0) {
            logToFile("file-movements", `Retrying ${failureCache.length} failed uploads from previous runs...`);
            for (const { localFile, destRemoteFile, fileName } of failureCache.slice()) {
                currentFile = fileName;
                ping('EFR-Electron-Mover', { state: 'run' });
                ping('EFR-Electron-Uploading', { message: `Retry ${fileName}` });

                const success = await tryUploadWithRetry(client3, localFile, destRemoteFile, fileName);
                if (success) {
                    failureCache = failureCache.filter(f => f.fileName !== fileName);
                    transferredFiles.add(fileName);

                    logToFile(
                        "file-movements",
                        `${fileName} - ${path.posix.dirname(destRemoteFile)} - RETRY SUCCESS`
                    );
                    logToFile("file-movements", `Successfully retried upload for ${fileName}`);

                    ping('EFR-Electron-Mover', { state: 'complete' });
                } else {
                    logToFile("file-movements", `Retry upload failed for ${fileName}`);
                    ping('EFR-Electron-Mover', { state: 'fail', message: `Retry failed for ${fileName}` });
                }
                currentFile = null;
            }
        }

        saveFailures(failureCache);

        await transferFilesFromClient(client1, remotePath1);
        await transferFilesFromClient(client2, remotePath2);

    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logToFile("file-movements", `File transfer error: ${errorMessage}`);

        ping('EFR-Electron-Mover', {
            state: 'fail',
            message: `Transfer failed${currentFile ? ` for file \"${currentFile}\"` : ''}: ${errorMessage}`
        });
    } finally {
        await client1.end();
        await client2.end();
        await client3.end();
        isTransferring = false;

        logToFile("file-movements", `=== End transfer session ===`);
    }
}

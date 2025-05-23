import * as dotenv from "dotenv";
dotenv.config();

import { app, Tray, Menu, nativeImage, NativeImage, nativeTheme, BrowserWindow, dialog } from "electron";
import path from "path";
import fs from "fs";
import nodemailer from "nodemailer";
import { autoUpdater } from "electron-updater";

const AutoLaunch: any = require('auto-launch');
const schedule: any = require('node-schedule');

let tray: Tray | null = null;
let isQuitting = false;

const dolphinEnquiriesAutoLauncher = new AutoLaunch({
  name: 'Dolphin Enquiries',
  path: app.getPath('exe'),
});

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 350,
    show: false,
    icon: nativeImage.createFromPath(
      nativeTheme.shouldUseDarkColors
        ? path.join(__dirname, "..", "company-icon.png")
        : path.join(__dirname, "..", "company-icon-dark.png")
    ),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "..", 'preload.js')
    },
  });

  mainWindow.loadFile(path.join(__dirname, "..", "report.html"));

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow?.webContents.send("theme-changed", nativeTheme.shouldUseDarkColors ? "dark" : "light");
  });

  nativeTheme.on("updated", () => {
    mainWindow?.webContents.send("theme-changed", nativeTheme.shouldUseDarkColors ? "dark" : "light");
  });
}

async function checkFiles(): Promise<void> {
  const documentsFolder: string = app.getPath("documents");
  const baseFolder: string = path.join(documentsFolder, "DolphinEnquiries", "completed");

  const yesterday = new Date(Date.now() - 86400000);
  const day = String(yesterday.getDate()).padStart(2, '0');
  const month = String(yesterday.getMonth() + 1).padStart(2, '0');
  const year = yesterday.getFullYear();
  const formattedDate = `${day}-${month}-${year}`;
  const yyyymmdd: string = yesterday.toISOString().slice(0, 10).replace(/-/g, "");

  const folderPath: string = path.join(baseFolder, yyyymmdd);

  if (!fs.existsSync(folderPath)) {
    console.log(`Folder does not exist: ${folderPath}`);
    return;
  }

  const files: string[] = fs.readdirSync(folderPath);

  let leisureCount: number = 0;
  let golfCount: number = 0;

  files.forEach((file) => {
    const prefix = file.slice(0, 3).toLowerCase();
    if (prefix === "lwc") leisureCount++;
    else if (prefix === "egr") golfCount++;
  });

  const message = `[${formattedDate}] Leisure Enquiries: ${leisureCount}, Golf Enquiries: ${golfCount}`;
  if (tray) tray.setToolTip(message);

  if (mainWindow) {
    mainWindow.loadFile(path.join(__dirname, "..", "report.html"));
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.send('report-data', {
        formattedDate,
        leisureCount,
        golfCount
      });
    });
  }

  const htmlMessage = `
  <div style="font-family: Arial, sans-serif; line-height: 1.4;">
    <h2>Dolphin Enquiries Daily Report</h2>
    <p>Date: ${formattedDate}</p>
    <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse; width: 300px;">
      <thead>
        <tr>
          <th style="text-align: left;">Category</th>
          <th style="text-align: right;">Enquiries Submitted</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Leisure</td>
          <td style="text-align: right;">${leisureCount}</td>
        </tr>
        <tr>
          <td>Golf</td>
          <td style="text-align: right;">${golfCount}</td>
        </tr>
      </tbody>
    </table>
  </div>
`;

  try {
    await sendEmail("Dolphin Enquiries Daily Report", undefined, htmlMessage);
  } catch (err) {
    console.error("Failed to send email:", err);
  }
}

async function sendEmail(subject: string, text?: string, html?: string): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT),
    secure: true,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const info = await transporter.sendMail({
    from: `"Dolphin Enquiries" <${process.env.EMAIL_USER}>`,
    to: process.env.EMAIL_TO,
    subject,
    text,
    html,
  });

  console.log("Email sent: %s", info.messageId);
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.checkForUpdates();

  autoUpdater.on('update-available', (info) => {
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Available',
      message: `A new version (${info.version}) is available. Would you like to download it now?`,
      buttons: ['Yes', 'No']
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.downloadUpdate();
      }
    });
  });

  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: 'A new version has been downloaded. Restart the application to apply the updates.',
      buttons: ['Restart', 'Later']
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  autoUpdater.on('error', (err) => {
    dialog.showErrorBox('Update Error', `An error occurred while updating: ${err.message}`);
  });
}

app.whenReady().then(() => {
  dolphinEnquiriesAutoLauncher.isEnabled()
    .then((isEnabled: boolean) => {
      if (!isEnabled) {
        dolphinEnquiriesAutoLauncher.enable();
      }
    })
    .catch((err: any) => {
      console.error('AutoLaunch error:', err);
    });

  // Setup auto-updater after core functionality
  setupAutoUpdater();

  Menu.setApplicationMenu(null);
  createWindow();

  const iconPath: string = nativeTheme.shouldUseDarkColors
    ? path.join(__dirname, '..', 'company-icon.png')
    : path.join(__dirname, '..', 'company-icon-dark.png');
  const trayIcon: NativeImage = nativeImage.createFromPath(iconPath);

  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    { label: "Dolphin Enquiries", enabled: false },
    {
      label: "Check Files Now",
      click: () => {
        setImmediate(() => {
          checkFiles().catch(err => console.error("Error running checkFiles:", err));
        });
      }
    },
    { label: "Quit", click: () => app.quit() },
  ]);
  tray.setContextMenu(contextMenu);
  tray.setToolTip("Dolphin Enquiries");

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    }
  });

  schedule.scheduleJob("0 1 * * *", () => void checkFiles());

  checkFiles();
});

app.on("window-all-closed", (e: { preventDefault: () => void; }) => {
  e.preventDefault();
});

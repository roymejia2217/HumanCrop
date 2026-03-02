import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { fork, ChildProcess } from 'child_process';
import i18next from 'i18next';
import Backend from 'i18next-fs-backend';

let mainWindow: BrowserWindow | null = null;
/** Storage for active batch job promises */
const activeJobs = new Map<string, { resolve: (value: any) => void; reject: (reason?: any) => void }>();

/** 
 * Manages a pool of background worker processes for parallel image processing.
 * Optimizes resource usage based on system CPU cores and available RAM.
 */
class WorkerPool {
    private pool: { process: ChildProcess, busy: boolean, initialized: boolean, currentTask?: any }[] = [];
    private maxConcurrency: number;
    private taskQueue: any[] = [];
    private batchState = { processed: 0, warnings: 0, errors: 0, total: 0 };
    private currentJobId: string | null = null;
    private appPath: string;

    constructor(appPath: string) {
        this.appPath = appPath;
        const cpuCount = os.cpus().length;
        const coreLimit = Math.max(1, cpuCount - 1);
        const totalRamGB = os.totalmem() / (1024 * 1024 * 1024);
        /** Dynamic concurrency limit based on 1.5GB RAM per worker requirement */
        const ramLimit = Math.floor(totalRamGB / 1.5);
        this.maxConcurrency = Math.min(coreLimit, ramLimit);
        console.log(`[WorkerPool] System: ${cpuCount} cores, ${totalRamGB.toFixed(1)}GB RAM`);
        console.log(`[WorkerPool] Final concurrency limit: ${this.maxConcurrency}`);
    }

    /** Spawns a new background worker process with GC exposure enabled */
    private spawnWorker() {
        const workerPath = path.join(__dirname, 'worker.js');
        const process = fork(workerPath, [], { 
            stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
            execArgv: ['--expose-gc'] 
        });
        
        const workerEntry: { process: ChildProcess, busy: boolean, initialized: boolean, currentTask?: any } = { 
            process, busy: false, initialized: false 
        };
        this.pool.push(workerEntry);

        process.on('message', (message: any) => {
            if (message.type === 'init-success') {
                const wasEmpty = this.pool.every(w => !w.initialized);
                workerEntry.initialized = true;
                workerEntry.busy = false;
                
                if (wasEmpty) {
                    mainWindow?.webContents.send('system-status', { status: 'ready', message: i18next.t('status.ready') });
                }
                
                this.nextTask();
            } else if (message.type === 'init-error') {
                console.error('[WorkerPool] Worker init error:', message.error);
                mainWindow?.webContents.send('system-status', { status: 'error', message: i18next.t('status.ai_error') || 'AI Initialization Error' });
                workerEntry.busy = false;
            } else if (message.type === 'file-status') {
                mainWindow?.webContents.send('batch-progress', {
                    ...message.data,
                    current: this.batchState.processed + this.batchState.warnings + this.batchState.errors + 1,
                    total: this.batchState.total
                });
            } else if (message.type === 'file-done') {
                if (message.data.status === 'success') this.batchState.processed++;
                else if (message.data.status === 'warning') this.batchState.warnings++;
                else this.batchState.errors++;

                mainWindow?.webContents.send('batch-progress', {
                    ...message.data,
                    current: this.batchState.processed + this.batchState.warnings + this.batchState.errors,
                    total: this.batchState.total
                });

                workerEntry.busy = false;
                workerEntry.currentTask = undefined;
                this.nextTask();
            }
        });

        process.on('exit', (code) => {
            console.warn(`[WorkerPool] Worker exited unexpectedly with code ${code}.`);
            
            /** Handle orphan task if worker crashed during processing */
            if (workerEntry.currentTask) {
                this.batchState.errors++;
                const fileName = path.basename(workerEntry.currentTask.inputPath);
                
                mainWindow?.webContents.send('batch-progress', {
                    file: fileName,
                    status: 'error',
                    error: 'ERR_WORKER_CRASH',
                    current: this.batchState.processed + this.batchState.warnings + this.batchState.errors,
                    total: this.batchState.total
                });
            }

            this.pool = this.pool.filter(w => w.process !== process);
            
            /** Continue queue processing despite process failure */
            this.nextTask();
        });

        workerEntry.busy = true;
        process.send({ type: 'init', appPath: this.appPath });
    }

    /** Orchestrates task distribution among available workers */
    private nextTask() {
        if (this.taskQueue.length === 0) {
            if (this.activeCount() === 0 && this.currentJobId) {
                const job = activeJobs.get(this.currentJobId);
                if (job) {
                    /** Release resources post-batch while maintaining one warm worker */
                    this.shrinkPool();
                    job.resolve({ 
                        processed: this.batchState.processed, 
                        warnings: this.batchState.warnings, 
                        errors: this.batchState.errors 
                    });
                    activeJobs.delete(this.currentJobId);
                    this.currentJobId = null;
                }
            }
            return;
        }

        const idleWorker = this.pool.find(w => !w.busy && w.initialized);
        if (idleWorker) {
            const task = this.taskQueue.shift();
            idleWorker.busy = true;
            idleWorker.currentTask = task;
            idleWorker.process.send({ type: 'process-file', config: task });
        } else if (this.pool.length < this.maxConcurrency) {
            this.spawnWorker();
        }
    }

    /** Reduces memory footprint by terminating excess workers and triggering cleanup */
    private shrinkPool() {
        console.log('[WorkerPool] Shrinking pool to release memory...');
        /** Identify redundant workers, retaining one initialized process for hibernation */
        const toKeep = this.pool.find(w => w.initialized);
        const toKill = this.pool.filter(w => w !== toKeep);

        /** Terminate excess processes */
        toKill.forEach(w => w.process.kill());
        
        /** Retain only the hibernation worker */
        this.pool = toKeep ? [toKeep] : [];

        /** Command internal memory cleanup in the surviving worker */
        if (toKeep) {
            toKeep.process.send({ type: 'cleanup' });
        }
    }

    /** Returns current number of workers executing tasks */
    private activeCount() {
        return this.pool.filter(w => w.busy).length;
    }

    /** Ensures at least one worker is ready before user starts a batch */
    public preloadWorker() {
        if (this.pool.length === 0) {
            this.spawnWorker();
        }
    }

    /** Checks if AI models are loaded in at least one worker */
    public isReady() {
        return this.pool.some(w => w.initialized);
    }

    /** Initializes batch processing for a set of files or a directory */
    public startBatch(jobId: string, config: any) {
        this.currentJobId = jobId;
        this.batchState = { processed: 0, warnings: 0, errors: 0, total: 0 };
        this.taskQueue = [];

        let files: string[] = [];
        try {
            if (config.inputFiles && Array.isArray(config.inputFiles)) {
                files = config.inputFiles.map((f: any) => f.path);
            } else if (config.inputDir) {
                /** Prevent race conditions if source directory was moved or deleted */
                if (!fs.existsSync(config.inputDir)) {
                    throw new Error('DIRECTORY_NOT_FOUND');
                }
                files = fs.readdirSync(config.inputDir)
                    .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
                    .map(f => path.join(config.inputDir, f));
            }
        } catch (e: any) {
            throw new Error(`Source read error: ${e.message}`);
        }

        if (files.length === 0) {
            throw new Error('NO_IMAGES_FOUND');
        }

        this.batchState.total = files.length;

        this.taskQueue = files.map(filePath => ({
            inputPath: filePath,
            outputDir: config.outputDir,
            preset: config.preset,
            bgColor: config.bgColor,
            customDims: config.customDims
        }));

        const targetWorkers = Math.min(this.maxConcurrency, this.batchState.total);
        
        while (this.pool.length < targetWorkers) {
            this.spawnWorker();
        }

        for (let i = 0; i < this.pool.length; i++) {
            if (!this.pool[i].busy && this.pool[i].initialized) {
                this.nextTask();
            }
        }
    }

    /** Immediate termination of all background processes */
    public killAll() {
        this.pool.forEach(w => w.process.kill());
        this.pool = [];
    }
}

const workerPool = new WorkerPool(app.getAppPath());

/** 
 * Configures i18next for multi-language support. 
 * Detects system locale and falls back to English.
 */
async function initI18n() {
    await i18next
        .use(Backend)
        .init({
            lng: app.getLocale().startsWith('es') ? 'es' : 'en',
            fallbackLng: 'en',
            preload: ['en', 'es'],
            backend: {
                loadPath: path.join(__dirname, '../src/locales/{{lng}}.json')
            },
            interpolation: {
                escapeValue: false
            }
        });
}

/** Builds and sets the native application menu with localization support */
function createMenu() {
    const template: any[] = [
        {
            label: i18next.t('app.menu_file') || 'File',
            submenu: [
                { 
                    label: i18next.t('app.menu_add_folder') || 'Add folder...', 
                    click: () => mainWindow?.webContents.send('trigger-add-folder') 
                },
                { 
                    label: i18next.t('app.menu_add_files') || 'Add images...', 
                    click: () => mainWindow?.webContents.send('trigger-add-files') 
                },
                { type: 'separator' },
                { 
                    label: i18next.t('app.menu_quit') || 'Quit', 
                    role: 'quit' 
                }
            ]
        },
        {
            label: i18next.t('app.language_menu') || 'Language',
            submenu: [
                {
                    label: 'Español',
                    type: 'radio',
                    checked: i18next.language === 'es',
                    click: () => changeLanguage('es')
                },
                {
                    label: 'English',
                    type: 'radio',
                    checked: i18next.language === 'en',
                    click: () => changeLanguage('en')
                }
            ]
        },
        {
            label: i18next.t('app.menu_view') || 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            label: i18next.t('app.help_menu') || 'Help',
            submenu: [
                {
                    label: i18next.t('app.help_start') || 'Getting Started',
                    click: () => mainWindow?.webContents.send('show-help')
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

/** Updates application language and notifies renderer process */
async function changeLanguage(lng: string) {
    await i18next.changeLanguage(lng);
    createMenu();
    mainWindow?.webContents.send('language-changed', {
        lng,
        translations: i18next.getResourceBundle(lng, 'translation')
    });
}

/** Initializes the main browser window */
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 850,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        show: false
    });

    mainWindow.loadFile(path.join(__dirname, '../src/index.html'));

    mainWindow.once('ready-to-show', () => {
        mainWindow?.show();
        mainWindow?.webContents.send('language-changed', {
            lng: i18next.language,
            translations: i18next.getResourceBundle(i18next.language, 'translation')
        });
        mainWindow?.webContents.send('system-status', { status: 'ready', message: i18next.t('status.ready') });
    });
}

/** Application lifecycle entry point */
app.whenReady().then(async () => {
    await initI18n();
    createMenu();
    createWindow();
    
    workerPool.preloadWorker();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    workerPool.killAll();
    if (process.platform !== 'darwin') app.quit();
});

/** Inter-Process Communication (IPC) Handlers */
ipcMain.handle('get-system-status', () => {
    return {
        status: workerPool.isReady() ? 'ready' : 'loading',
        message: workerPool.isReady() ? i18next.t('status.ready') : i18next.t('status.loading')
    };
});

ipcMain.handle('open-path', async (event, targetPath) => {
    if (typeof targetPath === 'string') {
        try {
            const absolutePath = path.resolve(targetPath);
            const stats = await fs.promises.stat(absolutePath);
            /** Security check to prevent opening non-directory paths */
            if (stats.isDirectory()) {
                await shell.openPath(absolutePath);
            } else {
                console.warn(`[Security] Blocked attempt to open non-directory path: ${absolutePath}`);
            }
        } catch (e) {
            console.error(`[Security] Invalid path requested: ${targetPath}`);
        }
    }
});

ipcMain.handle('select-input-dir', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('select-files', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
    });
    return result.canceled ? null : result.filePaths;
});

ipcMain.handle('select-output-dir', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('start-batch', async (event, config) => {
    const jobId = Math.random().toString(36).substring(7);

    return new Promise((resolve, reject) => {
        try {
            activeJobs.set(jobId, { resolve, reject });
            workerPool.startBatch(jobId, config);
        } catch (err: any) {
            activeJobs.delete(jobId);
            reject(err);
        }
    });
});

ipcMain.handle('get-translations', async () => {
    return {
        lng: i18next.language,
        translations: i18next.getResourceBundle(i18next.language, 'translation')
    };
});

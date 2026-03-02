/** 
 * Renderer process orchestration: state management, UI logic, and internationalization.
 * Handles user interactions, batch progress visualization, and IPC communication.
 */

/// <reference path="./global.d.ts" />

document.addEventListener('DOMContentLoaded', async () => {
    /** Application state container */
    const state = {
        inputDir: null as string | null,
        inputFiles: [] as { path: string; size: number }[],
        outputDir: null as string | null,
        selectedBgColor: '#FFFFFF',
        isAiReady: false,
        translations: {} as any,
        currentLng: 'es',
        batch: {
            processed: 0,
            warnings: 0,
            errors: 0,
            total: 0
        }
    };

    /** DOM node cache */
    const nodes = {
        btnInput: document.getElementById('btn-input') as HTMLButtonElement,
        btnFiles: document.getElementById('btn-files') as HTMLButtonElement,
        btnOutput: document.getElementById('btn-output') as HTMLButtonElement,
        btnStart: document.getElementById('btn-start') as HTMLButtonElement,
        txtOutput: document.getElementById('txt-output') as HTMLElement,
        systemStatus: document.getElementById('system-status') as HTMLElement,
        selectPreset: document.getElementById('select-preset') as HTMLSelectElement,
        customDimsWrapper: document.getElementById('custom-dims-wrapper') as HTMLDivElement,
        customWidth: document.getElementById('custom-width') as HTMLInputElement,
        customHeight: document.getElementById('custom-height') as HTMLInputElement,
        bgColorSelect: document.getElementById('bg-color-select') as HTMLSelectElement,
        colorPicker: document.getElementById('color-picker') as HTMLInputElement,
        customColorWrapper: document.getElementById('custom-color-wrapper') as HTMLDivElement,
        filesTbody: document.getElementById('files-tbody') as HTMLTableSectionElement,
        progressTbody: document.getElementById('progress-tbody') as HTMLTableSectionElement,
        resultModal: document.getElementById('result-modal') as HTMLDialogElement,
        modalSuccessCount: document.getElementById('modal-success-count') as HTMLElement,
        modalWarningCount: document.getElementById('modal-warning-count') as HTMLElement,
        modalErrorCount: document.getElementById('modal-error-count') as HTMLElement,
        btnCloseModal: document.getElementById('btn-close-modal') as HTMLButtonElement,
        btnOpenResult: document.getElementById('btn-open-result') as HTMLButtonElement,
        helpModal: document.getElementById('help-modal') as HTMLDialogElement,
        btnCloseHelp: document.getElementById('btn-close-help') as HTMLButtonElement
    };

    /** Initialize Lucide icons on page load */
    lucide.createIcons();

    /** Internationalization engine: retrieves translated strings from the loaded dictionary */
    const getTranslation = (path: string) => {
        return path.split('.').reduce((obj, key) => obj && obj[key], state.translations) || path;
    };

    /** Applies localized strings to all DOM elements with i18n attributes */
    const applyTranslations = () => {
        /** Replace text content based on data-i18n attributes */
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (key) el.textContent = getTranslation(key);
        });

        /** Update attributes like tooltips and aria-labels dynamically */
        document.querySelectorAll('[data-i18n-attr]').forEach(el => {
            const attrString = el.getAttribute('data-i18n-attr');
            if (attrString) {
                attrString.split(';').forEach(pair => {
                    const [attr, key] = pair.split(':');
                    if (attr && key) el.setAttribute(attr, getTranslation(key));
                });
            }
        });

        /** Update UI elements with conditional text states */
        if (!state.outputDir) {
            nodes.txtOutput.textContent = getTranslation('output.empty_path');
        }

        /** Refresh tooltips for progress table warning tags */
        nodes.progressTbody.querySelectorAll('.tag-warning').forEach(el => {
            el.setAttribute('data-tooltip', getTranslation('batch.not_apt'));
        });
        
        renderSourceTable();
    };

    const showHelp = () => {
        nodes.helpModal.showModal();
        lucide.createIcons({ root: nodes.helpModal });
    };

    /** Updates the system status indicator in the UI */
    const updateSystemStatus = (status: 'ready' | 'error' | 'loading', message: string) => {
        nodes.systemStatus.dataset.status = status;
        nodes.systemStatus.innerHTML = `<small>${message}</small>`;
        state.isAiReady = (status === 'ready');
        checkReadiness();
    };

    /** Validates if all requirements are met to enable batch processing */
    const checkReadiness = () => {
        const hasInput = (state.inputDir !== null) || (state.inputFiles.length > 0);
        let customValid = true;
        if (nodes.selectPreset.value === 'custom') {
            const w = parseFloat(nodes.customWidth.value);
            const h = parseFloat(nodes.customHeight.value);
            customValid = !isNaN(w) && w > 0 && !isNaN(h) && h > 0;
        }
        nodes.btnStart.disabled = !(hasInput && state.outputDir && state.isAiReady && customValid);
    };

    const basename = (path: string): string => path.split(/[\\/]/).pop() || path;

    /** Renders the list of selected files or the source directory in the UI */
    const renderSourceTable = () => {
        nodes.filesTbody.innerHTML = '';
        
        if (!state.inputDir && state.inputFiles.length === 0) {
            const row = nodes.filesTbody.insertRow();
            row.innerHTML = `
                <td colspan="2" style="text-align: center; padding: 2rem; color: var(--pico-muted-color);">
                    <em>${getTranslation('import.empty_state')}</em>
                </td>
            `;
            return;
        }

        if (state.inputDir) {
            const row = nodes.filesTbody.insertRow();
            row.innerHTML = `
                <td><i data-lucide="folder"></i> <strong>${basename(state.inputDir)}</strong> <small>(${getTranslation('import.full_directory')})</small></td>
                <td></td>
            `;
        }

        state.inputFiles.forEach((file, index) => {
            const row = nodes.filesTbody.insertRow();
            row.innerHTML = `
                <td>${basename(file.path)}</td>
                <td style="text-align: right">
                    <button class="btn-remove" data-index="${index}" aria-label="${getTranslation('import.remove_aria')}">
                        <i data-lucide="trash"></i>
                    </button>
                </td>
            `;
        });

        lucide.createIcons({ root: nodes.filesTbody });
    };

    /** UI listeners for configuration changes */
    nodes.selectPreset.addEventListener('change', () => {
        const isCustom = nodes.selectPreset.value === 'custom';
        nodes.customDimsWrapper.hidden = !isCustom;
        checkReadiness();
    });

    nodes.customWidth.addEventListener('input', checkReadiness);
    nodes.customHeight.addEventListener('input', checkReadiness);

    nodes.bgColorSelect.addEventListener('change', () => {
        const isCustom = nodes.bgColorSelect.value === 'custom';
        nodes.customColorWrapper.hidden = !isCustom;
        state.selectedBgColor = isCustom ? nodes.colorPicker.value : nodes.bgColorSelect.value;
    });

    nodes.colorPicker.addEventListener('input', () => {
        state.selectedBgColor = nodes.colorPicker.value;
    });

    /** Source and output directory selection handlers */
    nodes.btnInput.addEventListener('click', async () => {
        const dir = await window.electronAPI.selectInputDir();
        if (dir) {
            state.inputDir = dir;
            state.inputFiles = [];
            renderSourceTable();
            checkReadiness();
        }
    });

    nodes.btnFiles.addEventListener('click', async () => {
        const files = await window.electronAPI.selectFiles();
        if (files?.length) {
            state.inputDir = null;
            state.inputFiles.push(...files.map(path => ({ path, size: 0 })));
            renderSourceTable();
            checkReadiness();
        }
    });

    nodes.btnOutput.addEventListener('click', async () => {
        const dir = await window.electronAPI.selectOutputDir();
        if (dir) {
            state.outputDir = dir;
            nodes.txtOutput.textContent = basename(dir);
            checkReadiness();
        }
    });

    nodes.filesTbody.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const btn = target.closest('.btn-remove') as HTMLButtonElement;
        if (btn) {
            const index = parseInt(btn.dataset.index || '0');
            state.inputFiles.splice(index, 1);
            renderSourceTable();
            checkReadiness();
        }
    });

    /** IPC Listeners for system status and batch progress */
    window.electronAPI.onSystemStatus((data) => {
        updateSystemStatus(data.status as any, data.message);
    });

    window.electronAPI.onBatchProgress((data) => {
        if (data.status === 'processing') {
            state.batch.total = data.total;
        }

        let row = document.getElementById(`row-${data.file}`) as HTMLTableRowElement;
        
        /** Create a new progress row if it doesn't exist yet */
        if (!row && data.status === 'processing') {
            row = nodes.progressTbody.insertRow();
            row.id = `row-${data.file}`;
            row.innerHTML = `
                <td>${data.file}</td>
                <td><div class="status-wrapper"><progress></progress></div></td>
            `;
        }

        if (row) {
            const statusCell = row.cells[1];
            if (data.status === 'success') {
                state.batch.processed++;
                statusCell.innerHTML = `<div class="status-wrapper tag-success"><i data-lucide="check-circle"></i></div>`;
            } else if (data.status === 'warning') {
                state.batch.warnings++;
                statusCell.innerHTML = `<div class="status-wrapper tag-warning" data-tooltip="${getTranslation('batch.not_apt')}" data-placement="left"><i data-lucide="triangle-alert"></i></div>`;
            } else if (data.status === 'error') {
                state.batch.errors++;
                let errorTooltip = data.error;
                /** Map error codes to localized messages */
                if (data.error === 'ERR_UNSUPPORTED_FORMAT') errorTooltip = getTranslation('error.unsupported_format');
                else if (data.error === 'ERR_FILE_NOT_FOUND') errorTooltip = getTranslation('error.file_not_found');
                else if (data.error === 'ERR_DIMS_TOO_LARGE') errorTooltip = getTranslation('error.dims_too_large');
                else if (data.error === 'ERR_READ_FILE') errorTooltip = getTranslation('error.read_file');
                else if (data.error === 'ERR_WORKER_CRASH') errorTooltip = getTranslation('error.worker_crash');
                else if (data.error === 'AI_NOT_INITIALIZED') errorTooltip = getTranslation('error.ai_not_init');
                
                statusCell.innerHTML = `<div class="status-wrapper tag-error" data-tooltip="${errorTooltip}" data-placement="left"><i data-lucide="octagon-x"></i></div>`;
            }
            lucide.createIcons({ root: row });
            row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    });

    /** Triggers batch processing with current configuration */
    nodes.btnStart.addEventListener('click', async () => {
        nodes.btnStart.ariaBusy = "true";
        const controls = [nodes.btnStart, nodes.btnInput, nodes.btnFiles, nodes.btnOutput, nodes.selectPreset, nodes.bgColorSelect, nodes.colorPicker];
        controls.forEach(c => c.disabled = true);

        nodes.progressTbody.innerHTML = '';
        state.batch = { processed: 0, warnings: 0, errors: 0, total: 0 };

        try {
            const result = await window.electronAPI.startBatch({
                inputDir: state.inputDir,
                inputFiles: state.inputFiles.length > 0 ? state.inputFiles : null,
                outputDir: state.outputDir,
                preset: nodes.selectPreset.value,
                bgColor: state.selectedBgColor,
                customDims: nodes.selectPreset.value === 'custom' ? {
                    width: parseFloat(nodes.customWidth.value),
                    height: parseFloat(nodes.customHeight.value)
                } : null
            });
            
            updateSystemStatus('ready', getTranslation('status.finished'));
            
            nodes.modalSuccessCount.textContent = result.processed?.toString() || '0';
            nodes.modalWarningCount.textContent = result.warnings?.toString() || '0';
            nodes.modalErrorCount.textContent = result.errors?.toString() || '0';
            nodes.resultModal.showModal();

        } catch (err: any) {
            let errorMsg = err.message || String(err);
            /** Handle common batch initiation errors */
            if (errorMsg.includes('NO_IMAGES_FOUND')) {
                errorMsg = getTranslation('error.no_images') || 'No valid images found.';
            } else if (errorMsg.includes('DIRECTORY_NOT_FOUND')) {
                errorMsg = getTranslation('error.dir_not_found') || 'Source directory was moved or deleted.';
            }
            updateSystemStatus('error', errorMsg);
        } finally {
            nodes.btnStart.ariaBusy = "false";
            controls.forEach(c => c.disabled = false);
            checkReadiness();
        }
    });

    nodes.btnCloseModal.addEventListener('click', () => {
        nodes.resultModal.close();
    });

    nodes.btnOpenResult.addEventListener('click', async () => {
        if (state.outputDir) {
            await window.electronAPI.openPath(state.outputDir);
        }
    });

    nodes.btnCloseHelp.addEventListener('click', () => {
        nodes.helpModal.close();
    });

    /** Handlers for language synchronization and UI help triggers */
    window.electronAPI.onLanguageChanged((data) => {
        state.currentLng = data.lng;
        state.translations = data.translations;
        applyTranslations();
    });

    window.electronAPI.onShowHelp(() => {
        showHelp();
    });

    /** Bridge for native menu actions */
    window.electronAPI.onTriggerAddFolder(() => {
        nodes.btnInput.click();
    });

    window.electronAPI.onTriggerAddFiles(() => {
        nodes.btnFiles.click();
    });

    /** Initialization: fetch translations and verify initial AI status */
    const initialData = await window.electronAPI.getTranslations();
    state.currentLng = initialData.lng;
    state.translations = initialData.translations;
    applyTranslations();
    
    const initialStatus = await window.electronAPI.getSystemStatus();
    updateSystemStatus(initialStatus.status as any, initialStatus.message);

    /** Onboarding: show help modal on the very first launch */
    if (!localStorage.getItem('hc_onboarding')) {
        showHelp();
        localStorage.setItem('hc_onboarding', 'true');
    }
});

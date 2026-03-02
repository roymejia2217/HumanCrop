interface Window {
    electronAPI: {
        openPath: (path: string) => Promise<void>;
        selectInputDir: () => Promise<string | null>;
        selectFiles: () => Promise<string[] | null>;
        selectOutputDir: () => Promise<string | null>;
        startBatch: (config: any) => Promise<{ success: boolean; processed?: number; warnings?: number; errors?: number; error?: string }>;
        getTranslations: () => Promise<{ lng: string; translations: any }>;
        getSystemStatus: () => Promise<{ status: string; message: string }>;
        onLanguageChanged: (callback: (data: { lng: string; translations: any }) => void) => void;
        onSystemStatus: (callback: (data: { status: string; message: string }) => void) => void;
        onBatchProgress: (callback: (data: any) => void) => void;
        onShowHelp: (callback: () => void) => void;
        onTriggerAddFolder: (callback: () => void) => void;
        onTriggerAddFiles: (callback: () => void) => void;
    }
}

declare const lucide: any;

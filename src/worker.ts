import * as fs from 'fs';
import * as path from 'path';
import { ImageProcessor } from './processor';

/** Initialize image processor instance within the worker context */
const processor = new ImageProcessor();

/** Handle incoming messages from the main process */
process.on('message', async (message: any) => {
    try {
        if (message.type === 'init') {
            await processor.initialize(message.appPath);
            process.send?.({ type: 'init-success' });
        } 
        else if (message.type === 'process-file') {
            const { inputPath, outputDir, preset, bgColor, customDims } = message.config;
            const fileName = path.basename(inputPath);
            let fileSize = 0;

            try {
                /** Prevent race condition if file was deleted after the batch started */
                if (!fs.existsSync(inputPath)) {
                    throw new Error("ERR_FILE_NOT_FOUND");
                }
                fileSize = fs.statSync(inputPath).size;

                process.send?.({ 
                    type: 'file-status',
                    data: { file: fileName, status: 'processing', size: fileSize }
                });
                        
                const result = await processor.processFile(inputPath, outputDir, preset, bgColor, customDims);
                        
                process.send?.({ 
                    type: 'file-done',
                    data: {
                        file: fileName, 
                        status: result?.isApt ? 'success' : 'warning',
                        size: fileSize
                    }
                });            
            } catch (err: any) {
                let errorCode = err.message || String(err);
                /** Normalize error codes for front-end mapping */
                if (errorCode.includes("unsupported image format") || errorCode.includes("Input buffer contains")) {
                    errorCode = "ERR_UNSUPPORTED_FORMAT";
                }
                
                process.send?.({ 
                    type: 'file-done',
                    data: { file: fileName, status: 'error', error: errorCode, size: fileSize }
                });
            }
        }
        else if (message.type === 'cleanup') {
            /** Execute memory cleanup and garbage collection in the worker process */
            await processor.cleanup();
            if (global.gc) global.gc();
        }
    } catch (error: any) {
        const type = message.type === 'init' ? 'init-error' : 'fatal-error';
        process.send?.({ type, error: error.message || String(error) });
    }
});

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';
import sharp from 'sharp';

let onnxRuntime: any = null;

/** Performance optimization: restrict concurrency to manage per-worker memory overhead */
sharp.concurrency(1);

/** Robust loader for @vladmandic/human using pure WASM build for Electron compatibility */
let Human: any;
try {
    /** Force pure WASM build to avoid native tfjs-node dependencies that clash with Electron's binary system */
    const mainPath = require.resolve('@vladmandic/human');
    const wasmPath = path.join(path.dirname(mainPath), 'human.node-wasm.js');
    const humanModule = require(wasmPath);
    Human = humanModule.Human || humanModule.default || humanModule;
} catch (e) {
    console.error('[Processor] Critical error loading Human library:', e);
}

const PRESETS: Record<string, { width: number, height: number, headRatio: number, topMargin: number }> = {
    passport_eu: { width: 413, height: 531, headRatio: 0.75, topMargin: 0.08 }, // 35x45mm: UE, UK, AU, MX
    passport_us: { width: 602, height: 602, headRatio: 0.60, topMargin: 0.10 }, // 2x2in: USA, IN, VE
    id_latin:    { width: 354, height: 472, headRatio: 0.75, topMargin: 0.08 }, // 30x40mm: CO, BR, PE, KR
    canada:      { width: 591, height: 827, headRatio: 0.75, topMargin: 0.08 }, // 50x70mm
    china:       { width: 390, height: 567, headRatio: 0.75, topMargin: 0.08 }, // 33x48mm
    japan:       { width: 531, height: 531, headRatio: 0.75, topMargin: 0.08 }, // 45x45mm
    arabia_uae:  { width: 472, height: 709, headRatio: 0.75, topMargin: 0.08 }, // 40x60mm
    cv:          { width: 600, height: 600, headRatio: 0.55, topMargin: 0.15 }  // CV standard
};

const BACKGROUND_MODEL_KEY = '/models/medium';
const BACKGROUND_INFERENCE_SIZE = 1024;

function getOnnxRuntime() {
    if (!onnxRuntime) {
        onnxRuntime = require('onnxruntime-node');
    }

    return onnxRuntime;
}

/** 
 * Core image processing logic including background removal and biometric cropping.
 * Designed for 100% offline execution using local models.
 */
export class ImageProcessor {
    private human: any;
    public isInitialized: boolean = false;
    private appPath: string = '';
    private backgroundSession: any = null;

    constructor() {
        if (!Human) {
            throw new Error('Human library failed to load.');
        }
    }

    /** Prepares AI models and initializes backends */
    public async initialize(appPath: string) {
        if (this.isInitialized) return;
        this.appPath = appPath;
        
        console.log('[Processor] Starting Offline AI initialization...');

        /** 
         * Global fetch interceptor for Node.js 18+ to handle local file:// requests for offline AI models.
         * Safe within isolated worker processes.
         */
        if (!(globalThis as any)._fetchOverridden) {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
                const urlStr = typeof url === 'string' ? url : (url instanceof URL ? url.href : (url as any).url);
                if (urlStr && urlStr.startsWith('file:')) {
                    try {
                        const filePath = fileURLToPath(urlStr);
                        if (!fs.existsSync(filePath)) {
                            throw new Error(`MODEL_NOT_FOUND: ${filePath}`);
                        }
                        const data = fs.readFileSync(filePath);
                        return new Response(data, {
                            status: 200,
                            statusText: 'OK',
                            headers: { 'Content-Type': urlStr.endsWith('.json') ? 'application/json' : 'application/octet-stream' }
                        });
                    } catch (e: any) {
                        console.error(`[Processor] Local file read failed via fetch: ${urlStr}`, e);
                        throw e;
                    }
                }
                return originalFetch(url, init);
            };
            (globalThis as any)._fetchOverridden = true;
        }
        
        try {
            /** Configure local filesystem paths for AI models */
            const modelsRoot = path.join(this.appPath, 'src', 'assets', 'models');
            const humanModelsPath = pathToFileURL(path.join(modelsRoot, 'human')).href + '/';
            
            /** Configure TensorFlow.js WASM backend using native paths to avoid resolution issues */
            const tfWasmPath = path.join(path.dirname(require.resolve('@tensorflow/tfjs-backend-wasm')), './') + path.sep;
            
            const config = {
                backend: 'wasm' as const,
                wasmPath: tfWasmPath,
                modelBasePath: humanModelsPath,
                /** Explicitly disable unused features to prevent resource waste and 404 fetch errors */
                face: { 
                    enabled: true, 
                    detector: { modelPath: 'blazeface.json' },
                    mesh: { enabled: false }, 
                    iris: { enabled: false },
                    description: { enabled: false },
                    emotion: { enabled: false }
                },
                body: { enabled: false },
                hand: { enabled: false },
                object: { enabled: false },
                segmentation: { enabled: false },
                debug: false,
                async: true
            };
            
            this.human = new Human(config);

            console.log('[Processor] Calling human.init()...');
            await this.human.init();
            
            console.log('[Processor] Loading face detection model...');
            await this.human.load();
            
            this.isInitialized = true;
            console.log('[Processor] Offline AI initialization complete.');
        } catch (error) {
            console.error('[Processor] AI initialization failed:', error);
            throw error;
        }
    }

    /** 
     * Processes a single image: removes background, detects face, and crops to biometric standard.
     * Implements atomic writes to prevent file corruption.
     */
    public async processFile(inputPath: string, outputDir: string, presetKey: string, bgColor: string, customDims?: { width: number, height: number }) {
        if (!this.isInitialized) throw new Error("AI_NOT_INITIALIZED");
        
        let preset = PRESETS[presetKey] || PRESETS['passport_eu'];

        /** Custom preset: calculate dimensions from mm to pixels at 300 DPI */
        if (presetKey === 'custom' && customDims) {
            /** Security limit: 1000mm maximum to prevent Out-Of-Memory (OOM) in Sharp */
            if (customDims.width > 1000 || customDims.height > 1000) {
                throw new Error("ERR_DIMS_TOO_LARGE");
            }
            preset = {
                width: Math.round((customDims.width * 300) / 25.4),
                height: Math.round((customDims.height * 300) / 25.4),
                headRatio: 0.75, // Default ICAO standard for custom
                topMargin: 0.08  // Default ICAO standard for custom
            };
        }

        console.log('[Processor] Processing:', inputPath);

        let rawBuffer: Buffer;
        try {
            rawBuffer = fs.readFileSync(inputPath);
        } catch (e: any) {
            throw new Error('ERR_READ_FILE');
        }

        /** Metadata validation: protection against decompression bombs or extremely large images */
        try {
            const initialMeta = await sharp(rawBuffer).metadata();
            if ((initialMeta.width && initialMeta.width > 15000) || (initialMeta.height && initialMeta.height > 15000)) {
                throw new Error("ERR_DIMS_TOO_LARGE");
            }
        } catch (e: any) {
            if (e.message === 'ERR_DIMS_TOO_LARGE') throw e;
            throw new Error('ERR_UNSUPPORTED_FORMAT');
        }
        
        /** Normalize orientation and resize to internal working resolution (max 1280px) */
        const workingBuffer = await sharp(rawBuffer)
            .rotate()
            .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
            .toBuffer();
        
        const meta = await sharp(workingBuffer).metadata();
        const imgW = meta.width || 0;
        const imgH = meta.height || 0;

        /** Face detection performed on the optimized working resolution */
        const rawData = await sharp(workingBuffer)
            .removeAlpha()
            .raw()
            .toBuffer();
        
        const tensor = this.human.tf.tensor3d(
            new Uint8Array(rawData),
            [imgH, imgW, 3],
            'int32'
        );
        
        console.log('[Processor] Running face detection...');
        const result = await this.human.detect(tensor);
        tensor.dispose();

        /** Offline background removal using local models */
        const imglyModelsPath = pathToFileURL(path.join(this.appPath, 'src', 'assets', 'models', 'imgly')).href + '/';

        console.log('[Processor] Running offline background removal...');
        const noBgBuffer = await this.removeBackground(workingBuffer, imgW, imgH, imglyModelsPath, result.face?.[0]?.box);

        let compositeBuffer: Buffer;

        if (result.face && result.face.length > 0) {
            const CROWN_TO_CHIN_FACTOR = 1.35;
            const [fX, fY, fW, fH] = result.face[0].box;
            
            const estimatedFullHeadHeight = fH * CROWN_TO_CHIN_FACTOR;
            const scale = (preset.height * preset.headRatio) / estimatedFullHeadHeight;

            const resizedW = Math.round(imgW * scale);
            const resizedPersonBuffer = await sharp(noBgBuffer).resize({ width: resizedW }).toBuffer();
            const resizedMeta = await sharp(resizedPersonBuffer).metadata();
            const rW = resizedMeta.width || resizedW;
            const rH = resizedMeta.height || 0;

            const faceCenterX = fX + fW / 2;
            const crownY = fY - (fH * 0.25);

            const scaledFaceCenterX = faceCenterX * scale;
            const scaledCrownY = crownY * scale;

            const targetTopPx = Math.round(preset.height * preset.topMargin);
            const leftOffset = Math.round((preset.width / 2) - scaledFaceCenterX);
            const topOffset = Math.round(targetTopPx - scaledCrownY);

            const cropLeft = Math.floor(Math.max(0, Math.min(rW - 1, -leftOffset)));
            const cropTop = Math.floor(Math.max(0, Math.min(rH - 1, -topOffset)));
            
            const compLeft = Math.floor(Math.max(0, Math.min(preset.width - 1, leftOffset)));
            const compTop = Math.floor(Math.max(0, Math.min(preset.height - 1, topOffset)));

            const cropWidth = Math.floor(Math.max(1, Math.min(preset.width - compLeft, rW - cropLeft)));
            const cropHeight = Math.floor(Math.max(1, Math.min(preset.height - compTop, rH - cropTop)));

            const personCropped = await sharp(resizedPersonBuffer)
                .extract({ left: cropLeft, top: cropTop, width: cropWidth, height: cropHeight })
                .toBuffer();

            const bgCanvas = await sharp({
                create: { width: preset.width, height: preset.height, channels: 4, background: bgColor }
            }).png().toBuffer();

            compositeBuffer = await sharp(bgCanvas)
                .composite([{ input: personCropped, top: compTop, left: compLeft }])
                .png()
                .toBuffer();

            const isApt = compLeft === 0 && compTop === 0 && 
                          cropWidth === (preset.width - compLeft) && 
                          cropHeight === (preset.height - compTop);

            const parsedPath = path.parse(inputPath);
            const outFilePath = path.join(outputDir, `${parsedPath.name}_${presetKey}.png`);
            const tempFilePath = path.join(outputDir, `.${parsedPath.name}_${presetKey}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.tmp`);

            await sharp(compositeBuffer)
                .png({ quality: 100 })
                .toFile(tempFilePath);
                
            fs.renameSync(tempFilePath, outFilePath);

            return { isApt };

        } else {
            const bgCanvas = await sharp({
                create: { width: preset.width, height: preset.height, channels: 4, background: bgColor }
            }).png().toBuffer();

            const resizedPerson = await sharp(noBgBuffer)
                .resize({ width: preset.width, height: preset.height, fit: 'inside' })
                .toBuffer();

            compositeBuffer = await sharp(bgCanvas)
                .composite([{ input: resizedPerson, gravity: 'center' }])
                .png()
                .toBuffer();

            const parsedPath = path.parse(inputPath);
            const outFilePath = path.join(outputDir, `${parsedPath.name}_${presetKey}.png`);
            const tempFilePath = path.join(outputDir, `.${parsedPath.name}_${presetKey}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.tmp`);

            await sharp(compositeBuffer)
                .png({ quality: 100 })
                .toFile(tempFilePath);
                
            fs.renameSync(tempFilePath, outFilePath);

            return { isApt: false };
        }
    }

    /** Releases native resources and triggers V8 garbage collection */
    public async cleanup() {
        console.log('[Processor] Performing memory cleanup...');
        /** Flush Sharp internal C++ buffer pool to release native memory */
        sharp.cache(false);
        sharp.cache(true);

        /** Trigger manual V8 garbage collection if enabled via --expose-gc flag */
        if (global.gc) {
            global.gc();
            console.log('[Processor] V8 Garbage Collector invoked.');
        }
    }

    /** Loads the local background removal ONNX model from IMG.LY resource chunks */
    private loadBackgroundModelBuffer(modelsPath: string): ArrayBuffer {
        const resourcesPath = path.join(modelsPath, 'resources.json');
        if (!fs.existsSync(resourcesPath)) {
            throw new Error('ERR_BG_MODEL_NOT_FOUND');
        }

        const resources = JSON.parse(fs.readFileSync(resourcesPath, 'utf8'));
        const modelEntry = resources[BACKGROUND_MODEL_KEY];
        if (!modelEntry?.chunks?.length) {
            throw new Error('ERR_BG_MODEL_NOT_FOUND');
        }

        const chunks = modelEntry.chunks.map((chunk: { hash: string, offsets: [number, number] }) => {
            const chunkPath = path.join(modelsPath, chunk.hash);
            if (!fs.existsSync(chunkPath)) {
                throw new Error('ERR_BG_MODEL_NOT_FOUND');
            }

            const data = fs.readFileSync(chunkPath);
            const expectedSize = chunk.offsets[1] - chunk.offsets[0];
            if (data.length !== expectedSize) {
                throw new Error('ERR_BG_MODEL_CORRUPT');
            }

            return data;
        });

        const model = Buffer.concat(chunks);
        if (model.length !== modelEntry.size) {
            throw new Error('ERR_BG_MODEL_CORRUPT');
        }

        return model.buffer.slice(model.byteOffset, model.byteOffset + model.byteLength);
    }

    /** Initializes a stable CPU-only ONNX session for Linux-compatible background removal */
    private async getBackgroundSession(modelsPath: string) {
        if (this.backgroundSession) {
            return this.backgroundSession;
        }

        const model = this.loadBackgroundModelBuffer(modelsPath);
        const ort = getOnnxRuntime();
        this.backgroundSession = await ort.InferenceSession.create(model, {
            executionProviders: ['cpu'],
            graphOptimizationLevel: 'basic',
            executionMode: 'sequential',
            intraOpNumThreads: 1,
            interOpNumThreads: 1,
            enableCpuMemArena: false,
            enableMemPattern: false
        });

        return this.backgroundSession;
    }

    /** Runs local segmentation directly through ONNX Runtime and applies the alpha mask with Sharp */
    private async removeBackground(workingBuffer: Buffer, imgW: number, imgH: number, imglyModelsPath: string, faceBox?: number[]): Promise<Buffer> {
        const modelsPath = fileURLToPath(imglyModelsPath);
        const session = await this.getBackgroundSession(modelsPath);

        const rgba = await sharp(workingBuffer)
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });

        if (rgba.info.width !== imgW || rgba.info.height !== imgH || rgba.info.channels !== 4) {
            throw new Error('ERR_UNSUPPORTED_FORMAT');
        }

        const resizedInput = await sharp(rgba.data, {
            raw: { width: imgW, height: imgH, channels: 4 }
        })
            .resize(BACKGROUND_INFERENCE_SIZE, BACKGROUND_INFERENCE_SIZE, { fit: 'fill' })
            .raw()
            .toBuffer();

        const pixelCount = BACKGROUND_INFERENCE_SIZE * BACKGROUND_INFERENCE_SIZE;
        const inputTensor = new Float32Array(3 * pixelCount);
        for (let sourceIndex = 0, pixelIndex = 0; sourceIndex < resizedInput.length; sourceIndex += 4, pixelIndex++) {
            inputTensor[pixelIndex] = (resizedInput[sourceIndex] - 128) / 256;
            inputTensor[pixelIndex + pixelCount] = (resizedInput[sourceIndex + 1] - 128) / 256;
            inputTensor[pixelIndex + pixelCount + pixelCount] = (resizedInput[sourceIndex + 2] - 128) / 256;
        }

        const ort = getOnnxRuntime();
        const output = await session.run({
            input: new ort.Tensor('float32', inputTensor, [1, 3, BACKGROUND_INFERENCE_SIZE, BACKGROUND_INFERENCE_SIZE])
        });

        const outputTensor = output.output || output[session.outputNames?.[0]];
        if (!outputTensor?.data) {
            throw new Error('ERR_BG_INFERENCE_FAILED');
        }

        const alphaMask = new Uint8Array(pixelCount);
        for (let index = 0; index < pixelCount; index++) {
            const alpha = Math.round(outputTensor.data[index] * 255);
            alphaMask[index] = Math.max(0, Math.min(255, alpha));
        }

        const resizedMask = this.resizeSingleChannelMask(
            alphaMask,
            BACKGROUND_INFERENCE_SIZE,
            BACKGROUND_INFERENCE_SIZE,
            imgW,
            imgH
        );

        const outputRgba = Buffer.from(rgba.data);
        for (let pixelIndex = 0; pixelIndex < imgW * imgH; pixelIndex++) {
            outputRgba[(pixelIndex * 4) + 3] = resizedMask[pixelIndex];
        }

        if (faceBox && !this.hasVisibleFaceAlpha(outputRgba, imgW, imgH, faceBox)) {
            console.warn('[Processor] Background mask did not preserve the detected face; using full-opacity source fallback.');
            return sharp(workingBuffer)
                .ensureAlpha(1)
                .png()
                .toBuffer();
        }

        return sharp(outputRgba, {
            raw: { width: imgW, height: imgH, channels: 4 }
        })
            .png()
            .toBuffer();
    }

    /** Mirrors IMG.LY tensorResizeBilinear for a one-channel alpha mask */
    private resizeSingleChannelMask(source: Uint8Array, sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number) {
        const resized = new Uint8Array(targetWidth * targetHeight);
        const scaleX = sourceWidth / targetWidth;
        const scaleY = sourceHeight / targetHeight;

        for (let y = 0; y < targetHeight; y++) {
            for (let x = 0; x < targetWidth; x++) {
                const sourceX = x * scaleX;
                const sourceY = y * scaleY;
                const x1 = Math.max(Math.floor(sourceX), 0);
                const x2 = Math.min(Math.ceil(sourceX), sourceWidth - 1);
                const y1 = Math.max(Math.floor(sourceY), 0);
                const y2 = Math.min(Math.ceil(sourceY), sourceHeight - 1);
                const dx = sourceX - x1;
                const dy = sourceY - y1;

                const topLeft = source[(y1 * sourceWidth) + x1];
                const topRight = source[(y1 * sourceWidth) + x2];
                const bottomLeft = source[(y2 * sourceWidth) + x1];
                const bottomRight = source[(y2 * sourceWidth) + x2];
                const value = ((1 - dx) * (1 - dy) * topLeft) +
                    (dx * (1 - dy) * topRight) +
                    ((1 - dx) * dy * bottomLeft) +
                    (dx * dy * bottomRight);

                resized[(y * targetWidth) + x] = Math.round(value);
            }
        }

        return resized;
    }

    /** Guards against invalid segmentation masks that would produce an empty biometric crop */
    private hasVisibleFaceAlpha(rgbaBuffer: Buffer, width: number, height: number, faceBox: number[]) {
        const [faceX, faceY, faceW, faceH] = faceBox;
        const left = Math.max(0, Math.floor(faceX + (faceW * 0.2)));
        const top = Math.max(0, Math.floor(faceY + (faceH * 0.2)));
        const right = Math.min(width - 1, Math.ceil(faceX + (faceW * 0.8)));
        const bottom = Math.min(height - 1, Math.ceil(faceY + (faceH * 0.8)));

        let alphaSum = 0;
        let sampleCount = 0;
        for (let y = top; y <= bottom; y += 4) {
            for (let x = left; x <= right; x += 4) {
                alphaSum += rgbaBuffer[((y * width + x) * 4) + 3];
                sampleCount++;
            }
        }

        return sampleCount > 0 && (alphaSum / sampleCount) >= 64;
    }
}

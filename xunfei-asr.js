// 讯飞语音识别 WebSocket 实现
class XunfeiASR {
    constructor(appId, apiKey, apiSecret) {
        this.appId = appId;
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
        this.ws = null;
        this.resultText = '';
    }

    // 生成 WebSocket 认证 URL
    getAuthUrl() {
        const url = 'wss://iat-api.xfyun.cn/v2/iat';
        const host = 'iat-api.xfyun.cn';
        const path = '/v2/iat';
        const date = new Date().toUTCString();

        // 构建签名原文
        const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`;

        // 使用 HMAC-SHA256 签名
        const signature = CryptoJS.HmacSHA256(signatureOrigin, this.apiSecret);
        const signatureBase64 = CryptoJS.enc.Base64.stringify(signature);

        // 构建 authorization
        const authorizationOrigin = `api_key="${this.apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signatureBase64}"`;
        const authorization = btoa(authorizationOrigin);

        // 构建完整 URL（必须包含 appid 参数）
        return `${url}?authorization=${encodeURIComponent(authorization)}&date=${encodeURIComponent(date)}&host=${host}&appid=${this.appId}`;
    }

    // 识别音频
    async recognize(audioBlob) {
        return new Promise((resolve, reject) => {
            this.resultText = '';

            // 创建 WebSocket 连接
            const wsUrl = this.getAuthUrl();
            console.log('WebSocket URL:', wsUrl);

            this.ws = new WebSocket(wsUrl);

            // 设置超时
            const timeout = setTimeout(() => {
                if (this.ws.readyState !== WebSocket.OPEN) {
                    this.ws.close();
                    reject(new Error('连接超时，请检查网络或 API 配置'));
                }
            }, 10000);

            this.ws.onopen = () => {
                console.log('WebSocket 连接成功');
                clearTimeout(timeout);
                // 发送音频数据
                this.sendAudio(audioBlob, resolve, reject);
            };

            this.ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                console.log('收到消息:', data);

                if (data.code !== 0) {
                    this.ws.close();
                    reject(new Error(data.message || `识别失败 (code: ${data.code})`));
                    return;
                }

                // 解析识别结果
                if (data.data && data.data.result) {
                    const ws = data.data.result.ws;
                    for (const item of ws) {
                        for (const w of item.cw) {
                            this.resultText += w.w;
                        }
                    }
                }

                // 识别完成
                if (data.data && data.data.status === 2) {
                    console.log('识别完成:', this.resultText);
                    this.ws.close();
                    resolve(this.resultText);
                }
            };

            this.ws.onerror = (error) => {
                console.error('WebSocket 错误:', error);
                clearTimeout(timeout);
                reject(new Error('WebSocket 连接失败，请检查：\n1. API 配置是否正确\n2. 网络连接是否正常\n3. 讯飞账号是否有额度'));
            };

            this.ws.onclose = (event) => {
                console.log('WebSocket 关闭:', event.code, event.reason);
                clearTimeout(timeout);
            };
        });
    }

    // 发送音频数据
    async sendAudio(audioBlob, resolve, reject) {
        const reader = new FileReader();

        reader.onload = async () => {
            try {
                const audioData = reader.result;
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const audioBuffer = await audioContext.decodeAudioData(audioData);

                // 转换为 16kHz 单声道 PCM
                const pcmData = this.convertToPCM(audioBuffer);

                // 分片发送
                const chunkSize = 1280; // 每次发送 1280 字节
                let offset = 0;
                let frameIndex = 0;

                const sendChunk = () => {
                    if (this.ws.readyState !== WebSocket.OPEN) {
                        reject(new Error('WebSocket 连接已断开'));
                        return;
                    }

                    if (offset >= pcmData.length) {
                        // 发送结束标识
                        const endFrame = {
                            common: {
                                app_id: this.appId
                            },
                            business: {
                                language: 'en_us',
                                domain: 'iat',
                                accent: 'mandarin',
                                vad_eos: 2000
                            },
                            data: {
                                status: 2,
                                format: 'audio/L16;rate=16000',
                                encoding: 'raw',
                                audio: ''
                            }
                        };
                        this.ws.send(JSON.stringify(endFrame));
                        return;
                    }

                    const chunk = pcmData.slice(offset, offset + chunkSize);
                    const base64Chunk = this.arrayBufferToBase64(chunk);

                    const frame = {
                        common: {
                            app_id: this.appId
                        },
                        business: frameIndex === 0 ? {
                            language: 'en_us',
                            domain: 'iat',
                            vad_eos: 5000
                        } : undefined,
                        data: {
                            status: frameIndex === 0 ? 0 : 1,
                            format: 'audio/L16;rate=16000',
                            encoding: 'raw',
                            audio: base64Chunk
                        }
                    };

                    this.ws.send(JSON.stringify(frame));
                    offset += chunkSize;
                    frameIndex++;

                    setTimeout(sendChunk, 40); // 每 40ms 发送一次
                };

                sendChunk();
            } catch (err) {
                reject(new Error('音频处理失败: ' + err.message));
            }
        };

        reader.onerror = () => {
            reject(new Error('音频文件读取失败'));
        };

        reader.readAsArrayBuffer(audioBlob);
    }

    // 转换为 16kHz 单声道 PCM
    convertToPCM(audioBuffer) {
        const targetSampleRate = 16000;
        const sourceSampleRate = audioBuffer.sampleRate;
        const ratio = sourceSampleRate / targetSampleRate;

        // 获取单声道数据
        const channelData = audioBuffer.getChannelData(0);
        const targetLength = Math.floor(channelData.length / ratio);
        const pcmData = new Int16Array(targetLength);

        // 重采样
        for (let i = 0; i < targetLength; i++) {
            const sourceIndex = Math.floor(i * ratio);
            const sample = channelData[sourceIndex];
            pcmData[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        }

        return pcmData.buffer;
    }

    // ArrayBuffer 转 Base64
    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }
}

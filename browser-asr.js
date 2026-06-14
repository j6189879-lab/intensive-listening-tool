// 浏览器内置语音识别 (Web Speech API)
class BrowserASR {
    constructor() {
        // 检查浏览器支持
        this.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!this.SpeechRecognition) {
            throw new Error('浏览器不支持语音识别，请使用 Chrome 或 Edge 浏览器');
        }
    }

    // 识别音频 Blob
    async recognize(audioBlob) {
        return new Promise((resolve, reject) => {
            try {
                // 创建音频元素播放
                const audio = new Audio();
                const audioUrl = URL.createObjectURL(audioBlob);
                audio.src = audioUrl;

                // 创建识别实例
                const recognition = new this.SpeechRecognition();
                recognition.continuous = false;
                recognition.interimResults = false;
                recognition.lang = 'en-US'; // 英文识别
                recognition.maxAlternatives = 1;

                let resultText = '';
                let hasStarted = false;

                recognition.onstart = () => {
                    console.log('语音识别已启动');
                    hasStarted = true;
                };

                recognition.onresult = (event) => {
                    console.log('识别结果:', event.results);
                    const transcript = event.results[0][0].transcript;
                    resultText = transcript;
                };

                recognition.onerror = (event) => {
                    console.error('识别错误:', event.error);
                    URL.revokeObjectURL(audioUrl);

                    if (event.error === 'no-speech') {
                        reject(new Error('未检测到语音内容'));
                    } else if (event.error === 'network') {
                        reject(new Error('网络错误，请检查网络连接'));
                    } else if (event.error === 'not-allowed') {
                        reject(new Error('请允许浏览器使用麦克风权限'));
                    } else {
                        reject(new Error(`识别失败: ${event.error}`));
                    }
                };

                recognition.onend = () => {
                    console.log('识别结束:', resultText);
                    URL.revokeObjectURL(audioUrl);

                    if (resultText) {
                        resolve(resultText);
                    } else if (hasStarted) {
                        // 如果已启动但没有结果，可能是静音片段
                        resolve('');
                    } else {
                        reject(new Error('识别未启动'));
                    }
                };

                // 播放音频并开始识别
                audio.oncanplaythrough = () => {
                    audio.play();
                    recognition.start();
                };

                audio.onerror = () => {
                    URL.revokeObjectURL(audioUrl);
                    reject(new Error('音频播放失败'));
                };

                // 设置超时
                setTimeout(() => {
                    if (!hasStarted) {
                        recognition.abort();
                        URL.revokeObjectURL(audioUrl);
                        reject(new Error('识别启动超时'));
                    }
                }, 10000);

            } catch (err) {
                reject(new Error('初始化识别失败: ' + err.message));
            }
        });
    }

    // 检查浏览器支持
    static isSupported() {
        return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    }
}

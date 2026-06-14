// 全局状态
let audioContext;
let audioBuffer;
let currentSource;
let segments = [];
let currentSegmentIndex = 0;
let isPlaying = false;
let playbackRate = 1.0;
let textData = []; // 存储文本数据
let currentAudioFile = null; // 存储当前音频文件

// DOM 元素
const uploadSection = document.getElementById('uploadSection');
const trainingSection = document.getElementById('trainingSection');
const loadingOverlay = document.getElementById('loadingOverlay');
const audioInput = document.getElementById('audioInput');
const playBtn = document.getElementById('playBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const resetBtn = document.getElementById('resetBtn');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const answerSection = document.getElementById('answerSection');
const answerPlaceholder = document.getElementById('answerPlaceholder');
const answerContent = document.getElementById('answerContent');
const answerEnglish = document.getElementById('answerEnglish');
const answerChinese = document.getElementById('answerChinese');
const waveform = document.getElementById('waveform');
const speedButtons = document.querySelectorAll('.btn-speed');
const addTextBtn = document.getElementById('addTextBtn');
const textModal = document.getElementById('textModal');
const closeModal = document.getElementById('closeModal');
const cancelTextBtn = document.getElementById('cancelTextBtn');
const saveTextBtn = document.getElementById('saveTextBtn');
const textInput = document.getElementById('textInput');
const segmentCount = document.getElementById('segmentCount');
const autoRecognizeBtn = document.getElementById('autoRecognizeBtn');
const recognizeModal = document.getElementById('recognizeModal');
const closeRecognizeModal = document.getElementById('closeRecognizeModal');
const cancelRecognizeBtn = document.getElementById('cancelRecognizeBtn');
const startRecognizeBtn = document.getElementById('startRecognizeBtn');
const batchRecognizeBtn = document.getElementById('batchRecognizeBtn');
const recognizeStatusText = document.getElementById('recognizeStatusText');
const recognizeProgressBar = document.getElementById('recognizeProgressBar');
const recognizeProgressLabel = document.getElementById('recognizeProgressLabel');
const recognizeSetup = document.getElementById('recognizeSetup');
const recognizeProgress = document.getElementById('recognizeProgress');
const xfyunAppIdInput = document.getElementById('xfyunAppIdInput');
const xfyunApiKeyInput = document.getElementById('xfyunApiKeyInput');
const xfyunApiSecretInput = document.getElementById('xfyunApiSecretInput');

// 初始化 Audio Context
function initAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
}

// 文件选择处理
audioInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    currentAudioFile = file; // 保存文件引用
    showLoading(true);

    try {
        initAudioContext();
        const arrayBuffer = await file.arrayBuffer();
        audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        // 自动分句
        await segmentAudio();

        // 切换到训练界面
        uploadSection.style.display = 'none';
        trainingSection.style.display = 'block';
        showLoading(false);

        // 尝试从 localStorage 加载文本数据
        const savedTextData = localStorage.getItem('textData');
        if (savedTextData) {
            try {
                textData = JSON.parse(savedTextData);
            } catch (e) {
                textData = [];
            }
        }

        // 初始化界面
        updateProgress();
        loadSegmentData();

    } catch (error) {
        console.error('音频加载失败:', error);
        alert('音频文件加载失败，请重试');
        showLoading(false);
    }
});

// 自动分句算法（基于静音检测）
async function segmentAudio() {
    const channelData = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const duration = audioBuffer.duration;

    // 参数配置
    const silenceThreshold = 0.02; // 静音阈值
    const minSilenceDuration = 0.3; // 最小静音时长（秒）
    const minSegmentDuration = 1.0; // 最小句子时长（秒）
    const maxSegmentDuration = 15.0; // 最大句子时长（秒）

    const silenceSamples = Math.floor(minSilenceDuration * sampleRate);
    const minSegmentSamples = Math.floor(minSegmentDuration * sampleRate);
    const maxSegmentSamples = Math.floor(maxSegmentDuration * sampleRate);

    segments = [];
    let segmentStart = 0;
    let silenceStart = -1;
    let consecutiveSilence = 0;

    // 扫描音频数据
    for (let i = 0; i < channelData.length; i++) {
        const amplitude = Math.abs(channelData[i]);

        if (amplitude < silenceThreshold) {
            // 检测到静音
            if (silenceStart === -1) {
                silenceStart = i;
            }
            consecutiveSilence++;

            // 如果静音持续足够长
            if (consecutiveSilence >= silenceSamples) {
                const segmentLength = silenceStart - segmentStart;

                // 检查句子长度是否合适
                if (segmentLength >= minSegmentSamples) {
                    const startTime = segmentStart / sampleRate;
                    const endTime = silenceStart / sampleRate;

                    segments.push({
                        start: startTime,
                        end: endTime,
                        duration: endTime - startTime
                    });

                    segmentStart = i;
                    silenceStart = -1;
                    consecutiveSilence = 0;
                }
                // 如果句子太长，强制分割
                else if (segmentLength >= maxSegmentSamples) {
                    const startTime = segmentStart / sampleRate;
                    const endTime = silenceStart / sampleRate;

                    segments.push({
                        start: startTime,
                        end: endTime,
                        duration: endTime - startTime
                    });

                    segmentStart = i;
                    silenceStart = -1;
                    consecutiveSilence = 0;
                }
            }
        } else {
            // 非静音
            silenceStart = -1;
            consecutiveSilence = 0;
        }
    }

    // 添加最后一个片段
    if (segmentStart < channelData.length) {
        const startTime = segmentStart / sampleRate;
        const endTime = duration;

        if (endTime - startTime >= minSegmentDuration) {
            segments.push({
                start: startTime,
                end: endTime,
                duration: endTime - startTime
            });
        }
    }

    // 如果没有检测到分句，将整个音频作为一个片段
    if (segments.length === 0) {
        segments.push({
            start: 0,
            end: duration,
            duration: duration
        });
    }

    console.log(`检测到 ${segments.length} 个句子`);
}

// 播放当前片段
function playCurrentSegment() {
    if (!audioBuffer || segments.length === 0) return;

    stopAudio();

    const segment = segments[currentSegmentIndex];
    currentSource = audioContext.createBufferSource();
    currentSource.buffer = audioBuffer;
    currentSource.playbackRate.value = playbackRate;
    currentSource.connect(audioContext.destination);

    // 播放指定片段
    currentSource.start(0, segment.start, segment.duration);
    isPlaying = true;
    updatePlayButton();
    waveform.classList.remove('paused');

    // 播放结束后自动停止
    currentSource.onended = () => {
        if (isPlaying) {
            isPlaying = false;
            updatePlayButton();
            waveform.classList.add('paused');
        }
    };
}

// 停止播放
function stopAudio() {
    if (currentSource) {
        try {
            currentSource.stop();
        } catch (e) {
            // 忽略已停止的错误
        }
        currentSource = null;
    }
    isPlaying = false;
    updatePlayButton();
    waveform.classList.add('paused');
}

// 更新播放按钮状态
function updatePlayButton() {
    const playIcon = playBtn.querySelector('.play-icon');
    const pauseIcon = playBtn.querySelector('.pause-icon');

    if (isPlaying) {
        playIcon.style.display = 'none';
        pauseIcon.style.display = 'block';
    } else {
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
    }
}

// 更新进度显示
function updateProgress() {
    const progress = ((currentSegmentIndex + 1) / segments.length) * 100;
    progressFill.style.width = `${progress}%`;
    progressText.textContent = `${currentSegmentIndex + 1} / ${segments.length}`;

    // 更新按钮状态
    prevBtn.disabled = currentSegmentIndex === 0;
    nextBtn.disabled = currentSegmentIndex === segments.length - 1;
}

// 加载当前片段数据
function loadSegmentData() {
    // 隐藏答案
    answerPlaceholder.style.display = 'flex';
    answerContent.style.display = 'none';

    // 加载对应的文本数据
    if (textData.length > currentSegmentIndex) {
        const data = textData[currentSegmentIndex];
        answerEnglish.textContent = data.english || '暂无英文文本';
        answerChinese.textContent = data.chinese || '暂无中文翻译';
    } else {
        answerEnglish.textContent = `句子 ${currentSegmentIndex + 1}`;
        answerChinese.textContent = '点击"查看答案"识别当前句子';
    }
}

// 播放/暂停按钮
playBtn.addEventListener('click', () => {
    if (isPlaying) {
        stopAudio();
    } else {
        playCurrentSegment();
    }
});

// 上一句
prevBtn.addEventListener('click', () => {
    if (currentSegmentIndex > 0) {
        stopAudio();
        currentSegmentIndex--;
        updateProgress();
        loadSegmentData();
    }
});

// 下一句
nextBtn.addEventListener('click', () => {
    if (currentSegmentIndex < segments.length - 1) {
        stopAudio();
        currentSegmentIndex++;
        updateProgress();
        loadSegmentData();
    }
});

// 点击显示答案
answerSection.addEventListener('click', async () => {
    if (answerPlaceholder.style.display !== 'none') {
        answerPlaceholder.style.display = 'none';
        answerContent.style.display = 'block';

        // 如果当前句子还没有英文文本，先识别
        if (textData.length <= currentSegmentIndex || !textData[currentSegmentIndex].english) {
            // 显示识别中
            answerEnglish.textContent = '正在识别...';
            answerEnglish.style.opacity = '0.5';
            answerChinese.textContent = '';

            try {
                // 使用浏览器语音识别
                const text = await recognizeSingleSegment(currentSegmentIndex);

                // 确保 textData 数组足够长
                while (textData.length <= currentSegmentIndex) {
                    textData.push({ english: '', chinese: '' });
                }

                textData[currentSegmentIndex].english = text;
                answerEnglish.textContent = text || '识别失败';
                answerEnglish.style.opacity = '1';

                // 保存到 localStorage
                localStorage.setItem('textData', JSON.stringify(textData));

            } catch (err) {
                answerEnglish.textContent = '识别失败';
                answerEnglish.style.opacity = '1';
                answerChinese.textContent = err.message;
                console.error(err);
                return;
            }
        }

        // 如果有英文但没有中文翻译，实时翻译
        if (textData.length > currentSegmentIndex) {
            const data = textData[currentSegmentIndex];
            if (data.english && !data.chinese) {
                // 显示翻译中提示
                answerChinese.textContent = '翻译中...';
                answerChinese.style.opacity = '0.5';

                // 调用翻译 API
                const translation = await translateSingleText(data.english);
                data.chinese = translation;

                // 更新显示
                answerChinese.textContent = translation || '翻译失败';
                answerChinese.style.opacity = '1';

                // 保存到 localStorage
                localStorage.setItem('textData', JSON.stringify(textData));
            }
        }
    }
});

// 速度控制
speedButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        speedButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        playbackRate = parseFloat(btn.dataset.speed);

        // 如果正在播放，重新播放以应用新速度
        if (isPlaying) {
            playCurrentSegment();
        }
    });
});

// 重新选择文件
resetBtn.addEventListener('click', () => {
    stopAudio();
    segments = [];
    currentSegmentIndex = 0;
    audioBuffer = null;
    textData = [];
    trainingSection.style.display = 'none';
    uploadSection.style.display = 'block';
    audioInput.value = '';
});

// 添加文本按钮
addTextBtn.addEventListener('click', () => {
    segmentCount.textContent = segments.length;

    // 如果已有文本数据，显示在输入框中
    if (textData.length > 0) {
        const lines = textData.map(item => `${item.english}|${item.chinese}`);
        textInput.value = lines.join('\n');
    } else {
        textInput.value = '';
    }

    textModal.style.display = 'flex';
});

// 关闭弹窗
closeModal.addEventListener('click', () => {
    textModal.style.display = 'none';
});

cancelTextBtn.addEventListener('click', () => {
    textModal.style.display = 'none';
});

// 保存文本数据
saveTextBtn.addEventListener('click', () => {
    const lines = textInput.value.trim().split('\n');
    textData = [];

    for (const line of lines) {
        if (line.trim()) {
            const parts = line.split('|');
            textData.push({
                english: parts[0]?.trim() || '',
                chinese: parts[1]?.trim() || ''
            });
        }
    }

    // 保存到 localStorage
    localStorage.setItem('textData', JSON.stringify(textData));

    // 刷新当前显示
    loadSegmentData();

    textModal.style.display = 'none';

    alert(`已保存 ${textData.length} 条文本数据`);
});

// 点击弹窗背景关闭
textModal.addEventListener('click', (e) => {
    if (e.target === textModal) {
        textModal.style.display = 'none';
    }
});

// 自动识别按钮
autoRecognizeBtn.addEventListener('click', async () => {
    // 检查浏览器支持
    if (!BrowserASR.isSupported()) {
        alert('抱歉，您的浏览器不支持语音识别功能。\n\n请使用 Chrome、Edge 或 Safari 浏览器。');
        return;
    }

    // 直接开始批量识别
    recognizeSetup.style.display = 'none';
    recognizeProgress.style.display = 'block';
    recognizeModal.style.display = 'flex';
    startRecognizeBtn.disabled = true;

    try {
        await recognizeWithBrowser();
        recognizeModal.style.display = 'none';
        loadSegmentData();
        alert(`批量识别完成！共识别 ${textData.length} 个句子`);
    } catch (err) {
        alert(`识别失败：${err.message}`);
        console.error(err);
    } finally {
        recognizeSetup.style.display = 'block';
        recognizeProgress.style.display = 'none';
        startRecognizeBtn.disabled = false;
    }
});

closeRecognizeModal.addEventListener('click', () => { recognizeModal.style.display = 'none'; });
cancelRecognizeBtn.addEventListener('click', () => { recognizeModal.style.display = 'none'; });
recognizeModal.addEventListener('click', (e) => { if (e.target === recognizeModal) recognizeModal.style.display = 'none'; });

// 识别单个句子（使用浏览器API）
async function recognizeSingleSegment(segmentIndex) {
    const segmentBlob = await exportSegmentAsBlob(segmentIndex);
    const asr = new BrowserASR('en-US');
    return await asr.recognize(segmentBlob);
}

// 使用浏览器 API 识别所有片段（批量识别）
async function recognizeWithBrowser() {
    const results = [];
    const asr = new BrowserASR('en-US');

    for (let i = 0; i < segments.length; i++) {
        recognizeStatusText.textContent = `正在识别第 ${i + 1} 句...`;
        recognizeProgressBar.style.width = `${((i) / segments.length) * 100}%`;
        recognizeProgressLabel.textContent = `${i} / ${segments.length}`;

        try {
            // 导出当前片段为音频 Blob
            const segmentBlob = await exportSegmentAsBlob(i);

            // 调用浏览器识别
            const text = await asr.recognize(segmentBlob);

            results.push({ english: text, chinese: '' });

            // 短暂延迟，避免处理过快
            await new Promise(r => setTimeout(r, 300));

        } catch (err) {
            console.error(`识别第 ${i + 1} 句失败:`, err);
            results.push({ english: '', chinese: '' });
        }
    }

    recognizeProgressBar.style.width = '100%';
    recognizeProgressLabel.textContent = `${segments.length} / ${segments.length}`;
    recognizeStatusText.textContent = '识别完成！';

    textData = results;
    localStorage.setItem('textData', JSON.stringify(textData));
}

// 导出音频片段为 Blob
async function exportSegmentAsBlob(segmentIndex) {
    const segment = segments[segmentIndex];
    const sampleRate = audioBuffer.sampleRate;
    const startSample = Math.floor(segment.start * sampleRate);
    const numSamples = Math.floor(segment.duration * sampleRate);
    const numChannels = audioBuffer.numberOfChannels;

    // 创建新的 AudioBuffer
    const offlineContext = new OfflineAudioContext(numChannels, numSamples, sampleRate);
    const source = offlineContext.createBufferSource();

    // 复制片段数据
    const segmentBuffer = offlineContext.createBuffer(numChannels, numSamples, sampleRate);
    for (let ch = 0; ch < numChannels; ch++) {
        const channelData = audioBuffer.getChannelData(ch);
        const segmentData = segmentBuffer.getChannelData(ch);
        for (let i = 0; i < numSamples; i++) {
            segmentData[i] = channelData[startSample + i] || 0;
        }
    }

    source.buffer = segmentBuffer;
    source.connect(offlineContext.destination);
    source.start();

    const renderedBuffer = await offlineContext.startRendering();

    // 转换为 WAV Blob
    return audioBufferToWavBlob(renderedBuffer);
}

// AudioBuffer 转 WAV Blob
function audioBufferToWavBlob(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const numSamples = buffer.length;

    const wavBuffer = new ArrayBuffer(44 + numSamples * numChannels * 2);
    const view = new DataView(wavBuffer);

    const writeString = (offset, str) => {
        for (let i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i));
        }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * numChannels * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, numSamples * numChannels * 2, true);

    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
        for (let ch = 0; ch < numChannels; ch++) {
            const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
            offset += 2;
        }
    }

    return new Blob([wavBuffer], { type: 'audio/wav' });
}

// MyMemory 免费翻译 API，单条翻译
async function translateSingleText(text) {
    if (!text.trim()) return '';
    try {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|zh`;
        const res = await fetch(url);
        const data = await res.json();
        return data.responseStatus === 200 ? data.responseData.translatedText : '';
    } catch (e) {
        return '';
    }
}

// 重新选择文件
resetBtn.addEventListener('click', () => {
    stopAudio();
    segments = [];
    currentSegmentIndex = 0;
    audioBuffer = null;
    textData = [];
    trainingSection.style.display = 'none';
    uploadSection.style.display = 'block';
    audioInput.value = '';
});

// 显示/隐藏加载提示
function showLoading(show) {
    loadingOverlay.style.display = show ? 'flex' : 'none';
}

// 初始化波形为暂停状态
waveform.classList.add('paused');

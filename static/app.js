// Max Frontend Application Logic

// Configuration & State Variables
let geminiKey = localStorage.getItem("gemini_key") || "";
let history = [];
let interactionMode = "voice"; // Default voice mode
let forceMode = "auto";       // auto, online, offline
let forceLang = "auto";       // auto, en, ta
let isListening = false;      // Mic listening status
let isSpeakingTTS = false;    // TTS speaking status
let isWaitingForResponse = false; // LLM processing status
let connectionState = "online";  // online, offline, slow
let currentLatency = 0;
let synthesisVoices = [];
let selectedLang = localStorage.getItem("voice_lang") || "en-US";

// Voice Session variables
let voiceSessionActive = false;
let accumulatedTranscript = "";
let lastInterimText = "";
let silenceTimeout = null;
let secondsLeft = 10;
let sessionCountdownInterval = null;
let activeUtterance = null; // Stores current audio / speech synthesis utterance

// Web Audio API context for lip-sync & visualizer
let audioCtx = null;
let audioAnalyser = null;
let audioSourceNode = null;
let visualizerCanvasAnimId = null;

// Offline WebSocket STT variables
let offlineMicStream = null;
let offlineAudioProcessor = null;
let offlineSocket = null;
let offlineSTTActive = false;

// DOM Elements
const connBadge = document.getElementById("conn-badge");
const connText = document.getElementById("conn-text");
const latencyBadge = document.getElementById("latency-badge");
const latencyText = document.getElementById("latency-text");
const settingsBtn = document.getElementById("settings-btn");
const closeSettingsBtn = document.getElementById("close-settings-btn");
const settingsDrawer = document.getElementById("settings-drawer");
const geminiKeyInput = document.getElementById("gemini-key-input");
const toggleKeyVisibility = document.getElementById("toggle-key-visibility");

const chatHistory = document.getElementById("chat-history");
const textPrompt = document.getElementById("text-prompt");
const sendBtn = document.getElementById("send-btn");
const textInputWrapper = document.getElementById("text-input-wrapper");
const voiceRecordBtn = document.getElementById("voice-record-btn");
const voiceVisualizerContainer = document.getElementById("voice-visualizer-container");
const voiceStatusLabel = document.getElementById("voice-status-label");
const visualizerCanvas = document.getElementById("visualizer-canvas");

const interactionModeIndicator = document.getElementById("interaction-mode-indicator");
const modelSourceIndicator = document.getElementById("model-source-indicator");

const statusBin = document.getElementById("status-bin");
const statusModel = document.getElementById("status-model");
const statusProcess = document.getElementById("status-process");
const downloadPrompt = document.getElementById("download-prompt");
const retryStatusBtn = document.getElementById("retry-status-btn");

const voicePitch = document.getElementById("voice-pitch");
const voiceRate = document.getElementById("voice-rate");
const voiceGenderSelect = document.getElementById("voice-gender");
const voiceLanguageSelect = document.getElementById("voice-language");

const smileyOverlay = document.getElementById("smiley-overlay");
const smileyFace = document.getElementById("smiley-face");
const smileyMouth = document.getElementById("smiley-mouth");
const smileyStatusLabel = document.getElementById("smiley-status-label");
const toggleDashboardBtn = document.getElementById("toggle-dashboard-btn");
const showSmileyBtn = document.getElementById("show-smiley-btn");

// --- Speech Recognition Setup (Online Web Speech API) ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = selectedLang;

    recognition.onstart = () => {
        isListening = true;
        voiceRecordBtn.classList.add("recording");
        voiceRecordBtn.innerHTML = '<i class="fa-solid fa-square"></i>';
        
        if (voiceSessionActive) {
            voiceStatusLabel.textContent = `Listening... ${secondsLeft}s`;
            setSmileyExpression("listening", `Listening... (${secondsLeft}s)`);
        } else {
            voiceStatusLabel.textContent = "Say 'Start' or 'Max' to begin";
            setSmileyExpression("idle", "Say 'Start' or 'Max' to begin");
        }
        startCanvasAnimation();
    };

    recognition.onresult = (event) => {
        // Prevent speech feedback triggers if assistant is busy
        if (isSpeakingTTS || isWaitingForResponse || window.speechSynthesis.speaking) {
            if (silenceTimeout) clearTimeout(silenceTimeout);
            return;
        }

        let interimTranscript = "";
        let finalTranscript = "";

        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
            } else {
                interimTranscript += event.results[i][0].transcript;
            }
        }

        lastInterimText = interimTranscript;
        const currentText = (finalTranscript || interimTranscript).toLowerCase().trim();
        if (!currentText) return;

        console.log("Speech recognition text:", currentText);

        if (!voiceSessionActive) {
            // Wake Word Detection
            const wakeWords = ["start", "max", "ஸ்டார்ட்", "மேக்ஸ்", "தொடங்கு"];
            const isWake = wakeWords.some(w => currentText.includes(w));
            if (isWake) {
                triggerWakeWord();
            }
        } else {
            // Active Session Controls
            const stopWords = ["stop", "exit", "quit", "நிறுத்து", "வெளியேறு", "முடி"];
            const isStop = stopWords.some(s => currentText.includes(s));
            if (isStop) {
                triggerStopSession();
                return;
            }

            // Language Switch Commands
            if (currentText.includes("speak tamil") || currentText.includes("தமிழ் பேசு")) {
                switchLanguage("ta-IN");
                return;
            }
            if (currentText.includes("speak english") || currentText.includes("ஆங்கிலம் பேசு")) {
                switchLanguage("en-US");
                return;
            }

            if (finalTranscript) {
                accumulatedTranscript += " " + finalTranscript;
            }

            // Reset silence timeout
            if (silenceTimeout) clearTimeout(silenceTimeout);
            silenceTimeout = setTimeout(() => {
                console.log("Silence detected. Submitting query...");
                submitVoiceQuery();
            }, 1800);
        }
    };

    recognition.onerror = (e) => {
        console.error("Speech Recognition Error:", e.error);
        if (e.error !== "no-speech") {
            voiceStatusLabel.textContent = `Recognition Error: ${e.error}`;
        }
    };

    recognition.onend = () => {
        isListening = false;
        voiceRecordBtn.classList.remove("recording");
        voiceRecordBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
        stopCanvasAnimation();

        // Auto restart microphone loop unless speaking or waiting
        setTimeout(() => {
            if (!isSpeakingTTS && !isWaitingForResponse && !offlineSTTActive) {
                startSpeechEngine();
            }
        }, 400);
    };
} else {
    console.warn("Web Speech API not supported in this browser. Will fall back to offline WebSocket STT.");
}

// --- Offline STT (WebSocket Streaming to Vosk Backend) ---
function startOfflineSTT() {
    if (offlineSTTActive) return;
    console.log("Initializing local offline Speech Recognition (Vosk)...");

    // Close any online recognition
    if (recognition) {
        try { recognition.stop(); } catch(e){}
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/ws/offline-stt?lang=${selectedLang}`;
    
    try {
        offlineSocket = new WebSocket(wsUrl);
    } catch (e) {
        console.error("Failed to connect to offline STT WebSocket:", e);
        return;
    }

    offlineSocket.onopen = () => {
        console.log("Offline STT WebSocket channel opened.");
        offlineSTTActive = true;
        isListening = true;
        voiceRecordBtn.classList.add("recording");
        voiceRecordBtn.innerHTML = '<i class="fa-solid fa-square"></i>';
        
        if (voiceSessionActive) {
            voiceStatusLabel.textContent = `Listening Offline... ${secondsLeft}s`;
            setSmileyExpression("listening", `Listening Offline... (${secondsLeft}s)`);
        } else {
            voiceStatusLabel.textContent = "Say 'Start' or 'Max' to begin (Offline)";
            setSmileyExpression("idle", "Say 'Start' or 'Max' to begin (Offline)");
        }
        startCanvasAnimation();
        startMicAudioCapture();
    };

    offlineSocket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (isSpeakingTTS || isWaitingForResponse) return;

        let transcript = "";
        let isFinal = false;

        if (data.partial) {
            transcript = data.partial;
        } else if (data.text) {
            transcript = data.text;
            isFinal = true;
        }

        const currentText = transcript.toLowerCase().trim();
        if (!currentText) return;

        console.log("Offline STT transcript:", currentText, "Final:", isFinal);

        if (!voiceSessionActive) {
            // Wake Word Detection
            const wakeWords = ["start", "max", "ஸ்டார்ட்", "மேக்ஸ்", "தொடங்கு"];
            const isWake = wakeWords.some(w => currentText.includes(w));
            if (isWake) {
                triggerWakeWord();
            }
        } else {
            // Stop commands
            const stopWords = ["stop", "exit", "quit", "நிறுத்து", "வெளியேறு", "முடி"];
            const isStop = stopWords.some(s => currentText.includes(s));
            if (isStop) {
                triggerStopSession();
                return;
            }

            // Language switcher
            if (currentText.includes("speak tamil") || currentText.includes("தமிழ் பேசு")) {
                switchLanguage("ta-IN");
                return;
            }
            if (currentText.includes("speak english") || currentText.includes("ஆங்கிலம் பேசு")) {
                switchLanguage("en-US");
                return;
            }

            if (isFinal) {
                accumulatedTranscript += " " + transcript;
                submitVoiceQuery();
            } else {
                lastInterimText = transcript;
                // Reset silence timer on interim speech
                if (silenceTimeout) clearTimeout(silenceTimeout);
                silenceTimeout = setTimeout(() => {
                    if (lastInterimText.trim()) {
                        accumulatedTranscript += " " + lastInterimText;
                        submitVoiceQuery();
                    }
                }, 2000);
            }
        }
    };

    offlineSocket.onerror = (e) => {
        console.error("Offline WebSocket STT error:", e);
    };

    offlineSocket.onclose = () => {
        console.log("Offline STT WebSocket closed.");
        stopOfflineSTT();
    };
}

function stopOfflineSTT() {
    if (!offlineSTTActive) return;
    offlineSTTActive = false;
    isListening = false;
    voiceRecordBtn.classList.remove("recording");
    voiceRecordBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
    stopCanvasAnimation();
    
    stopMicAudioCapture();

    if (offlineSocket) {
        try { offlineSocket.close(); } catch(e){}
        offlineSocket = null;
    }

    setTimeout(() => {
        if (!isSpeakingTTS && !isWaitingForResponse && isOfflineModeActive()) {
            startOfflineSTT();
        }
    }, 500);
}

function startMicAudioCapture() {
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
        .then(stream => {
            offlineMicStream = stream;
            
            // Setup downsampling script processor
            const context = new (window.AudioContext || window.webkitAudioContext)();
            const source = context.createMediaStreamSource(stream);
            
            // ScriptProcessorNode with bufferSize 4096 and 1 channel input/output
            const processor = context.createScriptProcessor(4096, 1, 1);
            
            processor.onaudioprocess = (e) => {
                if (!offlineSTTActive || !offlineSocket || offlineSocket.readyState !== WebSocket.OPEN) return;
                
                const inputData = e.inputBuffer.getChannelData(0);
                // Downsample from browser sample rate (typically 44100/48000) to 16000Hz for Vosk
                const downsampled = downsampleBuffer(inputData, context.sampleRate, 16000);
                const pcm16 = floatTo16BitPCM(downsampled);
                
                // Send raw binary PCM data to socket
                offlineSocket.send(pcm16.buffer);
            };
            
            source.connect(processor);
            processor.connect(context.destination);
            
            offlineAudioProcessor = {
                context: context,
                source: source,
                processor: processor
            };
        })
        .catch(err => {
            console.error("Microphone access failed for offline STT:", err);
            voiceStatusLabel.textContent = "Mic access blocked.";
        });
}

function stopMicAudioCapture() {
    if (offlineMicStream) {
        offlineMicStream.getTracks().forEach(track => track.stop());
        offlineMicStream = null;
    }
    if (offlineAudioProcessor) {
        try {
            offlineAudioProcessor.source.disconnect();
            offlineAudioProcessor.processor.disconnect();
            offlineAudioProcessor.context.close();
        } catch(e){}
        offlineAudioProcessor = null;
    }
}

// Linear interpolation downsampling helper
function downsampleBuffer(buffer, inputSampleRate, outputSampleRate) {
    if (inputSampleRate === outputSampleRate) return buffer;
    const sampleRateRatio = inputSampleRate / outputSampleRate;
    const newLength = Math.round(buffer.length / sampleRateRatio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
        const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio);
        let accum = 0, count = 0;
        for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
            accum += buffer[i];
            count++;
        }
        result[offsetResult] = count > 0 ? accum / count : 0;
        offsetResult++;
        offsetBuffer = nextOffsetBuffer;
    }
    return result;
}

// Convert Float32 data to Int16 PCM array buffer
function floatTo16BitPCM(floatArray) {
    const buffer = new ArrayBuffer(floatArray.length * 2);
    const view = new DataView(buffer);
    let offset = 0;
    for (let i = 0; i < floatArray.length; i++, offset += 2) {
        let s = Math.max(-1, Math.min(1, floatArray[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return new Int16Array(buffer);
}

// --- Speech Synthesis Setup (Speech Replay) ---
function loadVoices() {
    if (!('speechSynthesis' in window)) return;
    const rawVoices = window.speechSynthesis.getVoices();
    
    // Filter to English and Tamil
    synthesisVoices = rawVoices.filter(v => {
        const lang = v.lang.toLowerCase();
        return lang.startsWith("en") || lang.startsWith("ta");
    });

    voiceGenderSelect.innerHTML = "";
    synthesisVoices.forEach((voice, index) => {
        const option = document.createElement("option");
        option.value = index;
        option.textContent = `${voice.name} (${voice.lang})`;
        
        // Auto selection
        const isTamil = selectedLang.startsWith("ta");
        if (isTamil && voice.lang.toLowerCase().startsWith("ta")) {
            option.selected = true;
        } else if (!isTamil && voice.lang.toLowerCase().startsWith("en") && 
                  (voice.name.includes("Natural") || voice.name.includes("Google") || voice.name.includes("Microsoft"))) {
            option.selected = true;
        }
        
        voiceGenderSelect.appendChild(option);
    });
}

if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = loadVoices;
    loadVoices();
}

// Unlock audio context inside user gestures
function unlockAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        audioAnalyser = audioCtx.createAnalyser();
        audioAnalyser.fftSize = 64;
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    
    // Speech synthesis unlock
    if ('speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        window.speechSynthesis.speak(u);
    }
}

// Play custom audio URLs (Google TTS / Offline Backend wav) and run real-time lip-sync
function playAudioWithLipSync(url, fallbackSynthesisCallback = null) {
    // Pause microhpone listeners
    pauseSpeechEngine();
    
    isSpeakingTTS = true;
    setSmileyExpression("speaking", "Speaking...");

    const audio = new Audio(url);
    audio.crossOrigin = "anonymous";
    activeUtterance = audio;

    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            audioAnalyser = audioCtx.createAnalyser();
            audioAnalyser.fftSize = 64;
        }
        
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        // Reconnect audio node
        if (audioSourceNode) {
            try { audioSourceNode.disconnect(); } catch(e){}
        }
        
        audioSourceNode = audioCtx.createMediaElementSource(audio);
        audioSourceNode.connect(audioAnalyser);
        audioAnalyser.connect(audioCtx.destination);
    } catch (e) {
        console.warn("Could not bind AudioContext analysis (CORS or browser block). Falling back to direct audio play.", e);
    }

    const endSpeaking = () => {
        if (activeUtterance !== audio) return;
        activeUtterance = null;
        isSpeakingTTS = false;
        
        document.documentElement.style.setProperty('--mouth-scale-y', 1.0);

        setTimeout(() => {
            resumeSpeechEngine();
            if (voiceSessionActive) {
                startSessionCountdown();
            }
        }, 1500);
    };

    audio.onended = endSpeaking;
    audio.onerror = (e) => {
        console.error("Audio playback error:", e);
        if (fallbackSynthesisCallback) {
            fallbackSynthesisCallback();
        } else {
            endSpeaking();
        }
    };

    // Analyze frequencies and animate mouth
    const dataArray = new Uint8Array(audioAnalyser ? audioAnalyser.frequencyBinCount : 0);
    function updateMouthAnimation() {
        if (!isSpeakingTTS || activeUtterance !== audio || !audioAnalyser) {
            document.documentElement.style.setProperty('--mouth-scale-y', 1.0);
            return;
        }
        
        audioAnalyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        
        // Map average volume (0-255) to mouth vertical scale (1.0 - 4.5)
        const scaleY = 1.0 + (average / 35);
        document.documentElement.style.setProperty('--mouth-scale-y', scaleY);
        
        requestAnimationFrame(updateMouthAnimation);
    }

    audio.play()
        .then(() => {
            if (audioAnalyser) {
                updateMouthAnimation();
            }
        })
        .catch(err => {
            console.error("Audio play failed:", err);
            if (fallbackSynthesisCallback) {
                fallbackSynthesisCallback();
            } else {
                endSpeaking();
            }
        });
}

// Fallback SpeechSynthesis engine with simulated mouth movements
function speakWithBrowserSynthesis(text, langCode) {
    pauseSpeechEngine();
    isSpeakingTTS = true;
    setSmileyExpression("speaking", "Speaking...");

    window.speechSynthesis.cancel(); // kill existing speech
    
    const utterance = new SpeechSynthesisUtterance(text);
    activeUtterance = utterance;

    // Pick correct voice character
    let selectedVoice = null;
    const voiceIdx = voiceGenderSelect.value;
    if (voiceIdx !== "" && synthesisVoices[voiceIdx]) {
        selectedVoice = synthesisVoices[voiceIdx];
    } else {
        selectedVoice = synthesisVoices.find(v => v.lang.toLowerCase().startsWith(langCode.substring(0, 2)));
    }

    if (selectedVoice) {
        utterance.voice = selectedVoice;
        utterance.lang = selectedVoice.lang;
    } else {
        utterance.lang = langCode;
    }

    utterance.pitch = parseFloat(voicePitch.value);
    utterance.rate = parseFloat(voiceRate.value);

    // Mouth animation loop simulator using sine-wave rhythm
    let simFrameId = null;
    function simulateMouthAnimation(timestamp) {
        if (!isSpeakingTTS || activeUtterance !== utterance) {
            document.documentElement.style.setProperty('--mouth-scale-y', 1.0);
            return;
        }
        
        // Generate dynamic organic bouncing value representing syllables
        const val = Math.abs(Math.sin(timestamp * 0.015)) * 2.5 + Math.sin(timestamp * 0.04) * 0.6;
        const scaleY = 1.0 + Math.max(0, val);
        document.documentElement.style.setProperty('--mouth-scale-y', scaleY);
        
        simFrameId = requestAnimationFrame(simulateMouthAnimation);
    }

    utterance.onstart = (e) => {
        requestAnimationFrame(simulateMouthAnimation);
    };

    const endSpeaking = () => {
        if (activeUtterance !== utterance) return;
        activeUtterance = null;
        isSpeakingTTS = false;
        
        if (simFrameId) cancelAnimationFrame(simFrameId);
        document.documentElement.style.setProperty('--mouth-scale-y', 1.0);

        setTimeout(() => {
            resumeSpeechEngine();
            if (voiceSessionActive) {
                startSessionCountdown();
            }
        }, 1500);
    };

    utterance.onend = endSpeaking;
    utterance.onerror = endSpeaking;

    window.speechSynthesis.speak(utterance);
}

// Main Text-to-Speech Router
function speakText(text) {
    if (!text) return;
    
    // Clean markdown
    const cleanText = text.replace(/[*#_`~]/g, "").trim();
    if (!cleanText) return;

    const isTamil = /[\u0B80-\u0BFF]/.test(cleanText);
    const lang = isTamil ? "ta-IN" : "en-US";
    
    console.log(`TTS Request -> Online: ${isOnlineModeActive()} | Language: ${lang} | Text: ${cleanText}`);

    // Route 1: Online Mode (High quality Google Translate proxy)
    if (isOnlineModeActive()) {
        const proxyUrl = `/api/online-tts?text=${encodeURIComponent(cleanText)}&lang=${isTamil ? 'ta' : 'en'}`;
        playAudioWithLipSync(proxyUrl, () => {
            console.log("Online TTS failed. Falling back to browser synthesis...");
            speakWithBrowserSynthesis(cleanText, lang);
        });
        return;
    }

    // Route 2: Offline Mode with local browser synthesis (if Tamil voice is available locally)
    if (!isOnlineModeActive() && isTamil) {
        const hasLocalTamil = synthesisVoices.some(v => v.lang.toLowerCase().startsWith("ta"));
        if (hasLocalTamil) {
            speakWithBrowserSynthesis(cleanText, "ta-IN");
            return;
        } else {
            // Route 3: Offline Tamil audio generated by server (eSpeak proxy)
            console.log("Local browser does not support Tamil voices. Fetching eSpeak stream from backend...");
            const offlineTtsUrl = `/api/offline-tts?text=${encodeURIComponent(cleanText)}&lang=ta`;
            playAudioWithLipSync(offlineTtsUrl, () => {
                speakWithBrowserSynthesis(cleanText, "ta-IN");
            });
            return;
        }
    }

    // Default Fallback
    speakWithBrowserSynthesis(cleanText, lang);
}

// --- Active Session Management ---
function triggerWakeWord() {
    unlockAudioContext();
    console.log("WAKE WORD DETECTED or Woke manually!");
    voiceSessionActive = true;
    accumulatedTranscript = "";
    
    // Play chime feedback
    playNotificationChime();

    // Show Visor overlay
    smileyOverlay.classList.remove("hidden-dashboard");
    requestFullscreenOverlay();
    
    // Start countdown timer
    secondsLeft = 12;
    startSessionCountdown();
}

function triggerStopSession() {
    console.log("STOP WORD DETECTED!");
    voiceSessionActive = false;
    
    if (sessionCountdownInterval) clearInterval(sessionCountdownInterval);
    if (silenceTimeout) clearTimeout(silenceTimeout);

    setSmileyExpression("idle", "Say 'Start' or 'Max' to begin");
    playNotificationChime(false);

    // Hide fullscreen overlay and exit fullscreen
    smileyOverlay.classList.add("hidden-dashboard");
    exitFullscreenOverlay();
}

function startSessionCountdown() {
    if (sessionCountdownInterval) clearInterval(sessionCountdownInterval);
    
    secondsLeft = 12;
    setSmileyExpression("listening", `Listening... (${secondsLeft}s)`);

    sessionCountdownInterval = setInterval(() => {
        if (isSpeakingTTS || isWaitingForResponse) return; // Freeze timer while speaking/processing
        
        secondsLeft--;
        if (secondsLeft <= 0) {
            console.log("Voice session timed out due to inactivity.");
            triggerStopSession();
        } else {
            const labelText = `Listening... (${secondsLeft}s)`;
            if (offlineSTTActive) {
                setSmileyExpression("listening", `Listening Offline... (${secondsLeft}s)`);
            } else {
                setSmileyExpression("listening", labelText);
            }
        }
    }, 1000);
}

function pauseSessionCountdown() {
    if (sessionCountdownInterval) {
        clearInterval(sessionCountdownInterval);
        sessionCountdownInterval = null;
    }
}

// --- Speech Engine Control loop ---
function startSpeechEngine() {
    if (isOnlineModeActive()) {
        if (recognition) {
            try { recognition.start(); } catch(e){}
        }
    } else {
        startOfflineSTT();
    }
}

function pauseSpeechEngine() {
    if (recognition) {
        try { recognition.stop(); } catch(e){}
    }
    if (offlineSTTActive) {
        stopOfflineSTT();
    }
}

function resumeSpeechEngine() {
    if (isOnlineModeActive()) {
        if (recognition) {
            try { recognition.start(); } catch(e){}
        }
    } else {
        startOfflineSTT();
    }
}

function switchLanguage(langCode) {
    console.log("Switching transcription language to:", langCode);
    selectedLang = langCode;
    localStorage.setItem("voice_lang", langCode);
    voiceLanguageSelect.value = langCode;

    if (recognition) {
        recognition.lang = langCode;
    }

    playNotificationChime();
    
    // Restart engine to apply changes
    pauseSpeechEngine();
    setTimeout(() => {
        resumeSpeechEngine();
        if (voiceSessionActive) {
            startSessionCountdown();
        }
    }, 600);
}

// --- API Submissions (Query processing) ---
function submitVoiceQuery() {
    if (silenceTimeout) clearTimeout(silenceTimeout);
    
    const query = accumulatedTranscript.trim();
    accumulatedTranscript = ""; // flush buffer

    if (!query) {
        if (voiceSessionActive) {
            secondsLeft = 10; // reset window
        }
        return;
    }

    appendChatMessage("user", query);
    processQuery(query);
}

function submitTextQuery() {
    const query = textPrompt.value.trim();
    if (!query) return;

    textPrompt.value = "";
    appendChatMessage("user", query);
    
    // Auto show visor screen
    setSmileyExpression("thinking", "Thinking...");
    processQuery(query);
}

function processQuery(queryText) {
    isWaitingForResponse = true;
    pauseSessionCountdown();
    pauseSpeechEngine();

    setSmileyExpression("thinking", "Thinking...");
    appendChatMessage("assistant", `<i class="fa-solid fa-spinner fa-spin"></i> Processing...`, true);

    const payload = {
        prompt: queryText,
        force_mode: forceMode,
        force_lang: forceLang,
        history: history
    };

    const headers = { "Content-Type": "application/json" };
    if (geminiKey) {
        headers["Authorization"] = `Bearer ${geminiKey}`;
    }

    const startTime = performance.now();

    fetch("/api/query", {
        method: "POST",
        headers: headers,
        body: JSON.stringify(payload)
    })
    .then(res => {
        if (!res.ok) throw new Error(`HTTP Error status: ${res.status}`);
        return res.json();
    })
    .then(data => {
        isWaitingForResponse = false;
        
        // Remove typing indicator loader
        removeLoadingMessage();
        
        const responseText = data.response;
        appendChatMessage("assistant", responseText);

        // Save conversation history (limit to last 10 exchanges)
        history.push({ role: "user", content: queryText });
        history.push({ role: "assistant", content: responseText });
        if (history.length > 20) history = history.slice(-20);

        // Update latency stats from API response
        if (data.latency_ms) {
            currentLatency = data.latency_ms;
            updateLatencyBadge(currentLatency);
        }

        // Voice reply
        speakText(responseText);
    })
    .catch(err => {
        isWaitingForResponse = false;
        removeLoadingMessage();
        console.error("API Query failed:", err);
        
        const errText = "Error: Could not connect to API or local LLM server.";
        appendChatMessage("assistant", errText);
        speakText("I am having trouble connecting right now.");
    });
}

// --- UI Helpers ---
function appendChatMessage(role, content, isLoading = false) {
    const msgDiv = document.createElement("div");
    msgDiv.classList.add("message", role === "user" ? "user-msg" : "assistant-msg");
    if (isLoading) msgDiv.id = "loading-message-container";

    const avatar = document.createElement("div");
    avatar.classList.add("msg-avatar");
    avatar.innerHTML = role === "user" ? '<i class="fa-solid fa-user"></i>' : '<i class="fa-solid fa-robot"></i>';

    const textBubble = document.createElement("div");
    textBubble.classList.add("msg-content");
    textBubble.innerHTML = content;

    msgDiv.appendChild(avatar);
    msgDiv.appendChild(textBubble);
    chatHistory.appendChild(msgDiv);
    
    // Auto-scroll chat history
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

function removeLoadingMessage() {
    const loader = document.getElementById("loading-message-container");
    if (loader) loader.remove();
}

function setSmileyExpression(expr, labelText) {
    if (!smileyFace) return;
    smileyFace.className = `robot-head expr-${expr}`;
    if (smileyStatusLabel) smileyStatusLabel.textContent = labelText;
}

// Periodic connection status check
function checkSystemStatus() {
    const forceModeChecked = document.querySelector('input[name="force_mode"]:checked').value;
    forceMode = forceModeChecked;

    const startTime = performance.now();
    
    fetch("/api/ping")
        .then(res => res.json())
        .then(data => {
            const duration = Math.round(performance.now() - startTime);
            currentLatency = duration;
            updateLatencyBadge(currentLatency);

            // Update local server asset labels
            localAssetsPresent = data.local_assets;
            updateStatusLabel(statusBin, data.bin_exists);
            updateStatusLabel(statusModel, data.model_exists);
            updateStatusLabel(statusProcess, data.local_server_active);

            if (data.local_assets) {
                downloadPrompt.classList.add("hidden");
            } else {
                downloadPrompt.classList.remove("hidden");
            }

            modelSourceIndicator.innerHTML = data.local_server_active 
                ? '<i class="fa-solid fa-server"></i> Local Server Active (Qwen 1.5B)' 
                : '<i class="fa-solid fa-file-code"></i> Local engine offline (Fast Intent Rule Fallback)';

            // Connection state transitions
            if (forceMode === "online") {
                connectionState = "online";
            } else if (forceMode === "offline") {
                connectionState = "offline";
            } else {
                // Auto mode logic
                if (duration > 1200) {
                    connectionState = "slow";
                } else {
                    connectionState = "online";
                }
            }

            updateConnectionBadge();
        })
        .catch(err => {
            console.warn("Ping request failed:", err);
            connectionState = "offline";
            updateConnectionBadge();
            updateLatencyBadge(0);
            
            statusBin.className = "status-label inactive";
            statusBin.innerHTML = '<i class="fa-solid fa-xmark"></i> Missing';
            statusModel.className = "status-label inactive";
            statusModel.innerHTML = '<i class="fa-solid fa-xmark"></i> Missing';
            statusProcess.className = "status-label inactive";
            statusProcess.innerHTML = '<i class="fa-solid fa-xmark"></i> Stopped';
        });
}

function updateStatusLabel(element, isActive) {
    if (isActive) {
        element.className = "status-label active";
        element.innerHTML = '<i class="fa-solid fa-check"></i> Found';
    } else {
        element.className = "status-label inactive";
        element.innerHTML = '<i class="fa-solid fa-xmark"></i> Missing';
    }
}

function updateLatencyBadge(ms) {
    latencyText.textContent = ms > 0 ? `${ms} ms` : "-- ms";
}

function updateConnectionBadge() {
    connBadge.className = "badge " + (connectionState === "online" ? "online" : "offline");
    
    if (connectionState === "online") {
        connText.textContent = "Online Mode";
        interactionModeIndicator.innerHTML = '<i class="fa-solid fa-cloud"></i> Online (Gemini API)';
        
        // Restart speech engine to use online Speech API if it fell back previously
        if (offlineSTTActive) {
            stopOfflineSTT();
        }
    } else if (connectionState === "slow") {
        connText.textContent = "Connection Slow (Local Fallback)";
        interactionModeIndicator.innerHTML = '<i class="fa-solid fa-wifi-slash"></i> Slow Connection (Local)';
        
        if (!offlineSTTActive && isListening) {
            startSpeechEngine();
        }
    } else {
        connText.textContent = "Offline Mode";
        interactionModeIndicator.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> Offline (Local)';
        
        if (!offlineSTTActive && isListening) {
            startSpeechEngine();
        }
    }
}

function isOnlineModeActive() {
    if (forceMode === "online") return true;
    if (forceMode === "offline") return false;
    return connectionState === "online";
}

function isOfflineModeActive() {
    return !isOnlineModeActive();
}

// Fullscreen Browser overlays
function requestFullscreenOverlay() {
    const docEl = document.documentElement;
    if (docEl.requestFullscreen) {
        docEl.requestFullscreen().catch(err => console.log("Request fullscreen failed:", err));
    }
}

function exitFullscreenOverlay() {
    if (document.fullscreenElement) {
        if (document.exitFullscreen) {
            document.exitFullscreen().catch(err => console.log("Exit fullscreen failed:", err));
        }
    }
}

// Notification chime via Web Audio Oscillators
function playNotificationChime(isPositive = true) {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = "sine";
        if (isPositive) {
            // Pleasant upward double chime (C5 to E5)
            osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
            osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1); // E5
        } else {
            // Downward chime (E5 to C5)
            osc.frequency.setValueAtTime(659.25, ctx.currentTime);
            osc.frequency.setValueAtTime(523.25, ctx.currentTime + 0.1);
        }
        
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start();
        osc.stop(ctx.currentTime + 0.4);
    } catch(e){}
}

// --- Canvas Web Audio Visualizer ---
let canvasCtx = null;
function startCanvasAnimation() {
    if (visualizerCanvasAnimId) return;
    
    if (!canvasCtx) {
        canvasCtx = visualizerCanvas.getContext("2d");
    }

    const dataArray = new Uint8Array(audioAnalyser ? audioAnalyser.frequencyBinCount : 32);
    
    function draw() {
        visualizerCanvasAnimId = requestAnimationFrame(draw);
        
        const width = visualizerCanvas.width = voiceVisualizerContainer.clientWidth;
        const height = visualizerCanvas.height = 36;
        
        canvasCtx.fillStyle = "rgba(11, 12, 16, 0.2)";
        canvasCtx.fillRect(0, 0, width, height);

        if (isListening && !isSpeakingTTS && !isWaitingForResponse) {
            // Draw a subtle animated sine-wave or microphone level lines
            canvasCtx.lineWidth = 2;
            canvasCtx.strokeStyle = connectionState === "online" ? "#66fcf1" : "#45f3ff";
            canvasCtx.beginPath();
            
            const sliceWidth = width / 100;
            let x = 0;
            const time = Date.now() * 0.005;
            
            for (let i = 0; i < 100; i++) {
                const y = height / 2 + Math.sin(i * 0.15 + time) * (Math.sin(time * 0.5) * 6 + 4);
                if (i === 0) {
                    canvasCtx.moveTo(x, y);
                } else {
                    canvasCtx.lineTo(x, y);
                }
                x += sliceWidth;
            }
            canvasCtx.stroke();
        } else if (isWaitingForResponse) {
            // Draw scanning loader bars
            const pulse = Math.abs(Math.sin(Date.now() * 0.004)) * (width / 2);
            canvasCtx.fillStyle = "rgba(102, 252, 241, 0.15)";
            canvasCtx.fillRect(width/2 - pulse, height/2 - 2, pulse * 2, 4);
        } else if (isSpeakingTTS) {
            // Draw active speech wave frequencies
            if (audioAnalyser) {
                audioAnalyser.getByteFrequencyData(dataArray);
            }
            
            canvasCtx.lineWidth = 3;
            canvasCtx.strokeStyle = "#66fcf1";
            canvasCtx.beginPath();

            const barWidth = (width / dataArray.length) * 1.5;
            let barHeight;
            let x = 0;

            for (let i = 0; i < dataArray.length; i++) {
                barHeight = (dataArray[i] / 255) * height * 0.8;
                
                const y1 = height/2 - barHeight/2;
                const y2 = height/2 + barHeight/2;
                
                canvasCtx.moveTo(x, y1);
                canvasCtx.lineTo(x, y2);
                x += barWidth + 3;
            }
            canvasCtx.stroke();
        } else {
            // Flat idle line
            canvasCtx.lineWidth = 1;
            canvasCtx.strokeStyle = "rgba(255, 255, 255, 0.1)";
            canvasCtx.beginPath();
            canvasCtx.moveTo(0, height / 2);
            canvasCtx.lineTo(width, height / 2);
            canvasCtx.stroke();
        }
    }
    draw();
}

function stopCanvasAnimation() {
    if (visualizerCanvasAnimId) {
        cancelAnimationFrame(visualizerCanvasAnimId);
        visualizerCanvasAnimId = null;
    }
}

// --- Event Listeners Initialization ---
document.addEventListener("DOMContentLoaded", () => {
    geminiKeyInput.value = geminiKey;
    voiceLanguageSelect.value = selectedLang;

    // Check system status immediately and set periodic check
    checkSystemStatus();
    setInterval(checkSystemStatus, 6000);

    // Settings Drawer Event hooks
    settingsBtn.addEventListener("click", () => settingsDrawer.classList.remove("hidden"));
    closeSettingsBtn.addEventListener("click", () => settingsDrawer.classList.add("hidden"));
    document.querySelector(".drawer-backdrop").addEventListener("click", () => settingsDrawer.classList.add("hidden"));

    toggleKeyVisibility.addEventListener("click", () => {
        if (geminiKeyInput.type === "password") {
            geminiKeyInput.type = "text";
            toggleKeyVisibility.innerHTML = '<i class="fa-solid fa-eye-slash"></i>';
        } else {
            geminiKeyInput.type = "password";
            toggleKeyVisibility.innerHTML = '<i class="fa-solid fa-eye"></i>';
        }
    });

    geminiKeyInput.addEventListener("input", (e) => {
        geminiKey = e.target.value.trim();
        localStorage.setItem("gemini_key", geminiKey);
    });

    voiceLanguageSelect.addEventListener("change", (e) => {
        switchLanguage(e.target.value);
    });

    // Force Mode segment togglers
    document.querySelectorAll('input[name="force_mode"]').forEach(radio => {
        radio.addEventListener("change", (e) => {
            forceMode = e.target.value;
            console.log("Forced Mode set to:", forceMode);
            checkSystemStatus();
        });
    });

    // Force Language segment togglers
    document.querySelectorAll('input[name="force_lang"]').forEach(radio => {
        radio.addEventListener("change", (e) => {
            forceLang = e.target.value;
            console.log("Forced Language set to:", forceLang);
            if (forceLang === "ta") {
                switchLanguage("ta-IN");
            } else if (forceLang === "en") {
                switchLanguage("en-US");
            }
        });
    });

    // Manual Mic Recording button trigger
    voiceRecordBtn.addEventListener("click", () => {
        unlockAudioContext();
        if (voiceSessionActive) {
            triggerStopSession();
        } else {
            triggerWakeWord();
        }
    });

    // Text prompts submit
    sendBtn.addEventListener("click", submitTextQuery);
    textPrompt.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submitTextQuery();
    });

    retryStatusBtn.addEventListener("click", checkSystemStatus);

    // Fullscreen exit/enter controls
    if (toggleDashboardBtn) {
        toggleDashboardBtn.addEventListener("click", () => {
            triggerStopSession();
        });
    }

    if (showSmileyBtn) {
        showSmileyBtn.addEventListener("click", () => {
            triggerWakeWord();
        });
    }

    // Interactive Blush and wink animations when clicked directly
    if (smileyFace) {
        smileyFace.style.cursor = "pointer";
        smileyFace.addEventListener("click", () => {
            unlockAudioContext();
            playNotificationChime();
            smileyFace.classList.add("wink-eye", "blush-face");
            setTimeout(() => {
                smileyFace.classList.remove("wink-eye", "blush-face");
            }, 1500);
        });
    }

    // Auto launch passive listening engine
    setTimeout(() => {
        startSpeechEngine();
        setSmileyExpression("idle", "Say 'Start' or 'Max' to begin");
    }, 1000);
});

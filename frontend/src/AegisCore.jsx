import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import "./style.css";

// ── CONFIGURATION ─────────────────────────────────────────────
const WS_URL = process.env.REACT_APP_WS_URL || "ws://127.0.0.1:8000/ws/chat/";
const HEARTBEAT_MS = 10000;
const IDLE_TIMEOUT_MS = 15000; // 15s idle timer as requested
const MOVEMENT_BOUNDS = { x: [-3, 3], y: [-1, 1], z: [-2, 2] };

// ── FLUID SPHERE COMPONENT (Shader-Driven) ────────────────────
function FluidSphere({ audioLevelRef, targetPos }) {
    const mesh = useRef();

    // Shader Material defined once
    const material = useMemo(() => new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uAudio: { value: 0 }
        },
        vertexShader: `
            uniform float uTime;
            uniform float uAudio;
            varying vec3 vNormal;
            
            // Simplex-like noise function
            vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
            vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
            vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
            vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
            
            float snoise(vec3 v) {
                const vec2 C = vec2(1.0/6.0, 1.0/3.0);
                const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
                
                // First corner
                vec3 i  = floor(v + dot(v, C.yyy));
                vec3 x0 = v - i + dot(i, C.xxx);
                
                // Other corners
                vec3 g = step(x0.yzx, x0.xyz);
                vec3 l = 1.0 - g;
                vec3 i1 = min( g.xyz, l.zxy );
                vec3 i2 = max( g.xyz, l.zxy );
                
                vec3 x1 = x0 - i1 + C.xxx;
                vec3 x2 = x0 - i2 + C.yyy;
                vec3 x3 = x0 - D.yyy;
                
                // Permutations
                i = mod289(i);
                vec4 p = permute( permute( permute(
                         i.z + vec4(0.0, i1.z, i2.z, 1.0))
                       + i.y + vec4(0.0, i1.y, i2.y, 1.0))
                       + i.x + vec4(0.0, i1.x, i2.x, 1.0));
                       
                // Gradients
                float n_ = 0.142857142857;
                vec3  ns = n_ * D.wyz - D.xzx;
                vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
                
                vec4 x_ = floor(j * ns.z);
                vec4 y_ = floor(j - 7.0 * x_);
                
                vec4 x = x_ *ns.x + ns.yyyy;
                vec4 y = y_ *ns.x + ns.yyyy;
                vec4 h = 1.0 - abs(x) - abs(y);
                
                vec4 b0 = vec4( x.xy, y.xy );
                vec4 b1 = vec4( x.zw, y.zw );
                
                vec4 s0 = floor(b0)*2.0 + 1.0;
                vec4 s1 = floor(b1)*2.0 + 1.0;
                vec4 sh = -step(h, vec4(0.0));
                
                vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
                vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
                
                vec3 p0 = vec3(a0.xy,h.x);
                vec3 p1 = vec3(a0.zw,h.y);
                vec3 p2 = vec3(a1.xy,h.z);
                vec3 p3 = vec3(a1.zw,h.w);
                
                // Normalise gradients
                vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
                p0 *= norm.x;
                p1 *= norm.y;
                p2 *= norm.z;
                p3 *= norm.w;
                
                // Mix final noise value
                vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
                m = m * m;
                return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
            }

            void main() {
                vNormal = normal;
                vec3 pos = position;
                
                // Noise based on time + audio
                float n = snoise(pos * 1.5 + uTime * 0.5); 
                
                // "Breathing Cycle": Layer slow sine wave (0.5Hz) on top of audio
                float breath = sin(uTime * 3.14159) * 0.03; 
                
                // Distortion: Base breath + Audio spike effect
                float distortion = n * (0.1 + uAudio * 1.5) + breath;
                
                pos += normal * distortion;
                
                gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
            }
        `,
        fragmentShader: `
            varying vec3 vNormal;
            
            void main() {
                // Tech Green Aesthetic
                vec3 baseColor = vec3(0.01, 0.15, 0.08);
                vec3 highlightColor = vec3(0.2, 1.0, 0.6);
                
                // Fresnel for glowing edge
                vec3 viewDir = vec3(0.0, 0.0, 1.0); // Simplified view direction
                float fresnel = pow(1.0 - dot(normalize(vNormal), viewDir), 2.5);
                
                vec3 color = mix(baseColor, highlightColor, fresnel * 0.9);
                
                gl_FragColor = vec4(color, 1.0);
            }
        `,
        transparent: true
    }), []);

    useFrame((state) => {
        // 1. Update Uniforms
        material.uniforms.uTime.value = state.clock.elapsedTime;
        // Use ref value directly for smooth updates
        material.uniforms.uAudio.value = THREE.MathUtils.lerp(material.uniforms.uAudio.value, audioLevelRef.current, 0.15);

        // 2. Movement Lerp (No React State Updates)
        if (mesh.current) {
            mesh.current.position.lerp(targetPos.current, 0.05); // "Glide" factor
            mesh.current.rotation.y += 0.003 + (audioLevelRef.current * 0.02); // Dynamic spin

            // Biological Breathing (Scale Pulse)
            const breath = Math.sin(state.clock.elapsedTime * 3.14159) * 0.005; // 0.5Hz approx (PI radians/sec)
            const scale = 1.0 + breath + (audioLevelRef.current * 0.1); // Base breath + audio pop
            mesh.current.scale.setScalar(scale);
        }
    });

    return (
        <mesh ref={mesh} castShadow receiveShadow>
            <sphereGeometry args={[1.2, 128, 128]} />
            <primitive object={material} attach="material" />
        </mesh>
    );
}

// ── AEGIS LOGIC MANAGER ───────────────────────────────────────
// Now a child of the Canvas in WorldRoot, handling only logic and UI overlay portal if needed.
// However, since UI needs to be outside Canvas, we might need a different approach or portal.
// For simplicity in this refactor, we will use Html from drei for the UI or just return the mesh here 
// and manage the logic. The UI text was overlayed in the previous version.
// To keep it clean: We will assume WorldRoot handles the Canvas, and AegisCore returns the Mesh 
// BUT we also need the UI. We can use <Html> for the subtitle/status or keep the non-canvas UI in WorldRoot?
// No, simpler: WorldRoot renders specific UI components if needed, or we use <Html fullscreen> for the UI layer.
// Actually, let's keep AegisCore as a Logical Component that returns the Sphere and uses `Html` for UI.



export default function AegisCore() {
    const [status, setStatus] = useState("System Standby");
    const [subtitle, setSubtitle] = useState("");
    const [hasStarted, setHasStarted] = useState(false);

    // Refs
    const ws = useRef(null);
    const audioCtx = useRef(null);
    const analyser = useRef(null);
    const gainNode = useRef(null);
    const audioWorker = useRef(null);
    const workerCallbacks = useRef({});
    const workerIdCounter = useRef(0);
    const activeSourceNodes = useRef([]);
    const pendingDecodes = useRef(0);
    const nextStartTime = useRef(0);
    const textBuffer = useRef("");
    const wordTimestamps = useRef([]);

    // Core State Refs
    const targetPos = useRef(new THREE.Vector3(0, 0, 0));
    const audioLevelRef = useRef(0);
    // const idleTimer = useRef(0); // Managed via checking lastInteractionTime
    const lastInteractionTime = useRef(Date.now());
    const isProcessingIdle = useRef(false);

    // ── LOGIC LOOP (Background-Safe) ─────────────────────────────
    useEffect(() => {
        const interval = setInterval(() => {
            const now = Date.now();

            // 1. Heartbeat
            if (ws.current?.readyState === WebSocket.OPEN) {
                ws.current.send(JSON.stringify({ type: "ping" }));
            }

            // 2. Background Audio Pulse (Keep Alive)
            if (analyser.current) {
                const dataArray = new Uint8Array(analyser.current.frequencyBinCount);
                analyser.current.getByteFrequencyData(dataArray);
                let sum = 0;
                for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
                const avg = sum / dataArray.length;
                audioLevelRef.current = Math.min(avg / 128.0, 1.0);
            }

            // 3. Autonomous Agency & Vision Check
            if (ws.current?.readyState === WebSocket.OPEN && !isProcessingIdle.current && hasStarted) {
                if ((now - lastInteractionTime.current > IDLE_TIMEOUT_MS) && status === "Listening...") {
                    console.log("Triggering Autonomous Action");
                    isProcessingIdle.current = true;
                    // Move sphere
                    triggerRandomMove();

                    // Capture Vision Frame for context
                    const frame = captureFrame();

                    // Send Idle Trigger with Vision Data
                    ws.current.send(JSON.stringify({
                        type: "idle_trigger",
                        vision: frame
                    }));

                    lastInteractionTime.current = now;
                }
            }
        }, 1000); // Run logic every second

        return () => clearInterval(interval);
    }, [hasStarted, status]);

    // ── VISUAL LOOP (RAF - Pauses in Background) ─────────────────
    useFrame((state) => {
        // 1. Look At User (Camera)
        if (mesh.current) {
            mesh.current.lookAt(state.camera.position);

            // Lerp Position
            mesh.current.position.lerp(targetPos.current, 0.05);

            // Biological Breathing (Scale Pulse)
            const breath = Math.sin(state.clock.elapsedTime * 3.14159) * 0.005;
            const scale = 1.0 + breath + (audioLevelRef.current * 0.1);
            mesh.current.scale.setScalar(scale);
        }

        // Audio analysis also happens here for 60fps smoothness when visible
        if (analyser.current) {
            const dataArray = new Uint8Array(analyser.current.frequencyBinCount);
            analyser.current.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
            const avg = sum / dataArray.length;
            audioLevelRef.current = Math.min(avg / 128.0, 1.0);
        }
    });


    const triggerRandomMove = () => {
        const x = (Math.random() * (MOVEMENT_BOUNDS.x[1] - MOVEMENT_BOUNDS.x[0])) + MOVEMENT_BOUNDS.x[0];
        const y = (Math.random() * (MOVEMENT_BOUNDS.y[1] - MOVEMENT_BOUNDS.y[0])) + MOVEMENT_BOUNDS.y[0];
        const z = (Math.random() * (MOVEMENT_BOUNDS.z[1] - MOVEMENT_BOUNDS.z[0])) + MOVEMENT_BOUNDS.z[0];
        targetPos.current.set(x, y, z);
    };

    // ── CAMERA & VISION ─────────────────────────────────────────
    const videoRef = useRef(document.createElement("video"));

    const startCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
            videoRef.current.srcObject = stream;
            videoRef.current.play();
        } catch (e) {
            console.error("Camera access denied:", e);
        }
    };

    const captureFrame = () => {
        if (!videoRef.current || videoRef.current.readyState !== 4) return null;
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 240;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(videoRef.current, 0, 0, 320, 240);
        return canvas.toDataURL("image/jpeg", 0.5).split(",")[1]; // Return base64 body
    };

    // ── AUDIO & WS LOGIC ────────────────────────────────────────
    const initSystem = useCallback(() => {
        // Audio Init
        audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();
        audioCtx.current.resume();
        analyser.current = audioCtx.current.createAnalyser();
        analyser.current.fftSize = 512;
        gainNode.current = audioCtx.current.createGain();
        gainNode.current.connect(analyser.current);
        analyser.current.connect(audioCtx.current.destination);

        // Worker Init
        audioWorker.current = new Worker("/audioWorker.js");
        audioWorker.current.onmessage = ({ data }) => {
            const { id, buffer, error } = data;
            const cb = workerCallbacks.current[id];
            if (cb) { delete workerCallbacks.current[id]; error ? cb.reject(error) : cb.resolve(buffer); }
        };

        // WebSocket Init
        ws.current = new WebSocket(WS_URL);
        ws.current.onopen = () => { setStatus("AEGIS Online"); setHasStarted(true); lastInteractionTime.current = Date.now(); };
        ws.current.onmessage = (e) => handleMessage(JSON.parse(e.data));
        ws.current.onclose = () => setStatus("Offline");



        // Subtitle Loop
        const tick = () => {
            if (audioCtx.current && wordTimestamps.current.length > 0) {
                const now = audioCtx.current.currentTime;
                if (wordTimestamps.current[0].time <= now) {
                    const w = wordTimestamps.current.shift();
                    setSubtitle(prev => (prev + " " + w.word).trim());
                }
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);



        startCamera();
        setupSpeechRec();
    }, []);

    const handleMessage = (data) => {
        lastInteractionTime.current = Date.now();
        isProcessingIdle.current = false; // Reset idle block

        switch (data.type) {
            case "text":
                textBuffer.current = data.text;
                break;
            case "audio_chunk":
                processAudioChunk(data.data, data.sequence_id);
                break;
            case "move":
                targetPos.current.set(data.x || 0, data.y || 0, data.z || 0);
                break;
            case "clear_audio": hardStop(); break;
            default: break;
        }
    };

    const processAudioChunk = async (b64, seqId) => {
        if (!audioCtx.current) return;
        setStatus("Speaking...");

        // Decode in worker
        const id = ++workerIdCounter.current;
        const decodePromise = new Promise((res, rej) => workerCallbacks.current[id] = { resolve: res, reject: rej });
        audioWorker.current.postMessage({ id, base64: b64 });
        const arrayBuffer = await decodePromise;

        const audioBuffer = await audioCtx.current.decodeAudioData(arrayBuffer);
        const source = audioCtx.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(gainNode.current);

        const now = audioCtx.current.currentTime;
        const startAt = Math.max(now, nextStartTime.current);
        source.start(startAt);
        nextStartTime.current = startAt + audioBuffer.duration;
        activeSourceNodes.current.push(source);

        if (textBuffer.current) {
            const words = textBuffer.current.split(" ");
            const durPerWord = audioBuffer.duration / words.length;
            words.forEach((w, i) => {
                wordTimestamps.current.push({ word: w, time: startAt + (durPerWord * i) });
            });
            textBuffer.current = "";
        }

        source.onended = () => {
            activeSourceNodes.current = activeSourceNodes.current.filter(n => n !== source);
            if (activeSourceNodes.current.length === 0) {
                setStatus("Listening...");
                setTimeout(() => setSubtitle(""), 2000);
            }
        };
    };

    const hardStop = () => {
        activeSourceNodes.current.forEach(n => n.stop());
        activeSourceNodes.current = [];
        nextStartTime.current = 0;
        wordTimestamps.current = [];
        setSubtitle("");
    };

    const setupSpeechRec = () => {
        const Sr = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!Sr) return;
        const rec = new Sr();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = "en-US";
        rec.onresult = (e) => {
            const res = e.results[e.results.length - 1];
            if (res.isFinal) {
                ws.current?.send(JSON.stringify({ type: "message", message: res[0].transcript }));
                setStatus("Thinking...");
                setSubtitle("");
                lastInteractionTime.current = Date.now();
            }
        };
        rec.start();
    };

    return (
        <group>
            {/* UI Layer via Html */}
            <Html fullscreen style={{ pointerEvents: 'none', width: '100vw', height: '100vh' }}>
                <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                    {!hasStarted && (
                        <div onClick={initSystem} style={{
                            position: "absolute", zIndex: 100, inset: 0, background: "rgba(0,0,0,0.8)",
                            display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "auto", cursor: "pointer"
                        }}>
                            <h1 style={{ color: "white", fontFamily: "monospace" }}>CLICK TO INITIALIZE SOVEREIGN CORE</h1>
                        </div>
                    )}

                    <div style={{ position: "absolute", zIndex: 10, top: 20, left: 20, color: "#00ffaa", textShadow: "0 0 10px #00ffaa", fontFamily: "monospace" }}>
                        <h3>STATUS: {status}</h3>
                    </div>

                    {subtitle && (
                        <div style={{
                            position: "absolute", bottom: "10%", width: "100%", textAlign: "center",
                            zIndex: 10, color: "#cecece", fontSize: "1.5rem", fontFamily: "monospace", textShadow: "0 2px 4px black"
                        }}>
                            {subtitle}
                        </div>
                    )}
                </div>
            </Html>

            {/* The Sphere */}
            <FluidSphere audioLevelRef={audioLevelRef} targetPos={targetPos} />
        </group>
    );
}

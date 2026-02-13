import React, { useState, useRef, useEffect, useCallback, Suspense, useMemo, forwardRef, useImperativeHandle } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Environment as DreiEnvironment, ContactShadows, useGLTF } from "@react-three/drei";
import { Physics, usePlane } from "@react-three/cannon";
import * as THREE from "three";
import { MathUtils } from "three";
import "./style.css";

// ── CONFIGURATION ─────────────────────────────────────────────
const WS_URL = "ws://127.0.0.1:8000/ws/chat/";
const MODEL_URL = "/avatar.glb";
const HEARTBEAT_MS = 10000;
const VISUAL_FRAME_MS = 3000;
const IDLE_TIMEOUT_MS = 20000;

const HDR_MAP = {
    space: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/shanghai_bund_4k.hdr",
    cyberpunk: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/shanghai_bund_4k.hdr",
    city: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/shanghai_bund_4k.hdr",
    night: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/shanghai_bund_4k.hdr",
    neon: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/shanghai_bund_4k.hdr",
    shanghai: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/shanghai_bund_4k.hdr",
    forest: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/forest_slope_4k.hdr",
    nature: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/forest_slope_4k.hdr",
    garden: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/forest_slope_4k.hdr",
    office: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/industrial_sunset_02_4k.hdr",
    sunset: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/industrial_sunset_02_4k.hdr",
};

// ── SUB-COMPONENT: PHYSICS FLOOR ──────────────────────────────
function PhysicsFloor() {
    usePlane(() => ({
        rotation: [-Math.PI / 2, 0, 0],
        position: [0, -1, 0],
        type: "Static",
    }));
    return (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.001, 0]} receiveShadow>
            <planeGeometry args={[20, 20]} />
            <meshStandardMaterial color="#111118" roughness={0.8} />
        </mesh>
    );
}

// ── SUB-COMPONENT: BACKGROUND MANAGER ─────────────────────────
function BackgroundManager({ query }) {
    const { scene } = useThree();
    const [hdrUrl, setHdrUrl] = useState(null);
    const [fallbackUrl, setFallbackUrl] = useState(null);
    const prevQuery = useRef("");

    useEffect(() => {
        if (!query || query === prevQuery.current) return;
        prevQuery.current = query;
        const lower = query.toLowerCase();
        let matched = null;
        for (const [k, v] of Object.entries(HDR_MAP)) {
            if (lower.includes(k)) { matched = v; break; }
        }

        if (matched) {
            setHdrUrl(matched);
            setFallbackUrl(null);
        } else {
            setHdrUrl(null);
            setFallbackUrl(`https://source.unsplash.com/3840x2160/?${encodeURIComponent(query)}`);
        }
    }, [query]);

    useEffect(() => {
        if (!hdrUrl) return;
        const { RGBELoader } = require("three/examples/jsm/loaders/RGBELoader.js");
        new RGBELoader().load(hdrUrl, (texture) => {
            texture.mapping = THREE.EquirectangularReflectionMapping;
            scene.background = texture;
            scene.environment = texture;
        });
    }, [hdrUrl, scene]);

    useEffect(() => {
        if (!fallbackUrl) return;
        new THREE.TextureLoader().load(fallbackUrl, (texture) => {
            texture.mapping = THREE.EquirectangularReflectionMapping;
            texture.colorSpace = THREE.SRGBColorSpace;
            scene.background = texture;
            scene.environment = texture;
        });
    }, [fallbackUrl, scene]);

    return null;
}

// ── SUB-COMPONENT: AEGIS AVATAR (Pure Logic + Mesh) ───────────
const AegisAvatar = forwardRef(({ analyser, isSpeaking, lookTarget }, ref) => {
    const { scene } = useGLTF(MODEL_URL);
    const avatarRef = useRef();

    // Movement & Animation State
    const targetPos = useRef(new THREE.Vector3(0, 0, 0));
    const targetRot = useRef(new THREE.Quaternion());
    const prevPos = useRef(new THREE.Vector3(0, 0, 0));

    // Micro-gestures
    const blinkTimer = useRef(0);
    const nextBlink = useRef(3);
    const saccadeTimer = useRef(0);
    const eyeTarget = useRef({ x: 0, y: 0 });
    const idleAnimState = useRef({ type: null, timer: 0, active: false });

    // Physics-based spring bones
    const spring = useRef({
        hipZ: 0, hipY: 0, spineX: 0, spineZ: 0,
        ikNeckY: 0, ikNeckX: 0, lArmZ: 0, lArmVel: 0, rArmZ: 0, rArmVel: 0
    });

    useImperativeHandle(ref, () => ({
        moveTo(x, y, z) {
            // Clamp target position to reachable area
            targetPos.current.set(MathUtils.clamp(x, -3, 3), 0, MathUtils.clamp(z, -2, 2));

            // Calculate rotation to face LookAt(0,0.5,4) typically, or just face forward.
            // We keep it simple: Face somewhat towards center or camera?
            // For now, identity is safe, or slight rotation based on X.

            // Strict Rotation Clamp: +/- 45 degrees Y-axis
            // We'll update targetRot based on position if we want her to turn while moving,
            // but the prompt specifically asked to "Clamp the Y-axis rotation".
            // Let's just keep her facing forward mostly, with slight turn towards center.
            const angle = MathUtils.clamp(-x * 0.1, -Math.PI / 4, Math.PI / 4);
            targetRot.current.setFromEuler(new THREE.Euler(0, angle, 0));
        },
        triggerIdle(type) {
            idleAnimState.current = { type, timer: 0, active: true };
        },
        slowAndLook() {
            if (avatarRef.current) targetPos.current.lerp(avatarRef.current.position, 0.8);
        }
    }));

    // Setup: Beard Purge & Bone Cache
    const { morphMeshes, bones } = useMemo(() => {
        const mm = { head: null, teeth: null };
        const b = {};
        const boneNames = ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head", "LeftArm", "RightArm", "LeftForeArm", "RightForeArm", "LeftShoulder", "RightShoulder"];

        scene.traverse((child) => {
            if (child.isMesh) {
                child.frustumCulled = false;
                const n = child.name.toLowerCase();
                if (n.includes("beard") || n.includes("facial_hair") || n.includes("mustache")) {
                    child.visible = false;
                    child.geometry?.dispose();
                    child.material?.dispose();
                }
                if (child.morphTargetDictionary) {
                    if (n.includes("head") || n.includes("wolf3d_head")) mm.head = child;
                    else if (n.includes("teeth")) mm.teeth = child;
                }
            }
            if (child.isBone && boneNames.includes(child.name)) b[child.name] = child;
        });
        return { morphMeshes: mm, bones: b };
    }, [scene]);

    const dataArray = useMemo(() => analyser ? new Uint8Array(analyser.frequencyBinCount) : null, [analyser]);

    useFrame((state, delta) => {
        const t = state.clock.elapsedTime;
        const dt = Math.min(delta, 0.05);
        const s = spring.current;

        // 1. POSITION & ROTATION LERP
        if (avatarRef.current) {
            prevPos.current.copy(avatarRef.current.position);
            avatarRef.current.position.lerp(targetPos.current, 0.05);
            avatarRef.current.quaternion.slerp(targetRot.current, 0.05);
        }
        const velX = avatarRef.current ? avatarRef.current.position.x - prevPos.current.x : 0;

        // 2. LIP SYNC & EXPRESSIONS
        let jawVal = 0, smileVal = 0;
        if (analyser && dataArray && isSpeaking?.current) {
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < 30; i++) sum += dataArray[i];
            jawVal = Math.min((sum / 30 / 255) * 2.5, 1.0);
            smileVal = Math.min((sum / 30 / 255) * 0.5, 0.3);
        }

        const applyMorph = (mesh, name, val) => {
            if (!mesh?.morphTargetDictionary) return;
            const idx = mesh.morphTargetDictionary[name];
            if (idx !== undefined) mesh.morphTargetInfluences[idx] = MathUtils.lerp(mesh.morphTargetInfluences[idx], val, 0.2);
        };

        if (morphMeshes.head) {
            applyMorph(morphMeshes.head, "jawOpen", jawVal);
            applyMorph(morphMeshes.head, "mouthSmileLeft", smileVal + 0.1);
            applyMorph(morphMeshes.head, "mouthSmileRight", smileVal + 0.1);

            // Blink
            blinkTimer.current += dt;
            if (blinkTimer.current > nextBlink.current) {
                const blinkPhase = (blinkTimer.current - nextBlink.current) / 0.15;
                const bv = blinkPhase < 0.5 ? blinkPhase * 2 : (1 - blinkPhase) * 2;
                applyMorph(morphMeshes.head, "eyeBlinkLeft", Math.max(0, bv));
                applyMorph(morphMeshes.head, "eyeBlinkRight", Math.max(0, bv));
                if (blinkTimer.current > nextBlink.current + 0.15) {
                    blinkTimer.current = 0;
                    nextBlink.current = 2 + Math.random() * 4;
                }
            } else {
                applyMorph(morphMeshes.head, "eyeBlinkLeft", 0);
                applyMorph(morphMeshes.head, "eyeBlinkRight", 0);
            }
        }
        if (morphMeshes.teeth) applyMorph(morphMeshes.teeth, "jawOpen", jawVal);

        // 3. BODY PHYSICS (Breathing, Sway, Inertia)
        // Breathing
        if (bones.Spine) bones.Spine.rotation.x = Math.sin(t * 2) * 0.02;
        // Inertia on Hips
        s.hipZ = MathUtils.lerp(s.hipZ, velX * 3.0, dt * 2);
        if (bones.Hips) bones.Hips.rotation.z = s.hipZ;

        // 4. IK LOOK-AT
        let lookX = 0, lookY = 0;
        if (lookTarget?.current) {
            lookX = -lookTarget.current.x * 0.5; // Yaw
            lookY = lookTarget.current.y * 0.3;  // Pitch
        }
        s.spineX = MathUtils.lerp(s.spineX, lookX, dt * 3);
        s.spineZ = MathUtils.lerp(s.spineZ, lookY, dt * 3);

        // Distribute look rotation
        if (bones.Neck) { bones.Neck.rotation.y = s.spineX * 0.5; bones.Neck.rotation.x = s.spineZ * 0.5; }
        if (bones.Head) { bones.Head.rotation.y = s.spineX * 0.5; bones.Head.rotation.x = s.spineZ * 0.5; }
    });

    return <primitive ref={avatarRef} object={scene} position={[0, -1, 0]} />;
});
useGLTF.preload(MODEL_URL);


// ── MAIN COMPONENT: AEGIS CORE ────────────────────────────────
export default function AegisCore() {
    const [status, setStatus] = useState("System Standby");
    const [subtitle, setSubtitle] = useState("");
    const [bgQuery, setBgQuery] = useState("");
    const [hasStarted, setHasStarted] = useState(false);

    // Refs
    const ws = useRef(null);
    const avatarRef = useRef(null);
    const audioCtx = useRef(null);
    const analyser = useRef(null);
    const gainNode = useRef(null);
    const isSpeaking = useRef(false);
    const audioWorker = useRef(null);
    const workerCallbacks = useRef({});
    const workerIdCounter = useRef(0);
    const activeSourceNodes = useRef([]);
    const pendingDecodes = useRef(0);
    const nextStartTime = useRef(0);
    const textBuffer = useRef("");
    const wordTimestamps = useRef([]);
    const lookTarget = useRef({ x: 0, y: 0 });

    // ── AUDIO & WS LOGIC ────────────────────────────────────────
    const initSystem = useCallback(() => {
        // Audio Init
        audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();
        audioCtx.current.resume();
        analyser.current = audioCtx.current.createAnalyser();
        analyser.current.fftSize = 256;
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
        ws.current.onopen = () => { setStatus("AEGIS Online"); setHasStarted(true); };
        ws.current.onmessage = (e) => handleMessage(JSON.parse(e.data));
        ws.current.onclose = () => setStatus("Offline");

        // Heartbeat
        setInterval(() => {
            if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ type: "ping" }));
        }, HEARTBEAT_MS);

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

        // Microphone / VAD would go here (simplified for consolidation)
        setupSpeechRec();
    }, []);

    const handleMessage = (data) => {
        switch (data.type) {
            case "text":
                // Buffer text for subtitle sync
                textBuffer.current = data.text;
                break;
            case "audio_chunk":
                // We'll decode immediately for simplicity in this lean version, or buffer. 
                // Assuming we get base64 chunks
                processAudioChunk(data.data, data.sequence_id);
                break;
            case "audio_end":
                // Finalize any sync logic
                break;
            case "change_bg": setBgQuery(data.query); break;
            case "move": avatarRef.current?.moveTo(data.x || 0, data.y || 0, data.z || 0); break;
            case "slow_look": avatarRef.current?.slowAndLook(); break;
            case "clear_audio": hardStop(); break;
            default: break;
        }
    };

    const processAudioChunk = async (b64, seqId) => {
        if (!audioCtx.current) return;
        setStatus("Speaking...");
        isSpeaking.current = true;

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

        // Sync subtitles
        if (textBuffer.current) {
            const words = textBuffer.current.split(" ");
            const durPerWord = audioBuffer.duration / words.length;
            words.forEach((w, i) => {
                wordTimestamps.current.push({ word: w, time: startAt + (durPerWord * i) });
            });
            textBuffer.current = ""; // consumed
        }

        source.onended = () => {
            activeSourceNodes.current = activeSourceNodes.current.filter(n => n !== source);
            if (activeSourceNodes.current.length === 0) {
                isSpeaking.current = false;
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
        isSpeaking.current = false;
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
                setSubtitle(""); // Clear previous subs
            }
        };
        rec.start();
    };

    // ── RENDER ──────────────────────────────────────────────────
    return (
        <div className="App" onClick={() => audioCtx.current?.resume()}>
            {!hasStarted && (
                <div className="start-overlay" onClick={initSystem} style={{
                    position: "absolute", zIndex: 100, inset: 0, background: "rgba(0,0,0,0.8)",
                    display: "flex", alignItems: "center", justifyContent: "center", color: "white", cursor: "pointer"
                }}>
                    <h1>CLICK TO INITIALIZE AEGIS</h1>
                </div>
            )}

            <div className="ui-layer" style={{ position: "absolute", zIndex: 10, padding: 20, color: "cyan", textShadow: "0 0 10px cyan" }}>
                <h3>{status}</h3>
            </div>

            {subtitle && (
                <div className="subtitle-layer" style={{
                    position: "absolute", bottom: "10%", width: "100%", textAlign: "center",
                    zIndex: 10, color: "white", fontSize: "2rem", textShadow: "0 2px 4px black", pointerEvents: "none"
                }}>
                    {subtitle}
                </div>
            )}

            <Canvas shadows camera={{ position: [0, 1.4, 4], fov: 45 }} style={{ background: "#111" }}>
                <fog attach="fog" args={["#111", 5, 20]} />
                <ambientLight intensity={0.5} />
                <spotLight position={[5, 10, 5]} angle={0.5} penumbra={1} intensity={1} castShadow />

                <Physics gravity={[0, -9.8, 0]}>
                    <Suspense fallback={null}>
                        <AegisAvatar
                            ref={avatarRef}
                            analyser={analyser.current}
                            isSpeaking={isSpeaking}
                            lookTarget={lookTarget}
                        />
                        <PhysicsFloor />
                    </Suspense>
                </Physics>

                <ContactShadows scale={20} blur={2} far={4} color="#000" opacity={0.7} />
                <BackgroundManager query={bgQuery} />
                <OrbitControls target={[0, 1, 0]} maxPolarAngle={Math.PI / 1.8} enableZoom={false} enablePan={false} />
            </Canvas>
        </div>
    );
}

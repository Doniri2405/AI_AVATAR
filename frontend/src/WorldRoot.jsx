import React from "react";
import { Canvas } from "@react-three/fiber";
import { Environment as DreiEnvironment, OrbitControls, ContactShadows } from "@react-three/drei";
import AegisCore from "./AegisCore";

export default function WorldRoot() {
    return (
        <div style={{ width: "100vw", height: "100vh", background: "#050505" }}>
            <Canvas shadows camera={{ position: [0, 0, 6], fov: 45 }}>
                {/* Persistent 4K Environment */}
                <DreiEnvironment
                    files="https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/industrial_sunset_02_4k.hdr"
                    background
                    blur={0.2}
                />

                <fog attach="fog" args={["#050505", 5, 20]} />
                <ambientLight intensity={0.5} />
                <spotLight position={[5, 10, 5]} angle={0.5} penumbra={1} intensity={2} color="#00ffaa" castShadow />

                <AegisCore />

                <ContactShadows scale={20} blur={2} far={4} color="#000" opacity={0.7} />
                <OrbitControls enableZoom={false} enablePan={false} />
            </Canvas>
        </div>
    );
}

import React, { useRef, useMemo, useState, useCallback } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Box, Cylinder, Sphere, useGLTF, Edges } from '@react-three/drei';
import * as THREE from 'three';

const DRAG_SENSITIVITY = 0.007;
const INERTIA_DAMPING = 0.92;
const IDLE_ROTATION_SPEED = (Math.PI * 2) / 18;
const MAX_MOUSE_TILT = (4 * Math.PI) / 180; // 4°
const HOVER_SCALE = 1.03;
const LERP_SPEED = 0.06;
const IDLE_RESUME_SECONDS = 3;

interface SystemCoreProps {
    isButtonHovered: boolean;
    isSimulationStarting: boolean;
    mouseRef: React.MutableRefObject<{ x: number; y: number }>;
    isMouseInHero: React.MutableRefObject<boolean>;
    onCubeHover?: (hovered: boolean) => void;
    onCubeDragging?: (dragging: boolean) => void;
    innerGlowRef?: React.MutableRefObject<THREE.Group | null>;
}

export const SystemCore = React.memo<SystemCoreProps>(({
    isButtonHovered,
    isSimulationStarting,
    mouseRef,
    isMouseInHero,
    onCubeHover,
    onCubeDragging,
    innerGlowRef: outerInnerGlowRef
}) => {
    const groupRef = useRef<THREE.Group>(null);
    const localInnerRef = useRef<THREE.Group>(null);
    const innerGlowRef = outerInnerGlowRef ?? localInnerRef;
    const coreSphereRef = useRef<THREE.Mesh>(null);
    const beamRef = useRef<THREE.Mesh>(null);
    const beamPulseRef = useRef<THREE.Mesh>(null);
    const lightColumnRef = useRef<THREE.Mesh>(null);
    const orbitInstancedRef = useRef<THREE.InstancedMesh>(null);
    const sparkRefs = useRef<THREE.Group>(null);

    const [isDragging, setIsDragging] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const dragVelRef = useRef({ x: 0, y: 0 });
    const lastPointerRef = useRef({ x: 0, y: 0 });
    const clickBeamBoostRef = useRef(0);
    const lastActiveRef = useRef(0);
    const userRotRef = useRef({ x: 0, y: 0, z: 0 });
    const isDraggingRef = useRef(false);

    const handlePointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        (e.nativeEvent.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
        isDraggingRef.current = true;
        setIsDragging(true);
        onCubeDragging?.(true);
        lastActiveRef.current = performance.now() / 1000;
        lastPointerRef.current = { x: e.pointer.x, y: e.pointer.y };
        dragVelRef.current = { x: 0, y: 0 };
    }, [onCubeDragging]);

    const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
        if (!isDraggingRef.current) return;
        lastActiveRef.current = performance.now() / 1000;
        const dx = e.pointer.x - lastPointerRef.current.x;
        const dy = e.pointer.y - lastPointerRef.current.y;
        if (groupRef.current) {
            userRotRef.current.y += dx * DRAG_SENSITIVITY * 50;
            userRotRef.current.x += dy * DRAG_SENSITIVITY * 50;
        }
        dragVelRef.current = { x: dx * DRAG_SENSITIVITY * 3.5, y: dy * DRAG_SENSITIVITY * 3.5 };
        lastPointerRef.current = { x: e.pointer.x, y: e.pointer.y };
    }, []);

    const handlePointerUp = useCallback((e: ThreeEvent<PointerEvent>) => {
        (e.nativeEvent.target as HTMLCanvasElement).releasePointerCapture(e.pointerId);
        isDraggingRef.current = false;
        setIsDragging(false);
        onCubeDragging?.(false);
        lastActiveRef.current = performance.now() / 1000;
    }, [onCubeDragging]);

    const handlePointerEnter = useCallback((_e: ThreeEvent<PointerEvent>) => {
        setIsHovered(true);
        onCubeHover?.(true);
    }, [onCubeHover]);

    const handlePointerLeave = useCallback((_e: ThreeEvent<PointerEvent>) => {
        setIsHovered(false);
        onCubeHover?.(false);
    }, [onCubeHover]);

    const handleClick = useCallback((_e: ThreeEvent<MouseEvent>) => {
        clickBeamBoostRef.current = 1;
    }, []);

    const { scene } = useGLTF('/src/assets/futuristic_cube.glb');

    const model = useMemo(() => {
        const cloned = scene.clone();
        cloned.traverse((node) => {
            if (node instanceof THREE.Mesh) {
                const name = node.name.toLowerCase();
                const isCircuit = name.includes('light') || name.includes('glow') || name.includes('circuit') || name.includes('emissive');
                const isPanel = name.includes('panel') || name.includes('face') || name.includes('slot');
                const isFrame = name.includes('frame') || name.includes('rim') || name.includes('edge');
                const roughnessJitter = 0.32 + Math.random() * 0.08;

                const baseMaterial = new THREE.MeshStandardMaterial({
                    color: isPanel ? '#0b1120' : '#111827',
                    metalness: 0.92,
                    roughness: roughnessJitter,
                    emissive: '#020617',
                    emissiveIntensity: 0.4,
                });
                if (isFrame) {
                    baseMaterial.metalness = 0.95;
                    baseMaterial.roughness = 0.28;
                }
                if (isCircuit) {
                    baseMaterial.color.set('#0a1628');
                    baseMaterial.emissive.set('#3b82f6');
                    baseMaterial.emissiveIntensity = 14;
                    baseMaterial.roughness = 0.2;
                    baseMaterial.toneMapped = true;
                } else {
                    baseMaterial.emissiveIntensity = 0.02;
                }
                if (!isCircuit) baseMaterial.toneMapped = true;
                baseMaterial.envMapIntensity = isCircuit ? 1.2 : 1.4;
                node.material = baseMaterial;
            }
        });
        return cloned;
    }, [scene]);

    const orbitData = useMemo(() => {
        return Array.from({ length: 14 }).map(() => ({
            radius: 10.0 + Math.random() * 6.0,
            speed: 0.05 + Math.random() * 0.08,
            offset: Math.random() * Math.PI * 2,
            size: 0.08 + Math.random() * 0.1,
        }));
    }, []);

    const orbitGeo = useMemo(() => new THREE.BoxGeometry(0.1, 0.1, 0.1), []);
    const orbitMat = useMemo(
        () =>
            new THREE.MeshStandardMaterial({
                color: '#3b82f6',
                emissive: '#3b82f6',
                emissiveIntensity: 0.6,
                transparent: true,
                opacity: 0.6,
                metalness: 0.9,
                roughness: 0.4,
            }),
        []
    );
    const orbitDummy = useMemo(() => new THREE.Object3D(), []);

    useFrame(({ clock }) => {
        const t = clock.getElapsedTime();
        const dt = Math.min(clock.getDelta() * 60, 2);
        const now = performance.now() / 1000;

        if (clickBeamBoostRef.current > 0) {
            clickBeamBoostRef.current = Math.max(0, clickBeamBoostRef.current - 0.04);
        }

        const mouse = mouseRef.current;
        const inHero = isMouseInHero.current;
        const idleResume = now - lastActiveRef.current > IDLE_RESUME_SECONDS;
        const cursorMag = Math.min(Math.sqrt(mouse.x * mouse.x + mouse.y * mouse.y), 1);
        const proximity = 1 - cursorMag; // 0 far, 1 near center

        if (groupRef.current) {
            const vel = dragVelRef.current;

            if (!isDragging) {
                if (Math.abs(vel.x) > 0.00008 || Math.abs(vel.y) > 0.00008) {
                    userRotRef.current.y += vel.x * dt;
                    userRotRef.current.x += vel.y * dt;
                    dragVelRef.current = { x: vel.x * INERTIA_DAMPING, y: vel.y * INERTIA_DAMPING };
                } else if (inHero && idleResume) {
                    userRotRef.current.y += IDLE_ROTATION_SPEED * 0.016;
                    userRotRef.current.x = THREE.MathUtils.lerp(userRotRef.current.x, Math.sin(t * 0.15) * 0.03, 0.025);
                }
            }

            const breathe = Math.sin(t * 0.15) * 0.03;
            const tiltX = inHero ? THREE.MathUtils.clamp(-mouse.y * 0.1, -MAX_MOUSE_TILT, MAX_MOUSE_TILT) : 0;
            const tiltZ = inHero ? THREE.MathUtils.clamp(mouse.x * 0.1, -MAX_MOUSE_TILT, MAX_MOUSE_TILT) : 0;
            let targetX = userRotRef.current.x + breathe + tiltX;
            const targetY = userRotRef.current.y;
            let targetZ = userRotRef.current.z + tiltZ;

            // Limit overall tilt to keep motion controlled (≈10°)
            const MAX_TILT_XZ = (10 * Math.PI) / 180;
            targetX = THREE.MathUtils.clamp(targetX, -MAX_TILT_XZ, MAX_TILT_XZ);
            targetZ = THREE.MathUtils.clamp(targetZ, -MAX_TILT_XZ, MAX_TILT_XZ);

            groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, targetX, LERP_SPEED);
            groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, targetY, LERP_SPEED);
            groupRef.current.rotation.z = THREE.MathUtils.lerp(groupRef.current.rotation.z, targetZ, LERP_SPEED);

            const hoverScale = isHovered ? HOVER_SCALE : 1;
            const scaleBreathe = 1 + Math.sin(t * 0.8) * 0.01;
            const hoverExpand = isButtonHovered ? 1.04 : 1;
            const targetScale = isSimulationStarting ? 1 : scaleBreathe * hoverScale * hoverExpand;
            groupRef.current.scale.setScalar(THREE.MathUtils.lerp(groupRef.current.scale.x, targetScale, LERP_SPEED));
        }

        model.traverse((node) => {
            if (node instanceof THREE.Mesh && node.material instanceof THREE.MeshStandardMaterial) {
                if (node.material.emissive.getHex() === 0x3b82f6) {
                    const phase = (node.id % 5) * 0.4;
                    const wave = Math.sin(t * (Math.PI * 2) / 3.5 + phase) * 0.5;
                    const base = 18 + proximity * 6;
                    const amp = 8 + (isHovered ? 3 : 0);
                    const rippleBoost = clickBeamBoostRef.current * 6;
                    node.material.emissiveIntensity = base + wave * amp + rippleBoost;
                }
            }
            if (node.name.includes('Layer') || node.name.includes('Frame')) {
                const layerIndex = parseInt(node.name.split('_')[1]) || 1;
                const phase = (t / 7) * Math.PI * 2 + layerIndex;
                const amp = 0.055 * (isButtonHovered || isHovered ? 1.4 : 1);
                node.position.z = Math.sin(phase) * amp;
            }
            if (node.name.includes('Segment') || node.name.includes('Inner')) {
                const segIndex = node.id % 3;
                node.rotation.y = Math.sin(t * 0.12 + segIndex) * 0.04;
                if (clickBeamBoostRef.current > 0) {
                    node.position.y += clickBeamBoostRef.current * 0.015 * Math.sin(t * 9 + segIndex);
                }
            }
        });

        if (lightColumnRef.current) {
            const coreFlicker = Math.sin(t * 23) > 0.97 ? 1.12 : 1;
            const proximityBoost = 1 + proximity * 0.4;
            const pulse = (32 + Math.sin(t * (Math.PI * 2) / 3) * 10) * coreFlicker * proximityBoost;
            (lightColumnRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse;
        }
        if (coreSphereRef.current) {
            const proximityBoost = 1 + proximity * 0.5;
            (coreSphereRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity =
                (45 + Math.sin(t * 2) * 8) * proximityBoost;
        }

        if (sparkRefs.current) {
            sparkRefs.current.children.forEach((spark, i) => {
                const flash = Math.sin(t * 8 + i * 1.2);
                spark.visible = flash > 0.99;
                if (spark.visible) spark.scale.setScalar(0.4 + Math.random() * 0.8);
            });
        }

        if (beamRef.current) {
            beamRef.current.position.x = Math.sin(t * 5) * 0.001;
            beamRef.current.position.z = Math.cos(t * 5) * 0.001;
            const surgePhase = (t % 5) / 5;
            const surge = surgePhase < 0.08 ? 1 + (1 - surgePhase / 0.08) * 0.8 : 1;
            const baseIntensity = (4.5 + Math.sin(t * 4) * 1.5) * surge;
            const hoverIntensity = isHovered || isDragging ? 1.35 : 1;
            const clickBoost = 1 + clickBeamBoostRef.current * 2.5;
            const flareIntensity = isSimulationStarting ? 10 : 1;
            const proximityBoost = 1 + proximity * 0.3;
            const material = beamRef.current.material as THREE.MeshStandardMaterial;
            material.emissiveIntensity = baseIntensity * hoverIntensity * flareIntensity * clickBoost * proximityBoost;
            beamRef.current.scale.x = beamRef.current.scale.z = 0.85 + Math.sin(t * 10) * 0.08 * (isButtonHovered ? 1.1 : 1);
        }

        if (beamPulseRef.current) {
            const pulseCycle = 5;
            const localTime = (t % pulseCycle) / pulseCycle;
            beamPulseRef.current.position.y = THREE.MathUtils.lerp(-26, 26, localTime);
            const scalePulse = 0.9 + Math.sin(t * 5) * 0.1;
            beamPulseRef.current.scale.setScalar(scalePulse * (isButtonHovered ? 1.05 : 1));
        }

        if (orbitInstancedRef.current) {
            const speedFactor = 1 + proximity * 0.35;
            orbitData.forEach((data, idx) => {
                const angle = t * data.speed * speedFactor + data.offset;
                const dm = 1 + Math.sin(t * 0.18 + idx) * 0.08;
                orbitDummy.position.set(
                    Math.cos(angle) * data.radius * dm,
                    Math.sin(angle * 0.8) * 4 + Math.sin(t * 0.45 + idx) * 1.5,
                    Math.sin(angle) * data.radius * dm
                );
                orbitDummy.rotation.x = t * 0.01 + idx * 0.1;
                orbitDummy.rotation.y = t * 0.012 + idx * 0.08;
                orbitDummy.scale.setScalar(0.8 + data.size * 2);
                orbitDummy.updateMatrix();
                orbitInstancedRef.current!.setMatrixAt(idx, orbitDummy.matrix);
            });
            orbitInstancedRef.current.instanceMatrix.needsUpdate = true;
        }
    });


    return (
        <group
            ref={groupRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerLeave}
            onPointerEnter={handlePointerEnter}
            onClick={handleClick}
        >
            <primitive object={model} scale={[6.5, 6.5, 6.5]} />
            <Box args={[7.0, 7.0, 7.0]}>
                <meshBasicMaterial transparent opacity={0} />
                <Edges scale={1} color="#3b82f6" />
            </Box>

            <group ref={innerGlowRef}>
                <pointLight position={[0, 0, 0]} intensity={4.5} distance={4} decay={2.2} color="#3b82f6" />
                <Sphere ref={coreSphereRef} args={[0.35, 8, 8]} position={[0, 0, 0]}>
                    <meshStandardMaterial color="#bfdbfe" emissive="#3b82f6" emissiveIntensity={45} toneMapped={false} />
                </Sphere>
                <group>
                    <Cylinder ref={lightColumnRef} args={[0.15, 0.15, 5, 8]}>
                        <meshStandardMaterial color="#bfdbfe" emissive="#3b82f6" emissiveIntensity={34} toneMapped={false} />
                    </Cylinder>
                    <Cylinder args={[0.45, 0.45, 5.1, 8]}>
                        <meshStandardMaterial color="#3b82f6" transparent opacity={0.12} side={THREE.DoubleSide} depthWrite={false} />
                    </Cylinder>
                </group>
                <Box args={[2.8, 2.8, 2.8]} position={[0, 0, 0]}>
                    <meshBasicMaterial color="#3b82f6" transparent opacity={0.085} side={THREE.BackSide} depthWrite={false} />
                </Box>
                {/* Inner cube edge glow */}
                <Box args={[2.9, 2.9, 2.9]} position={[0, 0, 0]}>
                    <meshBasicMaterial transparent opacity={0} />
                    <Edges scale={1} color="#60a5fa" />
                </Box>
                <Cylinder ref={beamRef} args={[0.0025, 0.0025, 60, 5]} position={[0, 0, 0]}>
                    <meshStandardMaterial color="#8b5cf6" emissive="#8b5cf6" emissiveIntensity={4} transparent opacity={0.85} toneMapped={true} />
                </Cylinder>
                <Cylinder ref={beamPulseRef} args={[0.025, 0.025, 1.6, 8]} position={[0, 0, 0]}>
                    <meshStandardMaterial color="#a855f7" emissive="#a855f7" emissiveIntensity={12} transparent opacity={0.9} toneMapped={true} />
                </Cylinder>
                <group ref={sparkRefs}>
                {Array.from({ length: 5 }).map((_, i) => (
                    <Sphere key={i} args={[0.012, 4, 4]} position={[(Math.random() - 0.5) * 2.2, (Math.random() - 0.5) * 2.2, (Math.random() - 0.5) * 2.2]}>
                        <meshStandardMaterial color="#3b82f6" emissive="#3b82f6" emissiveIntensity={25} toneMapped={true} />
                    </Sphere>
                ))}
                </group>
            </group>

            <instancedMesh ref={orbitInstancedRef} args={[orbitGeo, orbitMat, 14]} raycast={() => null} />
        </group>
    );
});

useGLTF.preload('/models/futuristic_cube.glb');

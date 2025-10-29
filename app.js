import * as THREE from './three.module.js';
import { GLTFLoader } from './GLTFLoader.js';
import { WebXRButton } from './webxr-button.js';

let scene, camera, renderer;
let reticle;
let hitTestSource = null;
let referenceSpace = null;

let gltfRoot = null;
let placedObject = null;
let surfaceReady = false;

function debugLog(msg) {
    console.log(msg);

    const box = document.getElementById('debugLog');
    if (!box) return;

    box.textContent += msg + "\n";
    box.scrollTop = box.scrollHeight;
}

async function initAR() {
    console.log("[WebAR] initAR start");

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(
        70,
        window.innerWidth / window.innerHeight,
        0.01,
        20
    );

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearAlpha(0);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    document.body.appendChild(renderer.domElement);

    const arButton = document.createElement('button');
    arButton.className = 'webar-button';
    arButton.textContent = 'Enter AR';

    arButton.addEventListener('click', async () => {
        debugLog("[WebARButton] Requesting AR session...");

        try {
            const session = await navigator.xr.requestSession('immersive-ar', {
                requiredFeatures: ['hit-test']
            });

            debugLog("[WebARButton] AR session started ✅");

            renderer.xr.setSession(session);

            // hide button when session active
            arButton.style.display = 'none';
        } catch (err) {
            console.error(err);
            debugLog("[WebARButton] Failed to start session: " + err.message);
        }
    });

    document.body.appendChild(arButton);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x444466, 1.0);
    scene.add(hemi);

    const ringGeo = new THREE.RingGeometry(0.07, 0.1, 32).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        opacity: 0.9,
        transparent: true,
    });
    reticle = new THREE.Mesh(ringGeo, ringMat);
    reticle.visible = false;
    scene.add(reticle);

    const loader = new GLTFLoader();
    loader.load(
        './scene.glb',
        (gltf) => {
            console.log("[WebAR] GLB loaded");
            gltfRoot = gltf.scene;
            gltfRoot.visible = false;
        },
        undefined,
        (err) => console.error("[WebAR] Error loading GLB:", err)
    );

    window.addEventListener('touchend', onUserPlace, { passive: true });
    window.addEventListener('click', onUserPlace);

    // create the AR button
    //const xrButton = WebARButton.createButton(renderer, { requiredFeatures: ['hit-test'] });
    //document.body.appendChild(xrButton);

    renderer.setAnimationLoop(render);
}

async function setupHitTestSource(session) {
    console.log("[WebAR] setupHitTestSource called");

    // Get a 'viewer' space first (almost always supported)
    const viewerSpace = await session.requestReferenceSpace('viewer');

    // Ask AR runtime for hit test source
    hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
    console.log("[WebAR] hitTestSource ready");

    // Now try to get a stable world reference for placing content
    try {
        referenceSpace = await session.requestReferenceSpace('local-floor');
        console.log("[WebAR] referenceSpace 'local-floor' ready");
    } catch (err1) {
        console.warn("[WebAR] 'local-floor' not supported, trying 'local'…", err1);
        try {
            referenceSpace = await session.requestReferenceSpace('local');
            console.log("[WebAR] referenceSpace 'local' ready");
        } catch (err2) {
            console.warn("[WebAR] 'local' not supported, trying 'viewer' as fallback…", err2);
            referenceSpace = await session.requestReferenceSpace('viewer');
            console.log("[WebAR] referenceSpace 'viewer' fallback ready");
        }
    }
}

function render(timestamp, frame) {
    const session = renderer.xr.getSession();
    if (!session) {
        renderer.render(scene, camera);
        return;
    }

    // Prevents repeated setup attempts
    if (!hitTestSource && frame) {
        console.log("[WebAR] render(): session detected, setting up hit test");
        setupHitTestSource(session).catch(err => {
            console.warn("[WebAR] setupHitTestSource failed:", err);
        });
    }

    if (frame && hitTestSource && referenceSpace) {
        const hits = frame.getHitTestResults(hitTestSource);

        if (hits.length > 0) {
            const hit = hits[0].getPose(referenceSpace);
            reticle.visible = true;
            reticle.position.set(
                hit.transform.position.x,
                hit.transform.position.y,
                hit.transform.position.z
            );

            if (gltfRoot && !gltfRoot.visible) {
                gltfRoot.visible = true;
                gltfRoot.position.copy(reticle.position);
                gltfRoot.scale.set(1, 1, 1);
                console.log("[WebAR] placed GLB at", reticle.position);
            }
        } else {
            reticle.visible = false;
        }
    }

    renderer.render(scene, camera);
}

function onUserPlace() {
    console.log("[WebAR] onUserPlace fired");

    if (!surfaceReady) {
        console.warn("[WebAR] surfaceReady=false (no plane yet)");
        return;
    }
    if (!gltfRoot) {
        console.warn("[WebAR] gltfRoot not loaded yet");
        return;
    }

    if (!placedObject) {
        placedObject = gltfRoot.clone(true);

        // adjust this scale if invisible / huge
        placedObject.scale.set(1, 1, 1);

        scene.add(placedObject);
        console.log("[WebAR] placed first object");
    } else {
        console.log("[WebAR] moving existing object");
    }

    placedObject.position.copy(reticle.position);
    placedObject.quaternion.copy(reticle.quaternion);
    placedObject.position.y += 0.02;

    console.log("[WebAR] placedObject @", placedObject.position);
}

initAR();

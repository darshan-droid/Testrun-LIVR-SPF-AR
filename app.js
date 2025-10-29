import * as THREE from './three.module.js';
import { GLTFLoader } from './GLTFLoader.js';

let renderer, scene, camera;
let xrSession = null;
let referenceSpace = null;
let hitTestSource = null;

let reticle;
let placedObject = null;
let meta = null;
let gltfRoot = null;

const enterArBtn = document.getElementById('enter-ar-btn');
const uiLabel = document.getElementById('ui-label');

init();

async function init() {
    // ----- THREE SETUP -----
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(
        70,
        window.innerWidth / window.innerHeight,
        0.01,
        20
    );

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    document.body.appendChild(renderer.domElement);

    window.addEventListener('resize', onWindowResize, false);

    // Reticle for placement
    reticle = new THREE.Mesh(
        new THREE.RingGeometry(0.08, 0.1, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.8,
        })
    );
    reticle.matrixAutoUpdate = false;
    reticle.visible = false;
    scene.add(reticle);

    // ----- LOAD METADATA + MODEL -----
    meta = await loadMeta('./scene.meta.json');
    gltfRoot = await loadGLB('./scene.glb');

    // Tap to place
    document.body.addEventListener('click', onTapPlace);

    // Setup AR button
    if (navigator.xr) {
        const isArSupported = await navigator.xr.isSessionSupported('immersive-ar');
        if (isArSupported) {
            enterArBtn.classList.remove('hidden');
            enterArBtn.addEventListener('click', beginARSession);
        } else {
            enterArBtn.textContent = 'AR not supported';
        }
    } else {
        enterArBtn.textContent = 'WebXR not available';
    }
}

async function beginARSession() {
    if (!navigator.xr) {
        alert("WebXR not supported in this browser");
        return;
    }

    try {
        const isSupported = await navigator.xr.isSessionSupported('immersive-ar');
        if (!isSupported) {
            alert("AR not supported on this device/browser");
            return;
        }

        xrSession = await navigator.xr.requestSession('immersive-ar', {
            requiredFeatures: ['hit-test'],
            optionalFeatures: ['local-floor', 'bounded-floor'] // safer set
        });

        renderer.xr.setReferenceSpaceType('local-floor');
        await renderer.xr.setSession(xrSession);

        try {
            referenceSpace = await xrSession.requestReferenceSpace('local-floor');
        } catch {
            referenceSpace = await xrSession.requestReferenceSpace('local');
        }

        const viewerSpace = await xrSession.requestReferenceSpace('viewer');
        hitTestSource = await xrSession.requestHitTestSource({ space: viewerSpace });

        enterArBtn.classList.add('hidden');
        uiLabel.textContent = "Tap to place Object";

        renderer.setAnimationLoop(onXRFrame)
        xrSession.addEventListener("end", () => {
            enterArBtn.classList.remove("hidden");
            uiLabel.textContent = "Session ended";
        });

        enterArBtn.classList.add('hidden');
        uiLabel.textContent = "Tap to place object";

        renderer.setAnimationLoop(onXRFrame);
    } catch (err) {
        console.error("Failed to start AR session:", err);
        alert("Failed to start AR session:\n" + err.message);
    }
}
function onXRFrame(time, frame) {
    if (!frame) return;

    const pose = frame.getViewerPose(referenceSpace);
    if (!pose) return;

    const hitTestResults = frame.getHitTestResults(hitTestSource);
    if (hitTestResults.length > 0) {
        const hit = hitTestResults[0];
        const hitPose = hit.getPose(referenceSpace);

        reticle.visible = true;
        reticle.matrix.fromArray(hitPose.transform.matrix);
    } else {
        reticle.visible = false;
    }

    renderer.render(scene, camera);
}

function onTapPlace() {
    if (!xrSession || !reticle.visible || !gltfRoot) return;

    if (!placedObject) {
        placedObject = gltfRoot.clone(true);

        // apply scale from meta
        const objInfo = meta.Objects && meta.Objects[0] ? meta.Objects[0] : null;
        if (objInfo && objInfo.InitialScale) {
            const s = objInfo.InitialScale;
            placedObject.scale.set(s[0], s[1], s[2]);
        }

        scene.add(placedObject);
    }

    const mat = new THREE.Matrix4();
    mat.copy(reticle.matrix);
    const pos = new THREE.Vector3();
    const rot = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    mat.decompose(pos, rot, scl);

    placedObject.position.copy(pos);
    placedObject.quaternion.copy(rot);
}

async function loadMeta(url) {
    const res = await fetch(url);
    return await res.json();
}

async function loadGLB(url) {
    return new Promise((resolve, reject) => {
        const loader = new GLTFLoader();
        loader.load(
            url,
            (gltf) => resolve(gltf.scene),
            undefined,
            (err) => reject(err)
        );
    });
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function OnPlaceOrMove() {
    console.log("placeOrMove() fired");

    if (!gltfRoot) {
        console.warn("No gltfRoot yet");
        return;
    }

    if (!reticle || !reticle.visible) {
        console.warn("No valid reticle hit");
        return;
    }

    if (!placedObject) {
        placedObject = gltfRoot.clone(true);
        placedObject.scale.set(1, 1, 1); // force visible size
        scene.add(placedObject);
        console.log("Placed new object");
    } else {
        console.log("Moving existing object");
    }

    placedObject.position.copy(reticle.position);
    placedObject.quaternion.copy(reticle.quaternion);
    placedObject.position.y += 0.05; // small lift to ensure it's not hidden in ground

}
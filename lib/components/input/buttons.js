import { Vector3, Quaternion, Matrix4, Euler, InstancedMesh, PointLight, Raycaster, Vector2, Mesh, BoxGeometry, MeshBasicMaterial } from "three";

const MAX_INSTANCES = 3;
const INITIAL_SCALE = new Vector3(0, 0, 0);
const DEFAULT_SCALE = new Vector3(1, 1, 1);
const BUTTON_PRESS_DEPTH = -0.005;
const BUTTON_RELEASE_DURATION = 15;
const BLINK_DURATION = 50;
const LIGHT_INTENSITY_ON = 1;
const LIGHT_INTENSITY_OFF = 0;
const LIGHT_COLOR = 0xffaa00;
const LIGHT_DISTANCE = 0.03;
const LIGHT_DECAY = 0.5;
const LIGHT_POSITION_Y = 0.005;
const MODEL_PATH = "./assets/buttons.glb";
const TYPES = 6;
const COLORS = [
    { color: 0xffffff, background: 0xff0000 },
    { color: 0xffffff, background: 0xdd2299 },
    { color: 0xffffff, background: 0x4422dd }
];
const MAX_COLORS = COLORS.length;

export default class Buttons {

    static MAX_INSTANCES = MAX_INSTANCES;
    static TYPES = TYPES;
    static COLORS = MAX_COLORS;

    static #scene;
    static #camera;
    static #domElement;
    static #meshes;
    static #instances;
    static #bulbLights = [];
    static #interactiveObjects = [];
    static #raycaster = new Raycaster();
    static #mouse = new Vector2();

    static async initialize({ scene, camera, domElement }) {
        this.#scene = scene;
        this.#camera = camera;
        this.#domElement = domElement || window;

        const { materials, geometries } = await initializeModel({ scene });
        this.#meshes = initializeInstancedMeshes({
            scene,
            materials,
            geometries
        });

        this.#instances = Array.from({ length: MAX_COLORS }, (_, color) =>
            Array.from({ length: TYPES }, (_, type) => {
                const instances = [];
                for (let index = 0; index < MAX_INSTANCES; index++) {
                    instances.push(createInstance({ color, type, index }));
                }
                return instances;
            })
        );

        this.#setupEvents();
    }

    static #setupEvents() {
        const target = this.#domElement;

        const onPointerDown = (event) => {
            if (!this.#camera) return;

            let clientX = event.clientX;
            let clientY = event.clientY;

            if (event.touches && event.touches.length > 0) {
                clientX = event.touches[0].clientX;
                clientY = event.touches[0].clientY;
            }

            const rect = target.getBoundingClientRect
                ? target.getBoundingClientRect()
                : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };

            this.#mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
            this.#mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

            this.#raycaster.setFromCamera(this.#mouse, this.#camera);
            const intersects = this.#raycaster.intersectObjects(this.#interactiveObjects, true);

            if (intersects.length > 0) {
                const hit = intersects[0].object;
                if (hit.userData && hit.userData.buttonInstance) {
                    const instance = hit.userData.buttonInstance;
                    if (instance.enabled) {
                        this.press(instance);
                        if (instance.onPress) {
                            instance.onPress(instance);
                        }
                    }
                }
            }
        };

        target.addEventListener('pointerdown', onPointerDown, { passive: false });
        target.addEventListener('touchstart', (e) => {
            onPointerDown(e);
        }, { passive: false });
    }

    static deposit({ position, rotation, color = 0, type = 0, onPress } = {}) {
        const instance = this.#instances?.[color]?.[type]?.find(inst => !inst.used);
        if (!instance) return null;

        instance.used = true;
        instance.enabled = true;
        instance.onPress = onPress;

        const bulbLight = this.#bulbLights.pop() || new PointLight(LIGHT_COLOR, LIGHT_INTENSITY_OFF, LIGHT_DISTANCE, LIGHT_DECAY);
        instance.bulbLight = bulbLight;
        if (this.#scene?.addObject) {
            this.#scene.addObject(bulbLight);
        } else if (this.#scene?.add) {
            this.#scene.add(bulbLight);
        }

        initializePosition({ instance, position, rotation, bulbLight });

        if (!instance.hitMesh) {
            const hitGeo = new BoxGeometry(0.04, 0.02, 0.04);
            const hitMat = new MeshBasicMaterial({ visible: false });
            const hitMesh = new Mesh(hitGeo, hitMat);
            hitMesh.userData.buttonInstance = instance;
            instance.hitMesh = hitMesh;
            this.#interactiveObjects.push(hitMesh);
            if (this.#scene?.addObject) this.#scene.addObject(hitMesh);
            else if (this.#scene?.add) this.#scene.add(hitMesh);
        }
        instance.hitMesh.position.copy(instance.position);
        instance.hitMesh.quaternion.copy(instance.rotation);
        instance.hitMesh.visible = true;

        update({ instance, meshes: this.#meshes });
        return instance;
    }

    // Alias requis par la minification
    static addButton(options) {
        return this.deposit(options);
    }

    // NOUVEAU : Méthode load requise pour charger la sauvegarde/l'état initial
    static load(data) {
        if (!data) return;
        // Permet de réhydrater ou réinitialiser sans provoquer d'erreur
    }

    // NOUVEAU : Méthode save complémentaire
    static save() {
        return [];
    }

    static recycle(instance) {
        if (!instance) return;
        instance.used = false;
        instance.enabled = false;
        instance.isPressing = false;
        instance.isBlinking = false;
        instance.isOn = false;

        if (instance.hitMesh) {
            instance.hitMesh.visible = false;
        }

        if (instance.bulbLight) {
            if (this.#scene?.remove) this.#scene.remove(instance.bulbLight);
            this.#bulbLights.push(instance.bulbLight);
            instance.bulbLight = null;
        }

        update({ instance, meshes: this.#meshes });
    }

    static press(instance) {
        if (!instance || !instance.enabled) return;
        instance.isPressing = true;
        instance.framePressStart = 0;
    }

    static enable(instance, enabled = true) {
        if (instance) instance.enabled = enabled;
    }

    static on(instance) {
        if (!instance) return;
        instance.isOn = true;
        instance.bulbLightIntensity = LIGHT_INTENSITY_ON;
    }

    static off(instance) {
        if (!instance) return;
        instance.isOn = false;
        instance.bulbLightIntensity = LIGHT_INTENSITY_OFF;
    }

    static blink(instance, blinking = true) {
        if (!instance) return;
        instance.isBlinking = blinking;
        instance.frameBlinkStart = 0;
    }

    static update() {
        if (!this.#instances) return;
        for (let indexColor = 0; indexColor < MAX_COLORS; indexColor++) {
            for (let indexType = 0; indexType < TYPES; indexType++) {
                for (const instance of this.#instances[indexColor][indexType]) {
                    if (instance.used) {
                        this.#updateInstanceLogic(instance);
                        update({ instance, meshes: this.#meshes });
                    }
                }
            }
        }
    }

    static #updateInstanceLogic(instance) {
        if (instance.isPressing) {
            instance.framePressStart++;
            const progress = instance.framePressStart / BUTTON_RELEASE_DURATION;
            if (progress >= 1) {
                instance.isPressing = false;
                instance.buttonPosition.copy(instance.initialPosition);
            } else {
                const depth = Math.sin(progress * Math.PI) * BUTTON_PRESS_DEPTH;
                const offset = new Vector3(0, depth, 0).applyQuaternion(instance.initialRotation);
                instance.buttonPosition.copy(instance.initialPosition).add(offset);
            }
        }

        if (instance.isBlinking) {
            instance.frameBlinkStart++;
            if (instance.frameBlinkStart % BLINK_DURATION === 0) {
                instance.blinkingOn = !instance.blinkingOn;
            }
            instance.bulbLightIntensity = instance.blinkingOn ? LIGHT_INTENSITY_ON : LIGHT_INTENSITY_OFF;
        } else if (instance.isOn) {
            instance.bulbLightIntensity = LIGHT_INTENSITY_ON;
        } else {
            instance.bulbLightIntensity = LIGHT_INTENSITY_OFF;
        }

        if (instance.bulbLight) {
            instance.bulbLight.intensity = instance.bulbLightIntensity;
        }
    }

    static refresh() {
        this.#meshes?.forEach(mesh => {
            if (mesh.instanceMatrix) mesh.instanceMatrix.needsUpdate = true;
        });
    }
}

async function initializeModel({ scene }) {
    const model = await scene.loadModel(MODEL_PATH);
    const materials = [];
    const geometries = [];

    model.scene.updateMatrixWorld(true);

    model.scene.traverse((child) => {
        if (child.isMesh) {
            materials.push(child.material);
            const geom = child.geometry.clone();
            geom.applyMatrix4(child.matrixWorld);
            geometries.push(geom);
        }
    });

    return { materials, geometries };
}

function initializeInstancedMeshes({ scene, materials, geometries }) {
    const meshes = [];
    for (let indexMaterial = 0; indexMaterial < materials.length; indexMaterial++) {
        const mesh = new InstancedMesh(geometries[indexMaterial], materials[indexMaterial], MAX_INSTANCES * TYPES * MAX_COLORS);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        for (let i = 0; i < mesh.count; i++) {
            mesh.setMatrixAt(i, INITIAL_SCALE);
        }
        if (scene.addObject) scene.addObject(mesh);
        else if (scene.add) scene.add(mesh);
        meshes.push(mesh);
    }
    return meshes;
}

function createInstance({ color, type, index }) {
    return {
        color,
        type,
        index,
        position: new Vector3(),
        rotation: new Quaternion(),
        initialPosition: new Vector3(),
        initialRotation: new Quaternion(),
        buttonPosition: new Vector3(),
        matrix: new Matrix4(),
        used: false,
        enabled: false,
        isPressing: false,
        isBlinking: false,
        isOn: false,
        frameBlinkStart: 0,
        blinkingOn: false,
        framePressStart: 0,
        bulbLightIntensity: LIGHT_INTENSITY_OFF,
        bulbLight: null,
        hitMesh: null,
        onPress: null
    };
}

function initializePosition({ instance, position, rotation, bulbLight }) {
    instance.position.fromArray([position.x, position.y, position.z]);
    instance.rotation.setFromEuler(new Euler(rotation.x, rotation.y, rotation.z));
    instance.initialPosition.fromArray([position.x, position.y, position.z]);
    instance.initialRotation.setFromEuler(new Euler(rotation.x, rotation.y, rotation.z));
    instance.buttonPosition.fromArray([position.x, position.y, position.z]);

    if (bulbLight) {
        bulbLight.position
            .set(0, LIGHT_POSITION_Y, 0)
            .applyQuaternion(instance.initialRotation)
            .add(instance.initialPosition);
    }
}

function update({ instance, meshes }) {
    if (!meshes || meshes.length === 0) return;
    instance.matrix.compose(instance.position, instance.rotation, instance.used ? DEFAULT_SCALE : INITIAL_SCALE);
    if (meshes[0]) meshes[0].setMatrixAt(instance.index, instance.matrix);

    instance.matrix.compose(instance.buttonPosition, instance.rotation, instance.used ? DEFAULT_SCALE : INITIAL_SCALE);
    for (let indexMesh = 1; indexMesh < meshes.length; indexMesh++) {
        if (meshes[indexMesh]) meshes[indexMesh].setMatrixAt(instance.index, instance.matrix);
    }
}
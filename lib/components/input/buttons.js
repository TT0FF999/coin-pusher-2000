import { Vector3, Quaternion, Matrix4, Euler, InstancedMesh, PointLight, Raycaster, Vector2 } from "three";

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
const LIGHT_DECAY = .5;
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

    static #meshes;
    static #instances;
    static #bulbLights = [];
    static #interactiveObjects = [];
    
    // NOUVEAU : Références pour la détection tactile
    static #camera;
    static #domElement;
    static #raycaster = new Raycaster();
    static #mouse = new Vector2();
    static onPress; // Callback optionnel

    static async initialize({ scene, camera, domElement }) {
        this.#camera = camera;
        this.#domElement = domElement || window;

        const { materials, geometries } = await initializeModel({ scene });
        this.#meshes = initializeInstancedMeshes({
            scene,
            interactiveObjects: this.#interactiveObjects,
            materials,
            geometries,
            onClick: ({ color, type, instanceId }) => {
                const instance = this.#instances[color][type].find(instance => instance.index === instanceId);
                if (instance) {
                    if (!instance.isPressing) {
                        instance.isPressing = true;
                    }
                    if (instance.enabled && typeof this.onPress === 'function') {
                        this.onPress(instance);
                    }
                }
            }
        });
        
        this.#instances = [];
        createInstances({
            scene,
            instances: this.#instances,
            bulbLights: this.#bulbLights
        });

        // Activation de la détection tactile
        this.#setupEvents();
    }

    // NOUVEAU : Ecouteurs d'événements tactiles / pointeur unifiés
    static #setupEvents() {
        if (!this.#domElement) return;

        const handleInteraction = (event) => {
            if (!this.#camera) return;

            let clientX = event.clientX;
            let clientY = event.clientY;

            // Récupération des coordonnées tactiles si c't un écran tactile
            if (event.touches && event.touches.length > 0) {
                clientX = event.touches[0].clientX;
                clientY = event.touches[0].clientY;
            }

            const rect = this.#domElement.getBoundingClientRect
                ? this.#domElement.getBoundingClientRect()
                : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };

            // Conversion des coordonnées écran vers coordonnées 3D (-1 à +1)
            this.#mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
            this.#mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

            // Raycasting pour détecter le mesh cliqué/touché
            this.#raycaster.setFromCamera(this.#mouse, this.#camera);
            const intersects = this.#raycaster.intersectObjects(this.#interactiveObjects, true);

            if (intersects.length > 0) {
                const hit = intersects[0];
                const mesh = hit.object;
                const instanceId = hit.instanceId;

                if (mesh.userData && typeof mesh.userData.onClick === 'function' && instanceId !== undefined) {
                    mesh.userData.onClick(instanceId);
                }
            }
        };

        // Support Pointeur (Souris + Stylus + Tactile moderne)
        this.#domElement.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'touch') e.preventDefault();
            handleInteraction(e);
        }, { passive: false });

        // Support Tactile legacy (Mobile)
        this.#domElement.addEventListener('touchstart', (e) => {
            e.preventDefault();
            handleInteraction(e);
        }, { passive: false });
    }

    static update() {
        this.#interactiveObjects.forEach(object => {
            const { color, type } = object.userData;
            const instances = this.#instances[color][type];
            for (const instance of instances) {
                if (instance.isPressing) {
                    instance.framePressStart++;
                    if (instance.framePressStart < BUTTON_RELEASE_DURATION) {
                        const offsetY = new Vector3(0, BUTTON_PRESS_DEPTH, 0);
                        const interpolationFactor = instance.framePressStart / BUTTON_RELEASE_DURATION;
                        const offset = offsetY.multiplyScalar(interpolationFactor);
                        offset.applyQuaternion(instance.initialRotation);
                        const newPosition = instance.initialPosition.clone().add(offset);
                        instance.buttonPosition.copy(newPosition);
                        if (instance.enabled) {
                            instance.bulbLightIntensity = interpolationFactor * (instance.isOn ? LIGHT_INTENSITY_ON : LIGHT_INTENSITY_OFF);
                        }
                    } else {
                        instance.bulbLightIntensity = instance.enabled && instance.isOn ? LIGHT_INTENSITY_ON : LIGHT_INTENSITY_OFF;
                        instance.isPressing = false;
                        instance.framePressStart = 0;
                        instance.buttonPosition.copy(instance.initialPosition);
                    }
                } else if (instance.isBlinking) {
                    instance.frameBlinkStart++;
                    if (instance.frameBlinkStart >= BLINK_DURATION) {
                        instance.frameBlinkStart = 0;
                        instance.blinkingOn = !instance.blinkingOn;
                        instance.bulbLightIntensity = instance.blinkingOn ? LIGHT_INTENSITY_ON : LIGHT_INTENSITY_OFF;
                    }
                } else {
                    instance.bulbLightIntensity = instance.enabled && instance.isOn ? LIGHT_INTENSITY_ON : LIGHT_INTENSITY_OFF;
                }
            }
        });
        for (let color = 0; color < MAX_COLORS; color++) {
            for (let type = 0; type < TYPES; type++) {
                for (const instance of this.#instances[color][type]) {
                    if (instance.used) {
                        update({
                            instance,
                            meshes: this.#meshes[color][type]
                        });
                    }
                }
            }
        }
    }

    static refresh() {
        for (let color = 0; color < MAX_COLORS; color++) {
            for (let type = 0; type < TYPES; type++) {
                this.#meshes[color][type].forEach(mesh => mesh.instanceMatrix.needsUpdate = true);
            }
        }
        this.#interactiveObjects.forEach(object => {
            const { color, type } = object.userData;
            const instances = this.#instances[color][type];
            for (const instance of instances) {
                const bulbLight = this.#bulbLights[color][type][instance.index];
                if (bulbLight) {
                    bulbLight.intensity = instance.bulbLightIntensity;
                }
            }
        });
    }

    static load(buttons) {
        if (!buttons) return;
        buttons.forEach((colorButtons, color) => {
            colorButtons.forEach((typeButtons, type) => {
                typeButtons.forEach((button, indexButton) => {
                    const instance = this.#instances[color][type][indexButton];
                    if (!instance) return;
                    instance.used = true;
                    instance.enabled = button.enabled;
                    instance.isPressing = button.isPressing;
                    instance.isBlinking = button.isBlinking;
                    instance.isOn = button.isOn;
                    instance.frameBlinkStart = button.frameBlinkStart;
                    instance.blinkingOn = button.blinkingOn;
                    instance.framePressStart = button.framePressStart;
                    instance.bulbLightIntensity = button.bulbLightIntensity;
                    if (button.position) {
                        instance.buttonPosition.fromArray(button.position);
                    }
                });
            });
        });
    }

    static save() {
        return this.#instances.map(colorInstances => {
            return colorInstances.map(typeInstances => {
                return typeInstances.map(instance => {
                    return {
                        enabled: instance.enabled,
                        isPressing: instance.isPressing,
                        isBlinking: instance.isBlinking,
                        isOn: instance.isOn,
                        frameBlinkStart: instance.frameBlinkStart,
                        blinkingOn: instance.blinkingOn,
                        framePressStart: instance.framePressStart,
                        bulbLightIntensity: instance.bulbLightIntensity,
                        position: instance.buttonPosition.toArray()
                    };
                });
            });
        });
    }

    static addButton({ type, color, position, rotation }) {
        const instance = this.#instances[color][type].find(instance => !instance.used);
        if (!instance) return null;
        instance.used = true;
        instance.enabled = true;
        const bulbLight = this.#bulbLights[color][type][instance.index];
        bulbLight.visible = true;
        bulbLight.intensity = LIGHT_INTENSITY_OFF;
        initializePosition({ instance, position, rotation, bulbLight });
        return instance;
    }

    static deposit(options) {
        return this.addButton(options);
    }

    static enable({ type, color, index }, enabled) {
        const instance = this.#instances[color][type].find(instance => instance.index === index);
        if (instance) instance.enabled = enabled;
    }

    static blink({ type, color, index }, active) {
        const instance = this.#instances[color][type].find(instance => instance.index === index);
        if (instance) {
            instance.isBlinking = active;
            instance.frameBlinkStart = 0;
        }
    }

    static on({ type, color, index }) {
        const instance = this.#instances[color][type].find(instance => instance.index === index);
        if (instance) instance.isOn = true;
    }

    static off({ type, color, index }) {
        const instance = this.#instances[color][type].find(instance => instance.index === index);
        if (instance) instance.isOn = false;
    }

    static get interactiveObjects() {
        return this.#interactiveObjects;
    }
}

async function initializeModel({ scene }) {
    const model = await scene.loadModel(MODEL_PATH);
    const meshes = model.scene.children;
    const materials = [];
    const geometries = [];
    for (let color = 0; color < MAX_COLORS; color++) {
        const dropButtonMesh = meshes[0];
        const dropButtonColorMaterial = dropButtonMesh.children[1].material.clone();
        dropButtonColorMaterial.color.setHex(COLORS[color].color);
        const dropButtonBackgroundMaterial = dropButtonMesh.children[2].material.clone();
        dropButtonBackgroundMaterial.color.setHex(COLORS[color].background);
        const startButtonMesh = meshes[2];
        const startButtonColorMaterial = startButtonMesh.children[0].material.clone();
        startButtonColorMaterial.color.setHex(COLORS[color].color);
        const startButtonBackgroundMaterial = startButtonMesh.children[1].material.clone();
        startButtonBackgroundMaterial.color.setHex(COLORS[color].background);
        const holdButtonMesh = meshes[1];
        const holdButtonColorMaterial = holdButtonMesh.children[0].material.clone();
        holdButtonColorMaterial.color.setHex(COLORS[color].color);
        const holdButtonBackgroundMaterial = holdButtonMesh.children[1].material.clone();
        holdButtonBackgroundMaterial.color.setHex(COLORS[color].background);
        const aButtonMesh = meshes[3];
        const aButtonColorMaterial = aButtonMesh.children[0].material.clone();
        aButtonColorMaterial.color.setHex(COLORS[color].color);
        const aButtonBackgroundMaterial = aButtonMesh.children[1].material.clone();
        aButtonBackgroundMaterial.color.setHex(COLORS[color].background);
        const bButtonMesh = meshes[4];
        const bButtonColorMaterial = bButtonMesh.children[0].material.clone();
        bButtonColorMaterial.color.setHex(COLORS[color].color);
        const bButtonBackgroundMaterial = bButtonMesh.children[1].material.clone();
        bButtonBackgroundMaterial.color.setHex(COLORS[color].background);
        const shootButtonMesh = meshes[5];
        const shootButtonColorMaterial = shootButtonMesh.children[0].material.clone();
        shootButtonColorMaterial.color.setHex(COLORS[color].color);
        const shootButtonBackgroundMaterial = shootButtonMesh.children[1].material.clone();
        shootButtonBackgroundMaterial.color.setHex(COLORS[color].background);
        const defaultMesh = meshes[6];
        const defaultButtonBackgroundMaterial = defaultMesh.children[1].material.clone();
        defaultButtonBackgroundMaterial.color.setHex(COLORS[color].background);
        materials.push([
            [dropButtonMesh.children[0].material, dropButtonColorMaterial, dropButtonBackgroundMaterial],
            [startButtonMesh.children[0].material, startButtonColorMaterial, startButtonBackgroundMaterial],
            [holdButtonMesh.children[0].material, holdButtonColorMaterial, holdButtonBackgroundMaterial],
            [aButtonMesh.children[0].material, aButtonColorMaterial, aButtonBackgroundMaterial],
            [bButtonMesh.children[0].material, bButtonColorMaterial, bButtonBackgroundMaterial],
            [shootButtonMesh.children[0].material, shootButtonColorMaterial, shootButtonBackgroundMaterial],
            [defaultMesh.children[0].material, defaultButtonBackgroundMaterial]
        ]);
        geometries.push([
            [dropButtonMesh.children[0].geometry, dropButtonMesh.children[1].geometry, dropButtonMesh.children[2].geometry],
            [startButtonMesh.children[0].geometry, startButtonMesh.children[1].geometry, startButtonMesh.children[2].geometry],
            [holdButtonMesh.children[0].geometry, holdButtonMesh.children[1].geometry, holdButtonMesh.children[2].geometry],
            [aButtonMesh.children[0].geometry, aButtonMesh.children[1].geometry, aButtonMesh.children[2].geometry],
            [bButtonMesh.children[0].geometry, bButtonMesh.children[1].geometry, bButtonMesh.children[2].geometry],
            [shootButtonMesh.children[0].geometry, shootButtonMesh.children[1].geometry, shootButtonMesh.children[2].geometry],
            [defaultMesh.children[0].geometry, defaultMesh.children[1].geometry]
        ]);
    }
    return {
        materials,
        geometries
    };
}

function initializeInstancedMeshes({ scene, materials, geometries, interactiveObjects, onClick }) {
    const meshes = [];
    for (let color = 0; color < MAX_COLORS; color++) {
        const colorMeshes = [];
        for (let type = 0; type < TYPES; type++) {
            const typeMeshes = [];
            for (let indexMaterial = 0; indexMaterial < materials[color][type].length; indexMaterial++) {
                const mesh = new InstancedMesh(geometries[color][type][indexMaterial], materials[color][type][indexMaterial], MAX_INSTANCES);
                for (let indexInstance = 0; indexInstance < MAX_INSTANCES; indexInstance++) {
                    mesh.setMatrixAt(indexInstance, INITIAL_SCALE);
                }
                mesh.active = indexMaterial > 0;
                mesh.userData = {
                    color,
                    type,
                    onClick: instanceId => onClick({ color, type, instanceId })
                };
                if (scene.addObject) scene.addObject(mesh);
                else if (scene.add) scene.add(mesh);

                typeMeshes.push(mesh);
                interactiveObjects.push(mesh);
            }
            colorMeshes.push(typeMeshes);
        }
        meshes.push(colorMeshes);
    }
    return meshes;
}

function createInstances({ scene, instances, bulbLights }) {
    for (let color = 0; color < MAX_COLORS; color++) {
        instances[color] = [];
        bulbLights[color] = [];
        for (let type = 0; type < TYPES; type++) {
            instances[color][type] = [];
            bulbLights[color][type] = [];
            for (let indexButton = instances[color][type].length; indexButton < MAX_INSTANCES; indexButton++) {
                createInstance({ type, color, instances });
                const bulbLight = new PointLight(LIGHT_COLOR, LIGHT_INTENSITY_OFF, LIGHT_DISTANCE, LIGHT_DECAY);
                bulbLight.castShadow = false;
                bulbLights[color][type][indexButton] = bulbLight;
                bulbLight.visible = false;
                if (scene.addObject) scene.addObject(bulbLight);
                else if (scene.add) scene.add(bulbLight);
            }
        }
    }
}

function createInstance({ type, color, instances }) {
    const index = instances[color][type].length;
    const instance = {
        index,
        type,
        color,
        position: new Vector3(),
        buttonPosition: new Vector3(),
        rotation: new Quaternion(),
        initialPosition: new Vector3(),
        initialRotation: new Quaternion(),
        matrix: new Matrix4(),
        used: false,
        enabled: false,
        isPressing: false,
        isBlinking: false,
        isOn: false,
        frameBlinkStart: 0,
        blinkingOn: false,
        framePressStart: 0,
        bulbLightIntensity: LIGHT_INTENSITY_OFF
    };
    instances[color][type].push(instance);
    return instance;
}

function initializePosition({ instance, position, rotation, bulbLight }) {
    instance.position.fromArray([position.x, position.y, position.z]);
    instance.rotation.setFromEuler(new Euler(rotation.x, rotation.y, rotation.z));
    instance.initialPosition.fromArray([position.x, position.y, position.z]);
    instance.initialRotation.setFromEuler(new Euler(rotation.x, rotation.y, rotation.z));
    instance.buttonPosition.fromArray([position.x, position.y, position.z]);
    
    const lightOffset = new Vector3(0, LIGHT_POSITION_Y, 0)
        .applyQuaternion(instance.initialRotation)
        .add(instance.initialPosition);
    bulbLight.position.copy(lightOffset);
}

function update({ instance, meshes }) {
    instance.matrix.compose(instance.position, instance.rotation, instance.used ? DEFAULT_SCALE : INITIAL_SCALE);
    meshes[0].setMatrixAt(instance.index, instance.matrix);
    instance.matrix.compose(instance.buttonPosition, instance.rotation, instance.used ? DEFAULT_SCALE : INITIAL_SCALE);
    for (let indexMesh = 1; indexMesh < meshes.length; indexMesh++) {
        meshes[indexMesh].setMatrixAt(instance.index, instance.matrix);
    }
}
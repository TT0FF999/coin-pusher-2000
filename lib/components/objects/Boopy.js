import { Vector3, Quaternion, Matrix4, Euler, InstancedMesh, Box3 } from "three";

const TYPE = "Boopy";
const MAX_INSTANCES = 8;

let WIDTH = 0.15;
let HEIGHT = 0.075;
let DEPTH = 0.02;

const INITIAL_POSITION = [0, .6, .5];
const INITIAL_HIDDEN_POSITION = [0, 0, 0];
const INITIAL_HIDDEN_ROTATION = [0, 0, 0, 1];
const INITIAL_HIDDEN_LINEAR_VELOCITY = new Vector3(0, 0, 0);
const INITIAL_HIDDEN_ANGULAR_VELOCITY = new Vector3(0, 0, 0);
const INITIAL_SCALE = new Vector3(0, 0, 0);
const DEFAULT_SCALE = new Vector3(1, 1, 1);
const EULER_ROTATION = new Euler(0, 0, 0);
let SOFT_CCD_PREDICTION = Math.max(WIDTH, HEIGHT, DEPTH);
const ADDITIONAL_SOLVER_ITERATIONS = 0;
const ANGULAR_DAMPING = 0;
const LINEAR_DAMPING = 0;
const FRICTION = 0.05;
const RESTITUTION = 0;
const DENSITY = 3;
const MODEL_PATH = "./assets/boopy.glb";

export default class {

    static TYPE = TYPE;
    static MAX_INSTANCES = MAX_INSTANCES;

    static #scene;
    static #meshes;
    static #instances;

    static async initialize({ scene, groups }) {
        this.#scene = scene;
        const { materials, geometries, width, height, depth } = await initializeModel({ scene });
        
        // Taille réelle conservée depuis le modèle .glb
        WIDTH = width;
        HEIGHT = height;
        DEPTH = depth;
        SOFT_CCD_PREDICTION = Math.max(WIDTH, HEIGHT, DEPTH);

        this.#meshes = initializeInstancedMeshes({ scene, materials, geometries });
        this.#instances = [];
        
        createInstances({
            scene,
            instances: this.#instances,
            groups
        });
    }

    static getBoopy({ index }) {
        return this.#instances[index];
    }

    static update() {
        for (const instance of this.#instances) {
            if (instance.used) {
                update({
                    instance,
                    meshes: this.#meshes
                });
            }
        }
    }

    static refresh() {
        this.#meshes.forEach(mesh => mesh.instanceMatrix.needsUpdate = true);
    }

    static getSize() {
        return {
            width: WIDTH,
            height: HEIGHT,
            depth: DEPTH
        };
    }

    static deposit({ position, rotation } = {}) {
        const instance = this.#instances.find(instance => !instance.used);
        if (!instance) return null;
        instance.used = true;
        initializePosition({ instance, position, rotation });
        instance.body.setEnabled(true);
        update({ instance, meshes: this.#meshes });
        return instance;
    }

    static recycle(instance) {
        instance.used = false;
        instance.body.setEnabled(false);
        initializePosition({ instance, hidden: true });
        update({
            instance,
            meshes: this.#meshes
        });
    }

    static get dynamicBodies() {
        const instances = [];
        for (const instance of this.#instances) {
            if (instance.used) {
                instances.push({ object: instance, objects: this, body: instance.body });
            }
        }
        return instances;
    }

    static save() {
        return this.#instances.map(instance => {
            return {
                position: instance.position.toArray(),
                rotation: instance.rotation.toArray(),
                used: instance.used,
                bodyHandle: this.#instances[instance.index].body.handle
            };
        });
    }

    static load(boopies) {
        if (!boopies) return;
        boopies.forEach((instance, instanceIndex) => {
            const body = this.#scene.worldBodies.get(instance.bodyHandle);
            const boopy = this.#instances[instanceIndex];
            if (body && boopy) {
                this.#instances[instanceIndex] = {
                    ...boopy,
                    position: new Vector3().fromArray(instance.position),
                    rotation: new Quaternion().fromArray(instance.rotation),
                    used: instance.used,
                    body
                };
                body.setEnabled(instance.used);
                for (let indexCollider = 0; indexCollider < body.numColliders(); indexCollider++) {
                    const collider = body.collider(indexCollider);
                    collider.userData = {
                        objectType: TYPE,
                        index: instanceIndex
                    };
                }
                update({
                    instance: this.#instances[instanceIndex],
                    meshes: this.#meshes
                });
            }
        });
    }
}

async function initializeModel({ scene }) {
    const model = await scene.loadModel(MODEL_PATH);
    const materials = [];
    const geometries = [];

    model.scene.updateMatrixWorld(true);

    const bbox = new Box3().setFromObject(model.scene);
    const center = new Vector3();
    bbox.getCenter(center);
    const size = new Vector3();
    bbox.getSize(size);

    model.scene.traverse((child) => {
        if (child.isMesh) {
            materials.push(child.material);
            const geom = child.geometry.clone();
            geom.applyMatrix4(child.matrixWorld);
            geom.translate(-center.x, -center.y, -center.z);
            geometries.push(geom);
        }
    });

    return {
        materials,
        geometries,
        width: size.x,
        height: size.y,
        depth: size.z
    };
}

function initializeInstancedMeshes({ scene, materials, geometries }) {
    const meshes = [];
    for (let indexMaterial = 0; indexMaterial < materials.length; indexMaterial++) {
        const mesh = new InstancedMesh(geometries[indexMaterial], materials[indexMaterial], MAX_INSTANCES);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        for (let indexInstance = 0; indexInstance < MAX_INSTANCES; indexInstance++) {
            mesh.setMatrixAt(indexInstance, INITIAL_SCALE);
        }
        scene.addObject(mesh);
        meshes.push(mesh);
    }
    return meshes;
}

function createInstances({ scene, instances, groups }) {
    for (let indexInstance = instances.length; indexInstance < MAX_INSTANCES; indexInstance++) {
        createInstance({ scene, instances, groups });
    }
}

function createInstance({ scene, instances, groups }) {
    const body = scene.createDynamicBody();
    body.setEnabled(false);
    body.setSoftCcdPrediction(SOFT_CCD_PREDICTION);
    body.setAngularDamping(ANGULAR_DAMPING);
    body.setLinearDamping(LINEAR_DAMPING);
    body.setAdditionalSolverIterations(ADDITIONAL_SOLVER_ITERATIONS);
    const index = instances.length;

    // Même type de collider que les lingots (Cuboid) ajusté à la taille réelle de Boopy
    const collider = scene.createCuboidCollider({
        userData: { objectType: TYPE, index },
        hx: WIDTH / 2,
        hy: HEIGHT / 2,
        hz: DEPTH / 2,
        friction: FRICTION,
        restitution: RESTITUTION,
        density: DENSITY
    }, body);

    collider.setCollisionGroups(groups.OBJECTS << 16 | groups.ALL);

    const instance = {
        objectType: TYPE,
        index,
        position: new Vector3(),
        rotation: new Quaternion(),
        body,
        matrix: new Matrix4(),
        used: false
    };
    instances.push(instance);
    return instance;
}

function initializePosition({ instance, hidden, position, rotation }) {
    if (hidden) {
        instance.position.fromArray(INITIAL_HIDDEN_POSITION);
        instance.rotation.fromArray(INITIAL_HIDDEN_ROTATION);
        instance.body.setLinvel(INITIAL_HIDDEN_LINEAR_VELOCITY, false);
        instance.body.setAngvel(INITIAL_HIDDEN_ANGULAR_VELOCITY, false);
    } else {
        if (position) {
            instance.position.copy(position);
        } else {
            instance.position.fromArray(INITIAL_POSITION);
        }
        if (rotation) {
            instance.rotation.setFromEuler(new Euler(rotation.x, rotation.y, rotation.z));
        } else {
            instance.rotation.setFromEuler(EULER_ROTATION);
        }
    }
    instance.body.setTranslation(instance.position);
    instance.body.setRotation(instance.rotation);
}

function update({ instance, meshes }) {
    instance.position.copy(instance.body.translation());
    instance.rotation.copy(instance.body.rotation());
    instance.matrix.compose(instance.position, instance.rotation, instance.used ? DEFAULT_SCALE : INITIAL_SCALE);
    meshes.forEach(mesh => mesh.setMatrixAt(instance.index, instance.matrix));
}
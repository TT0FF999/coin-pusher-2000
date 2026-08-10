import { Vector2, Raycaster } from "three";

export default class Pointer {
    constructor({ scene, camera, interactiveObjects }) {
        this.#scene = scene;
        this.#camera = camera;
        this.#interactiveObjects = interactiveObjects;
    }

    #scene;
    #camera;
    #interactiveObjects;
    #width;
    #height;
    #position = new Vector2();
    #raycaster = new Raycaster();

    initialize(width, height) {
        this.#width = width;
        this.#height = height;

        // Fonction générique pour récupérer les coordonnées X/Y (souris ou tactile)
        const updatePosition = (event) => {
            let clientX = event.clientX;
            let clientY = event.clientY;

            if (event.touches && event.touches.length > 0) {
                clientX = event.touches[0].clientX;
                clientY = event.touches[0].clientY;
            } else if (event.changedTouches && event.changedTouches.length > 0) {
                clientX = event.changedTouches[0].clientX;
                clientY = event.changedTouches[0].clientY;
            }

            if (clientX !== undefined && clientY !== undefined) {
                this.#position.x = (clientX / this.#width) * 2 - 1;
                this.#position.y = -(clientY / this.#height) * 2 + 1;
            }
        };

        // Gestion du survol (souris / pointeur)
        const handleMove = (event) => {
            updatePosition(event);
            this.#raycaster.setFromCamera(this.#position, this.#camera);
            const intersects = this.#raycaster.intersectObjects(this.#scene.children);
            
            if (intersects.length && this.#interactiveObjects.includes(intersects[0].object)) {
                document.body.style.cursor = "pointer";
            } else {
                document.body.style.cursor = "default";
            }
        };

        // Gestion de l'action/clic/pression tactile
        const handlePress = (event) => {
            updatePosition(event);
            this.#raycaster.setFromCamera(this.#position, this.#camera);
            const intersects = this.#raycaster.intersectObjects(this.#scene.children);

            if (intersects.length && this.#interactiveObjects.includes(intersects[0].object)) {
                if (!event.defaultPrevented) {
                    intersects[0].object.userData.onClick(intersects[0].instanceId);
                    if (event.cancelable) {
                        event.preventDefault();
                    }
                    event.stopPropagation();
                }
            }
        };

        // Événements Souris & Tactile unifiés via Pointer Events
        addEventListener("pointermove", handleMove);
        addEventListener("pointerdown", handlePress, { passive: false });

        // Support de secours pour le tactile mobile natif (Touch Events)
        addEventListener("touchstart", (event) => {
            handlePress(event);
        }, { passive: false });

        // Conservation du 'click' classique pour compatibilité bureau
        addEventListener("click", (event) => {
            // Ignoré si déclenché par un événement tactile déjà traité
            if (event.detail === 0) return; 
            handlePress(event);
        });
    }

    update() {
        // do nothing
    }

    resize(width, height) {
        this.#width = width;
        this.#height = height;
    }
}
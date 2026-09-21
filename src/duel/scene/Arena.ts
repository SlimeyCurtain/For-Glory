import * as THREE from 'three';

/** World-space anchor points the two fighters stand near, facing each other along Z. */
export const PLAYER_HUB = new THREE.Vector3(0, 0, 2.0);
export const ENEMY_HUB = new THREE.Vector3(0, 0, -2.0);
export const LANE_SPACING = 0.85;

// A camera sitting dead-behind the player (same X as both hubs) stares straight
// down the Z axis the player and enemy are both centered on, so the much-closer
// player fully occludes the enemy standing directly behind them. Offsetting the
// camera to one side turns it into a classic over-the-shoulder third-person shot.
const SHOULDER_OFFSET = 0.68;

/**
 * Owns the renderer/scene/camera and the (purely visual) circular arena the
 * two fighters are tethered to. The ring itself has no gameplay role -- lane
 * offsets are computed directly from combat state -- it just sells the
 * "fighting on a circular track" framing the camera and floor markings imply.
 */
export class Arena {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;

  private cameraLookTarget = new THREE.Vector3(0, 1.3, ENEMY_HUB.z);
  private cameraPosTarget = new THREE.Vector3(SHOULDER_OFFSET, 2.1, PLAYER_HUB.z + 3.0);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1016);
    this.scene.fog = new THREE.Fog(0x0d1016, 8, 22);

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 100);
    this.camera.position.copy(this.cameraPosTarget);
    this.camera.lookAt(this.cameraLookTarget);

    this.buildLights();
    this.buildGround();

    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => window.setTimeout(() => this.resize(), 60));
  }

  private buildLights() {
    const hemi = new THREE.HemisphereLight(0x8fa6c9, 0x1a1712, 0.9);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff2d8, 1.55);
    sun.position.set(3.5, 6, 2.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -5;
    sun.shadow.camera.right = 5;
    sun.shadow.camera.top = 5;
    sun.shadow.camera.bottom = -5;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 15;
    sun.shadow.bias = -0.003;
    this.scene.add(sun);

    const rim = new THREE.DirectionalLight(0x5a7fd6, 0.5);
    rim.position.set(-4, 3, -4);
    this.scene.add(rim);
  }

  private buildGround() {
    const groundGeo = new THREE.CircleGeometry(6, 48);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x3a3226, roughness: 0.95 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Faint ring markings tracing the tether path between the two fighters,
    // purely decorative -- gameplay never reads track geometry from this.
    const ringGeo = new THREE.RingGeometry(2.55, 2.65, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x6b5a3a, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    this.scene.add(ring);

    const innerRingGeo = new THREE.RingGeometry(0.05, 0.09, 32);
    const centerDot = new THREE.Mesh(innerRingGeo, ringMat.clone());
    centerDot.rotation.x = -Math.PI / 2;
    centerDot.position.y = 0.011;
    this.scene.add(centerDot);

    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const stoneGeo = new THREE.BoxGeometry(0.22, 0.05, 0.16);
      const stoneMat = new THREE.MeshStandardMaterial({ color: 0x55503f, roughness: 1 });
      const stone = new THREE.Mesh(stoneGeo, stoneMat);
      stone.position.set(Math.cos(a) * 2.6, 0.02, Math.sin(a) * 2.6);
      stone.rotation.y = a;
      stone.receiveShadow = true;
      stone.castShadow = true;
      this.scene.add(stone);
    }

    const wallGeo = new THREE.CylinderGeometry(6.2, 6.6, 3.2, 32, 1, true);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x1c1f26, roughness: 1, side: THREE.BackSide });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.y = 1.4;
    this.scene.add(wall);

    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const torchLight = new THREE.PointLight(0xff9a3c, 1.1, 5, 2);
      torchLight.position.set(Math.cos(a) * 5.6, 1.8, Math.sin(a) * 5.6);
      this.scene.add(torchLight);
      const flameGeo = new THREE.SphereGeometry(0.08, 8, 8);
      const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa940 });
      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.copy(torchLight.position);
      this.scene.add(flame);
    }
  }

  /** Called every frame; smoothly eases the camera toward wherever the player currently stands. */
  updateCamera(playerX: number, dt: number) {
    this.cameraPosTarget.x = SHOULDER_OFFSET + playerX * 0.5;
    const ease = 1 - Math.pow(0.0008, dt);
    this.camera.position.x += (this.cameraPosTarget.x - this.camera.position.x) * ease;
    const lookX = playerX * 0.3;
    this.camera.lookAt(lookX, this.cameraLookTarget.y, this.cameraLookTarget.z);
  }

  resize() {
    const parent = this.renderer.domElement.parentElement ?? document.body;
    const w = parent.clientWidth || window.innerWidth;
    const h = parent.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

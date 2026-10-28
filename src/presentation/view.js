import { TAKRAW_SCHOOLS } from '../config/schools.js';
import { TakrawImpactEffects } from './impact.js';
import { TakrawFieldEffects } from './field-effects.js';

class TakrawView {
  constructor({ THREE, canvas, config }) {
    this.THREE = THREE;
    this.canvas = canvas;
    this.config = config;
    this.schools = [TAKRAW_SCHOOLS[0], TAKRAW_SCHOOLS[1]];
    this.textures = new Map();
    this.meshes = new Map();
    this.geometries = new Map();
    this.materials = new Map();
    this.venueMaterials = new Map();
    this.quality = 'high';
    this.lastMs = 0;
    this.motionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.shakeOffset = { x: 0, y: 0 };
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xe8eee3);
    this.scene.fog = new THREE.Fog(0xe8eee3, 32, 68);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.13;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const camera = config.visual.camera;
    this.camera = new THREE.PerspectiveCamera(camera.fov, 1, camera.near, camera.far);
    this.cameraRig = {
      focus: new THREE.Vector3(0, camera.focusHeight, 0),
      target: new THREE.Vector3(), offset: new THREE.Vector3(),
      right: new THREE.Vector3(), up: new THREE.Vector3(), relative: new THREE.Vector3(),
      distance: Math.hypot(camera.distance, camera.elevation), team: 0, mode: null, phase: null,
      orbit: { yaw: 0, pitch: Math.atan2(camera.elevation, camera.distance) },
      initialized: false,
    };
    this.camera.position.set(-camera.distance, camera.focusHeight + camera.elevation, 0);
    this.camera.lookAt(this.cameraRig.focus);
    this.temp = { vector: new THREE.Vector3(), scale: new THREE.Vector3(), object: new THREE.Object3D() };
    this.makeLights();
    this.makeCourt();
    this.makeSurroundings();
    this.makeVenueBanners();
    this.applyVenue();
    this.makeMarkers();
    this.impacts = new TakrawImpactEffects({ THREE, scene: this.scene, config, reducedMotion: () => this.reducedMotion() });
    this.impacts.camera = this.camera;
    this.field = new TakrawFieldEffects({ THREE, scene: this.scene, config, reducedMotion: () => this.reducedMotion() });
    this.resize();
  }

  material(color, options = {}) {
    const key = `${color}:${options.roughness ?? .85}:${options.metalness ?? 0}:${options.opacity ?? 1}:${options.basic ?? false}`;
    if (!this.materials.has(key)) {
      const properties = { color, roughness: options.roughness ?? .85, metalness: options.metalness ?? 0 };
      if (options.opacity !== undefined) { properties.transparent = true; properties.opacity = options.opacity; properties.depthWrite = false; }
      if (options.basic) { delete properties.roughness; delete properties.metalness; }
      this.materials.set(key, options.basic ? new this.THREE.MeshBasicMaterial(properties) : new this.THREE.MeshStandardMaterial(properties));
    }
    return this.materials.get(key);
  }

  venueMaterial(channel) {
    if (!this.venueMaterials.has(channel)) {
      const material = new this.THREE.MeshStandardMaterial({ color: this.schools[1].venue[channel], roughness: .85 });
      this.venueMaterials.set(channel, material);
      this.materials.set(`venue:${channel}`, material);
    }
    return this.venueMaterials.get(channel);
  }

  makeVenueBanners() {
    this.venueBanners = [-3.7, 0, 3.7].map((z, index) => {
      const banner = this.mesh(this.geometry('venue-banner', () => new this.THREE.PlaneGeometry(3.4, .72)),
        this.bannerMaterial(index));
      banner.position.set(7.8, 2.65, z); banner.rotation.y = -Math.PI / 2;
      banner.castShadow = false; banner.receiveShadow = false;
      return banner;
    });
  }

  bannerMaterial(index) {
    const school = this.schools[1], key = `venue-banner:${school.id}:${index}`;
    if (!this.materials.has(key)) {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 136;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = `#${school.uniform.primary.toString(16).padStart(6, '0')}`; ctx.fillRect(0, 0, 640, 136);
      ctx.fillStyle = `#${school.venue.line.toString(16).padStart(6, '0')}`;
      ctx.font = 'bold 43px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(school.venue.banners[index], 320, 68, 600);
      const texture = new this.THREE.CanvasTexture(canvas); texture.colorSpace = this.THREE.SRGBColorSpace;
      this.textures.set(key, texture);
      this.materials.set(key, new this.THREE.MeshBasicMaterial({ map: texture, side: this.THREE.DoubleSide }));
    }
    return this.materials.get(key);
  }

  applyVenue() {
    const venue = this.schools[1].venue, color = new this.THREE.Color();
    for (const [channel, material] of this.venueMaterials) material.color.set(venue[channel]);
    this.scene.background.set(venue.fog.color);
    this.scene.fog.color.set(venue.fog.color); this.scene.fog.near = venue.fog.near; this.scene.fog.far = venue.fog.far;
    const bodies = this.crowd[0];
    for (let i = 0; i < bodies.count; i++) bodies.setColorAt(i, color.set(venue.shirts[i % venue.shirts.length]));
    bodies.instanceColor.needsUpdate = true;
    this.venueBanners.forEach((banner, index) => { banner.material = this.bannerMaterial(index); });
  }

  geometry(key, factory) {
    if (!this.geometries.has(key)) this.geometries.set(key, factory());
    return this.geometries.get(key);
  }

  mesh(geometry, material, parent = this.scene) {
    const mesh = new this.THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  box(width, height, depth, color, x = 0, y = 0, z = 0, parent = this.scene) {
    const geometry = this.geometry(`box:${width}:${height}:${depth}`, () => new this.THREE.BoxGeometry(width, height, depth));
    const mesh = this.mesh(geometry, typeof color === 'object' ? color : this.material(color), parent);
    mesh.position.set(x, y, z);
    return mesh;
  }

  sphere(radius, color, x = 0, y = 0, z = 0, parent = this.scene, segments = 12) {
    const geometry = this.geometry(`sphere:${radius}:${segments}`, () => new this.THREE.SphereGeometry(radius, segments, 10));
    const mesh = this.mesh(geometry, typeof color === 'object' ? color : this.material(color), parent);
    mesh.position.set(x, y, z);
    return mesh;
  }

  cylinder(radius, height, color, x, y, z, parent = this.scene, top = radius) {
    const geometry = this.geometry(`cylinder:${radius}:${top}:${height}`, () => new this.THREE.CylinderGeometry(top, radius, height, 12));
    const mesh = this.mesh(geometry, typeof color === 'object' ? color : this.material(color), parent);
    mesh.position.set(x, y, z);
    return mesh;
  }

  makeLights() {
    const THREE = this.THREE;
    this.scene.add(new THREE.HemisphereLight(0xfffcf0, 0x91a586, 2.05));
    this.sun = new THREE.DirectionalLight(0xfff4dc, 3.05);
    this.sun.position.set(-8, 17, 8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, { left: -14, right: 14, top: 13, bottom: -13, near: .5, far: 42 });
    this.sun.shadow.bias = -.0003;
    this.sun.shadow.normalBias = .025;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun);
    const fill = new THREE.DirectionalLight(0xe4f6ed, .65);
    fill.position.set(8, 9, -6);
    this.scene.add(fill);
  }

  makeCourt() {
    const T = this.THREE, { halfLength: x, halfWidth: z, netHeight } = this.config.court;
    const ground = this.mesh(new T.PlaneGeometry(160, 160), this.material(0xe8eee3));
    this.geometries.set('ground', ground.geometry);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -.26;
    ground.castShadow = false;
    this.box(17.6, .22, 10.0, 0xd7d6bc, 0, -.145, 0);
    this.box(17.45, .055, 9.85, 0xece7d4, 0, -.02, 0);
    this.box(x * 2 + .28, .018, z * 2 + .28, 0x2f6257, 0, .016, 0);
    this.box(x, .018, z * 2, this.venueMaterial('court'), -x / 2, .028, 0);
    this.box(x, .018, z * 2, this.venueMaterial('courtInset'), x / 2, .028, 0);
    const line = this.venueMaterial('line');
    for (const side of [-1, 1]) {
      this.box(.035, .007, z * 2, line, side * x, .043, 0);
      this.box(x * 2, .007, .035, line, 0, .043, side * z);
      const service = this.mesh(this.geometry('serve-ring', () => new T.RingGeometry(.27, .30, 48)), line);
      service.rotation.x = -Math.PI / 2;
      service.position.set(side * 4.25, .047, 0);
      service.castShadow = false;
      for (const corner of [-1, 1]) {
        const arc = this.mesh(this.geometry(`quarter:${side}:${corner}`, () => new T.RingGeometry(.87, .90, 30, 1, side < 0 ? (corner < 0 ? Math.PI : Math.PI * .5) : (corner < 0 ? Math.PI * 1.5 : 0), Math.PI * .5)), line);
        arc.rotation.x = -Math.PI / 2;
        arc.position.set(0, .046, corner * z);
        arc.castShadow = false;
      }
    }
    this.box(.025, .006, z * 2, line, 0, .044, 0);
    const netPositions = [];
    const netBottom = netHeight - .69;
    const netSpan = z + .29;
    for (let i = 0; i <= 50; i++) { const depth = -netSpan + (netSpan * 2 * i / 50); netPositions.push(.006, netBottom, depth, .006, netHeight, depth); }
    for (let i = 0; i <= 7; i++) { const y = netBottom + .69 * i / 7; netPositions.push(.006, y, -netSpan, .006, y, netSpan); }
    const netGeometry = new T.BufferGeometry();
    netGeometry.setAttribute('position', new T.Float32BufferAttribute(netPositions, 3));
    const netMaterial = new T.LineBasicMaterial({ color: 0x28433e, transparent: true, opacity: .32 });
    this.geometries.set('net', netGeometry); this.materials.set('net', netMaterial);
    this.scene.add(new T.LineSegments(netGeometry, netMaterial));
    this.box(.035, .045, netSpan * 2, 0xffffef, 0, netHeight, 0);
    this.box(.018, .014, netSpan * 2, 0xe7e8d8, 0, netBottom, 0);
    for (const side of [-1, 1]) {
      this.cylinder(.055, netHeight + .25, 0xfaf4de, 0, (netHeight + .25) / 2, side * netSpan);
      this.cylinder(.11, .36, 0x276e60, 0, .18, side * netSpan);
      this.sphere(.064, 0xf7f2dc, 0, netHeight + .25, side * netSpan);
      this.box(.035, .26, .035, 0xe69569, 0, netHeight + .085, side * z);
    }
    for (const side of [-1, 1]) {
      this.box(15.2, .018, .065, 0xc1c7ae, 0, .014, side * 4.30);
      for (let i = 0; i < 6; i++) this.box(.18, .015, .05, 0xc1c7ae, -6.8 + i * 2.7, .012, side * 4.55);
    }
  }

  makeSurroundings() {
    const T = this.THREE;
    // Small bleachers leave the court and ball as the strongest shapes.
    for (let row = 0; row < 3; row++) {
      const z = -5.0 - row * .58, y = .12 + row * .25;
      this.box(10.4, .18, .48, row === 0 ? 0xd4d1b9 : 0xdad8c2, -.3, y, z);
      this.box(10.3, .04, .35, row === 0 ? 0x92b4a2 : 0xa1baaa, -.3, y + .115, z - .04);
      for (const x of [-4.4, 3.8]) this.box(.12, y + .25, .16, 0xc2c6ad, x, (y + .25) / 2 - .1, z);
    }
    const bodyGeometry = this.geometry('crowd-body', () => new T.CapsuleGeometry(.10, .18, 3, 6));
    const headGeometry = this.geometry('crowd-head', () => new T.SphereGeometry(.103, 8, 6));
    const crowdMaterial = this.material(0xffffff);
    const count = 25;
    const bodies = new T.InstancedMesh(bodyGeometry, crowdMaterial, count);
    const heads = new T.InstancedMesh(headGeometry, crowdMaterial, count);
    bodies.castShadow = true; heads.castShadow = true;
    const object = new T.Object3D(), color = new T.Color();
    const shirts = this.schools[1].venue.shirts;
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / 9);
      const x = -4.6 + (i % 9) * 1.05 + (row === 1 ? .22 : 0);
      const z = -5.08 - row * .58;
      const y = .46 + row * .25;
      object.position.set(x, y, z); object.rotation.set(.06, (i % 3 - 1) * .25, 0); object.scale.set(1, 1, 1); object.updateMatrix();
      bodies.setMatrixAt(i, object.matrix); bodies.setColorAt(i, color.set(shirts[i % shirts.length]));
      object.position.y += .21; object.updateMatrix(); heads.setMatrixAt(i, object.matrix); heads.setColorAt(i, color.set(i % 4 ? 0xd4b695 : 0xa88061));
    }
    this.scene.add(bodies, heads);
    this.crowd = [bodies, heads];
    // Far-side rail and the low entrance opening.
    for (let i = -5; i <= 5; i++) this.cylinder(.025, .95, 0xb4c3ad, i * 1.05, .25, -7.05);
    for (const height of [.18, .68]) {
      const rail = this.cylinder(.021, 10.5, 0xb4c3ad, 0, height, -7.05);
      rail.rotation.z = Math.PI / 2;
    }
    for (const side of [-1, 1]) {
      const x = side * 8.7;
      this.box(1.02, .34, .38, 0x5b8471, x, .03, -3.2);
      this.box(.92, .03, .30, 0xb4c3a9, x, .215, -3.2);
      this.box(.06, .34, .06, 0xaebaa0, x - .35, -.06, -3.2);
      this.box(.06, .34, .06, 0xaebaa0, x + .35, -.06, -3.2);
      this.cylinder(.035, 3.3, 0xc7cdb6, x, 1.4, -5.5);
      this.box(.70, .08, .25, 0xe5e8d2, x, 3.04, -5.5);
      this.box(.63, .02, .21, 0xffffe6, x, 2.99, -5.5);
    }
    const trees = [[-10,-7,1.0],[9.8,-8,1.2],[-11,3,1.15],[11.6,2.4,.92],[-7.7,-10.5,.87],[7.7,-11,.82]];
    for (let index = 0; index < trees.length; index++) {
      const [x,z,s] = trees[index];
      this.cylinder(.11 * s, 1.6 * s, 0xb1a17d, x, .45 * s, z);
      this.sphere(.78 * s, index % 2 ? 0x9bb792 : 0xa9bd91, x, 1.5 * s, z, this.scene, 9);
      this.sphere(.57 * s, 0xb4c69d, x + .4 * s, 1.9 * s, z - .1 * s, this.scene, 9);
      this.sphere(.53 * s, 0x98b28c, x - .38 * s, 1.68 * s, z + .17 * s, this.scene, 9);
    }
    for (const side of [-1, 1]) {
      const sign = new T.Group(); this.scene.add(sign); sign.position.set(side * 7.8, .2, -5.0); sign.rotation.y = side * .12;
      this.box(1.1, .55, .08, 0xe3dfc8, 0, .20, 0, sign);
      this.box(.86, .36, .015, side < 0 ? 0x5b8e78 : 0xb98e70, 0, .21, .05, sign);
      for (let i = 0; i < 3; i++) this.box(.12, .035, .01, 0xf5f0d9, -.24 + i * .24, .21, .061, sign);
      this.box(.055, .6, .055, 0xacb39b, -.35, -.05, 0, sign); this.box(.055, .6, .055, 0xacb39b, .35, -.05, 0, sign);
    }
  }

  makeMarkers() {
    const T = this.THREE;
    this.playerMarkers = [];
    const ringGeometry = this.geometry('selection-ring', () => new T.RingGeometry(.30, .34, 40));
    const shadowGeometry = this.geometry('contact-shadow', () => new T.CircleGeometry(.40, 32));
    for (let i = 0; i < 6; i++) {
      const shadowMaterial = new T.MeshBasicMaterial({ color: 0x163d2b, transparent: true, opacity: .12, depthWrite: false });
      this.materials.set(`shadow:${i}`, shadowMaterial);
      const shadow = this.mesh(shadowGeometry, shadowMaterial);
      shadow.rotation.x = -Math.PI / 2; shadow.position.y = .048; shadow.castShadow = false; shadow.receiveShadow = false;
      const ringMaterial = new T.MeshBasicMaterial({ color: i < 3 ? 0xd9f1b5 : 0xffddba, transparent: true, opacity: .96, depthWrite: false });
      this.materials.set(`ring:${i}`, ringMaterial);
      const ring = this.mesh(ringGeometry, ringMaterial); ring.rotation.x = -Math.PI / 2; ring.position.y = .052; ring.castShadow = false; ring.receiveShadow = false;
      const arrowGeometry = this.geometry('player-arrow', () => new T.ConeGeometry(.075, .15, 3));
      const arrow = this.mesh(arrowGeometry, this.material(i < 3 ? 0xe2f7b3 : 0xffd6af, { basic: true }));
      arrow.rotation.z = Math.PI; arrow.castShadow = false; arrow.receiveShadow = false;
      this.playerMarkers.push({ shadow, ring, arrow });
    }
    const ballShadowMaterial = new T.MeshBasicMaterial({ color: 0x263f27, transparent: true, opacity: .30, depthWrite: false });
    this.materials.set('ballShadow', ballShadowMaterial);
    this.ballShadow = this.mesh(this.geometry('ballShadow', () => new T.CircleGeometry(.16, 28)), ballShadowMaterial);
    this.ballShadow.rotation.x = -Math.PI / 2; this.ballShadow.position.y = .053; this.ballShadow.castShadow = false; this.ballShadow.receiveShadow = false;
    this.ballLocator = this.mesh(this.geometry('ballLocator', () => new T.RingGeometry(.24, .29, 40)), this.material(0xffe8a7, { opacity: .90, basic: true }));
    this.ballLocator.rotation.x = -Math.PI / 2; this.ballLocator.position.y = .056; this.ballLocator.castShadow = false; this.ballLocator.receiveShadow = false;
    const heightMaterial = new T.LineDashedMaterial({ color: 0xffefba, transparent: true, opacity: .62,
      dashSize: .12, gapSize: .09, depthWrite: false, depthTest: false });
    this.materials.set('ballHeight', heightMaterial);
    this.heightData = new Float32Array(6);
    this.heightDistances = new Float32Array(2);
    this.heightGeometry = new T.BufferGeometry();
    this.heightGeometry.setAttribute('position', new T.BufferAttribute(this.heightData, 3));
    this.heightGeometry.setAttribute('lineDistance', new T.BufferAttribute(this.heightDistances, 1));
    this.geometries.set('ballHeight', this.heightGeometry);
    this.ballHeight = new T.Line(this.heightGeometry, heightMaterial);
    this.ballHeight.frustumCulled = false; this.ballHeight.renderOrder = 3; this.scene.add(this.ballHeight);
    this.heightTickData = new Float32Array(16 * 6);
    this.heightTickGeometry = new T.BufferGeometry();
    this.heightTickGeometry.setAttribute('position', new T.BufferAttribute(this.heightTickData, 3));
    this.heightTickGeometry.setDrawRange(0, 0); this.geometries.set('ballHeightTicks', this.heightTickGeometry);
    const tickMaterial = new T.LineBasicMaterial({ color: 0xffefba, transparent: true, opacity: .75, depthWrite: false, depthTest: false });
    this.materials.set('ballHeightTicks', tickMaterial);
    this.ballHeightTicks = new T.LineSegments(this.heightTickGeometry, tickMaterial);
    this.ballHeightTicks.frustumCulled = false; this.ballHeightTicks.renderOrder = 3; this.scene.add(this.ballHeightTicks);
    this.haloBaseColor = 0x213f37;
    const haloMaterial = new T.MeshBasicMaterial({ color: this.haloBaseColor, transparent: true, opacity: .85,
      side: T.DoubleSide, depthWrite: false, depthTest: false });
    this.materials.set('ballHalo', haloMaterial);
    this.haloMaterial = haloMaterial;
    this.ballHalo = this.mesh(this.geometry('ballHalo', () => new T.RingGeometry(.118, .140, 40)), haloMaterial);
    this.ballHalo.castShadow = false; this.ballHalo.receiveShadow = false; this.ballHalo.renderOrder = 4;
    this.trailData = new Float32Array(20 * 3);
    this.trailGeometry = new T.BufferGeometry(); this.trailGeometry.setAttribute('position', new T.BufferAttribute(this.trailData, 3)); this.trailGeometry.setDrawRange(0, 0);
    this.geometries.set('ballTrail', this.trailGeometry);
    this.trailBase = { color: 0xffdf92, opacity: .55 };
    this.trailMaterial = new T.LineBasicMaterial({ color: this.trailBase.color, transparent: true, opacity: this.trailBase.opacity, depthWrite: false }); this.materials.set('ballTrail', this.trailMaterial);
    this.trail = new T.Line(this.trailGeometry, this.trailMaterial); this.trail.frustumCulled = false; this.scene.add(this.trail); this.trailCount = 0; this.trailLast = new T.Vector3();
    this.makeAttackGuides();
    this.makeReceiveGuides();
  }

  makeReceiveGuides() {
    const T = this.THREE, s = this.config.visual.receiveGuide;
    const actorGeometry = this.geometry('receiveGuide:actor', () => new T.PlaneGeometry(s.actorWidth * .42, .028));
    const contactGeometry = this.geometry('receiveGuide:contact', () => new T.PlaneGeometry(s.contactRadius * 1.25, s.contactRadius * .19));
    this.receiveGuides = [0, 1].map(team => {
      const material = new T.MeshBasicMaterial({ color: s.colors.ai, transparent: true,
        opacity: s.opacity.active, depthWrite: false, side: T.DoubleSide });
      const contactMaterial = material.clone(); contactMaterial.depthTest = false;
      this.materials.set(`receiveGuide:${team}`, material);
      this.materials.set(`receiveGuide:${team}:contact`, contactMaterial);
      const actor = new T.Group(), contact = new T.Group();
      this.scene.add(actor, contact); actor.visible = contact.visible = false;
      actor.rotation.x = -Math.PI / 2;
      // Paired brackets identify the receiver; the airborne diamond is a
      // predicted contact point, distinct from the current ball's round ring.
      for (const side of [-1, 1]) for (const arm of [-1, 1]) {
        const bar = this.mesh(actorGeometry, material, actor);
        bar.position.set(side * s.actorWidth, arm * s.actorWidth * .13, 0);
        bar.rotation.z = -side * arm * Math.PI / 4;
        bar.castShadow = bar.receiveShadow = false;
      }
      for (let i = 0; i < 4; i++) {
        const bar = this.mesh(contactGeometry, contactMaterial, contact);
        const angle = Math.PI / 4 + i * Math.PI / 2;
        bar.position.set(Math.cos(angle) * s.contactRadius * .5, Math.sin(angle) * s.contactRadius * .5, 0);
        bar.rotation.z = angle + Math.PI / 2; bar.renderOrder = 3;
        bar.castShadow = bar.receiveShadow = false;
      }
      return { actor, contact, material, contactMaterial };
    });
  }

  updateReceiveGuides(viewData, context) {
    const s = this.config.visual.receiveGuide;
    const local = (context.mode ?? viewData.state?.mode) === 'local';
    for (let team = 0; team < 2; team++) {
      const marker = this.receiveGuides[team], guide = viewData.receiveGuides?.[team];
      const body = guide ? this.meshes.get(`p${guide.playerId}:pelvis`) : null;
      const visible = !!body && !!guide && viewData.state?.phase === 'rally' && (local || team === this.cameraRig.team);
      marker.actor.visible = visible;
      marker.contact.visible = visible && !!guide.point && guide.stage !== 'recover';
      if (!visible) continue;
      marker.actor.position.set(body.position.x, s.groundHeight, body.position.z);
      const color = guide.human ? s.colors.human : s.colors.ai;
      const opacity = guide.reachable ? s.opacity.active : s.opacity.waiting;
      marker.material.color.set(color); marker.material.opacity = opacity;
      marker.contactMaterial.color.set(color); marker.contactMaterial.opacity = opacity;
      if (!marker.contact.visible) continue;
      marker.contact.position.set(guide.point.x, guide.point.y, guide.point.z);
      marker.contact.quaternion.copy(this.camera.quaternion);
      const depth = Math.max(1, -this.temp.vector.copy(marker.contact.position).applyMatrix4(this.camera.matrixWorldInverse).z);
      const unitsPerPixel = 2 * depth * Math.tan(this.camera.fov * Math.PI / 360) / this.height;
      marker.contact.scale.setScalar(Math.max(1, s.contactMinPixels * .5 * unitsPerPixel / s.contactRadius));
    }
  }

  makeAttackGuides() {
    const T = this.THREE, s = this.config.visual.attackGuide;
    const radius = this.config.ai.toss.attack.positionRadius;
    const arcGeometry = this.geometry('attackGuide:arc', () => new T.RingGeometry(radius - .018, radius, 16, 1, .18, Math.PI / 2 - .36));
    const footGeometry = this.geometry('attackGuide:foot', () => new T.BoxGeometry(s.foot.length, .005, s.foot.width));
    const toeGeometry = this.geometry('attackGuide:toe', () => new T.CircleGeometry(s.foot.width * .5, 12, -Math.PI / 2, Math.PI));
    const targetGeometry = this.geometry('attackGuide:target', () => new T.PlaneGeometry(s.contactRadius * .32, s.contactRadius * .65));
    const readyGeometry = this.geometry('attackGuide:ready', () => new T.RingGeometry(radius - .04, radius - .022, 48));
    const kickGeometry = this.geometry('attackGuide:kick', () => new T.RingGeometry(s.contactRadius * 1.05, s.contactRadius * 1.19, 40));
    this.attackGuides = [0, 1].map(team => {
      const material = new T.MeshBasicMaterial({ color: s.colors.approach, transparent: true,
        opacity: s.opacity.approach, depthWrite: false, side: T.DoubleSide });
      const contactMaterial = material.clone(); contactMaterial.depthTest = false;
      this.materials.set(`attackGuide:${team}`, material); this.materials.set(`attackGuide:${team}:contact`, contactMaterial);
      const outlineMaterial = new T.MeshBasicMaterial({ color: 0x213f37, transparent: true, opacity: .72,
        depthWrite: false, depthTest: false, side: T.DoubleSide });
      this.materials.set(`attackGuide:${team}:outline`, outlineMaterial);
      const stance = new T.Group(), contact = new T.Group();
      this.scene.add(stance, contact); stance.visible = contact.visible = false;
      stance.position.y = s.groundHeight; stance.rotation.y = team === 0 ? 0 : Math.PI;
      const flat = (geometry, surface, parent) => {
        const mesh = this.mesh(geometry, surface, parent); mesh.castShadow = mesh.receiveShadow = false;
        return mesh;
      };
      for (let i = 0; i < 4; i++) {
        const arc = flat(arcGeometry, material, stance); arc.rotation.set(-Math.PI / 2, 0, i * Math.PI / 2);
        const target = flat(targetGeometry, contactMaterial, contact);
        const angle = i * Math.PI / 2;
        target.position.set(Math.sin(angle) * s.contactRadius * .72, Math.cos(angle) * s.contactRadius * .72, 0);
        target.rotation.z = -angle; target.renderOrder = 3;
        const outline = flat(targetGeometry, outlineMaterial, contact);
        outline.position.copy(target.position); outline.rotation.copy(target.rotation); outline.scale.set(1.7, 1.3, 1); outline.renderOrder = 2;
      }
      for (const side of [-1, 1]) {
        flat(footGeometry, material, stance).position.z = side * s.foot.spacing * .5;
        const toe = flat(toeGeometry, material, stance); toe.rotation.x = -Math.PI / 2;
        toe.position.set(s.foot.length * .5, .003, side * s.foot.spacing * .5);
      }
      const ready = flat(readyGeometry, material, stance); ready.rotation.x = -Math.PI / 2; ready.visible = false;
      const kick = flat(kickGeometry, contactMaterial, contact); kick.visible = false; kick.renderOrder = 3;
      return { stance, contact, ready, kick, material, contactMaterial };
    });
  }

  updateAttackGuides(viewData, context) {
    const s = this.config.visual.attackGuide;
    const local = (context.mode ?? viewData.state?.mode) === 'local';
    for (let team = 0; team < 2; team++) {
      const marker = this.attackGuides[team], guide = viewData.attackGuides?.[team];
      const visible = !!guide && viewData.state?.phase === 'rally' && (local || team === this.cameraRig.team);
      marker.stance.visible = marker.contact.visible = visible;
      if (!visible) continue;
      marker.stance.position.set(guide.stance.x, s.groundHeight, guide.stance.z);
      marker.contact.position.set(guide.contact.x, guide.contact.y, guide.contact.z);
      marker.contact.quaternion.copy(this.camera.quaternion);
      const depth = Math.max(1, this.temp.vector.copy(marker.contact.position).applyMatrix4(this.camera.matrixWorldInverse).z * -1);
      const unitsPerPixel = 2 * depth * Math.tan(this.camera.fov * Math.PI / 360) / this.height;
      marker.contact.scale.setScalar(Math.max(1, s.contactMinPixels * .5 * unitsPerPixel / s.contactRadius));
      const ready = guide.stage === 'jump' && guide.jumpWindow;
      marker.ready.visible = !!ready;
      marker.kick.visible = !!guide.kickWindow;
      const color = ready ? s.colors.ready : s.colors.approach, opacity = ready ? s.opacity.ready : s.opacity.approach;
      marker.material.color.set(color); marker.material.opacity = opacity;
      marker.contactMaterial.color.set(guide.kickWindow ? s.colors.ready : color);
      marker.contactMaterial.opacity = guide.kickWindow ? s.opacity.ready : opacity;
    }
  }

  bodyGeometry(entity) {
    const T = this.THREE;
    if (entity.shape === 'sphere') return this.geometry(`entitySphere:${entity.radius}`, () => new T.SphereGeometry(entity.radius, 16, 12));
    if (entity.shape === 'capsule') return this.geometry(`entityCapsule:${entity.radius}:${entity.halfHeight}`, () => new T.CapsuleGeometry(entity.radius, entity.halfHeight * 2, 4, 10));
    const size = entity.halfExtents;
    return this.geometry(`entityBox:${size.x}:${size.y}:${size.z}`, () => {
      const radius = Math.min(size.x, size.y, size.z) * .28;
      const w = size.x * 2 - radius, h = size.y * 2 - radius, d = size.z * 2 - radius;
      const shape = new T.Shape();
      const r = radius, l = -w / 2, b = -h / 2;
      shape.moveTo(l + r, b); shape.lineTo(l + w - r, b); shape.quadraticCurveTo(l + w, b, l + w, b + r);
      shape.lineTo(l + w, b + h - r); shape.quadraticCurveTo(l + w, b + h, l + w - r, b + h);
      shape.lineTo(l + r, b + h); shape.quadraticCurveTo(l, b + h, l, b + h - r);
      shape.lineTo(l, b + r); shape.quadraticCurveTo(l, b, l + r, b);
      const geometry = new T.ExtrudeGeometry(shape, { depth: d, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: radius / 2, bevelThickness: radius / 2, curveSegments: 3 });
      geometry.center(); return geometry;
    });
  }

  stretchCapsule(geometry, halfHeight) {
    return { geometry, baseHalfHeight: halfHeight, halfHeight,
      basePositions: geometry.getAttribute('position').array.slice() };
  }

  updateCapsuleLength(capsule, halfHeight) {
    if (Math.abs(capsule.halfHeight - halfHeight) < 1e-9) return;
    const position = capsule.geometry.getAttribute('position');
    const base = capsule.baseHalfHeight, delta = halfHeight - base;
    for (let i = 1; i < position.array.length; i += 3) {
      const y = capsule.basePositions[i];
      // Translate the hemispherical caps without stretching their radius.
      position.array[i] = y > base ? y + delta : y < -base ? y - delta : y * halfHeight / base;
    }
    position.needsUpdate = true;
    capsule.geometry.computeBoundingBox(); capsule.geometry.computeBoundingSphere();
    capsule.halfHeight = halfHeight;
  }

  updateLegGeometry(group, halfHeight) {
    const leg = group.userData.legGeometry;
    if (!leg || !Number.isFinite(halfHeight) || halfHeight <= 0) return;
    this.updateCapsuleLength(leg.body, halfHeight);
    if (leg.sock) {
      this.updateCapsuleLength(leg.sock, halfHeight * .30);
      leg.sockMesh.position.y = -halfHeight * .60;
    }
  }

  setSchools(schools) {
    if (schools.every((school, i) => school === this.schools[i])) return;
    this.schools = schools;
    this.applyVenue();
    // 다음 pose publish가 같은 ID로 새 외형을 연결합니다.
    for (const group of this.meshes.values()) group.removeFromParent();
    this.meshes.clear();
    for (const [key, geometry] of this.geometries) if (key.startsWith('elastic:')) {
      geometry.dispose(); this.geometries.delete(key);
    }
  }

  numberMaterial(number, color) {
    const key = `number:${number}:${color}`;
    if (!this.materials.has(key)) {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
      ctx.font = 'bold 52px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(number), 32, 34);
      const texture = new this.THREE.CanvasTexture(canvas); texture.colorSpace = this.THREE.SRGBColorSpace;
      this.textures.set(key, texture);
      this.materials.set(key, new this.THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
    }
    return this.materials.get(key);
  }

  createEntity(entity) {
    const T = this.THREE, group = new T.Group();
    this.scene.add(group);
    group.userData.entity = entity;
    const team = entity.team === 1 ? 1 : 0;
    const school = this.schools[team], { uniform, hair: hairstyle } = school;
    const color = uniform.primary;
    const playerId = Number((entity.id.match(/^p(\d+):/) || [0,0])[1]);
    const skinPalette = [0xe9c49e,0xd0a77f,0xf1d2ac,0xe1b88e,0xb98a65,0xf0c6a1];
    const skin = skinPalette[playerId % 6];
    const part = entity.part || '';
    if (entity.kind === 'ball') {
      const radius = entity.radius;
      this.mesh(this.bodyGeometry(entity), this.material(0xffe3a0, { roughness: .66 }), group);
      const ribbon = this.geometry(`ball-ribbon:${radius}`, () => new T.TorusGeometry(radius * .995, radius * .036, 4, 36));
      const ribbonMaterial = this.material(0xb78d44, { roughness: .9 });
      for (let i = 0; i < 6; i++) {
        const band = this.mesh(ribbon, ribbonMaterial, group);
        band.rotation.set(i * Math.PI / 6, i * Math.PI / 3, i * Math.PI / 5);
      }
    } else {
      let surface = skin;
      if (part === 'torso' || part.startsWith('upperArm')) surface = color;
      if (part === 'pelvis' || part.startsWith('upperLeg')) surface = uniform.stripe;
      if (part.startsWith('foot')) surface = 0xfcf4d9;
      if (/^(upperLeg|lowerLeg)/.test(part)) {
        const rest = { ...entity, halfHeight: entity.restHalfHeight };
        const geometry = this.bodyGeometry(rest).clone();
        this.geometries.set(`elastic:${entity.id}:body`, geometry);
        this.mesh(geometry, this.material(surface), group);
        group.userData.legGeometry = { body: this.stretchCapsule(geometry, rest.halfHeight) };
      } else this.mesh(this.bodyGeometry(entity), this.material(surface), group);
      if (part === 'head') {
        const r = entity.radius;
        const shape = hairstyle.shape;
        const hair = this.geometry(`hair:${r}:${shape}`, () => new T.SphereGeometry(r * 1.025, 14, 8, 0, Math.PI * 2, 0, Math.PI * (shape === 'bob' ? .61 : .45)));
        this.mesh(hair, this.material(hairstyle.color), group);
        if (shape === 'crest') this.box(r * .55, r * .65, r * 1.3, hairstyle.color, 0, r * .85, 0, group);
        for (const side of [-1, 1]) this.sphere(r * .105, 0x2d3c33, side * r * .38, r * .05, r * .93, group, 8);
        const nose = this.sphere(r * .14, skin, 0, -r * .10, r * .99, group, 8); nose.scale.y = .8;
        this.box(r * .24, r * .035, r * .025, 0x9d7054, 0, -r * .34, r * .93, group);
      }
      if (part === 'torso') {
        const { x, y, z } = entity.halfExtents;
        for (const side of [-1, 1]) this.box(x * 1.85, y * .22, .014, uniform.secondary, 0, -y * .72, side * (z + .005), group);
        const number = this.mesh(this.geometry('backnumber', () => new T.PlaneGeometry(.19, .19)),
          this.numberMaterial(school.backnumber[playerId % 3], uniform.secondary), group);
        number.position.set(0, y * .12, -z - .015); number.rotation.y = Math.PI;
        number.castShadow = number.receiveShadow = false;
      }
      if (part.startsWith('lowerLeg')) {
        const rest = entity.restHalfHeight;
        const sock = this.geometry(`sock:${entity.radius}:${rest}`, () =>
          new T.CapsuleGeometry(entity.radius * 1.025, rest * .60, 3, 10)).clone();
        this.geometries.set(`elastic:${entity.id}:sock`, sock);
        const leg = group.userData.legGeometry;
        leg.sockMesh = this.mesh(sock, this.material(uniform.sock), group);
        leg.sock = this.stretchCapsule(sock, rest * .30);
      }
      if (part.startsWith('foot')) {
        const { x, y, z } = entity.halfExtents;
        this.box(x * 1.94, y * .28, z * 1.92, uniform.stripe, 0, -y * .78, 0, group);
        this.box(x * 1.76, y * .80, z * .22, color, 0, y * .12, -z * .77, group);
        for (let i = 0; i < 2; i++) this.box(x * .90, .006, .009, 0xbcc2ac, 0, y + .002, z * (.05 + i * .26), group);
      }
    }
    this.updateLegGeometry(group, entity.halfHeight);
    this.meshes.set(entity.id, group);
    return group;
  }

  /** 시스템의 동작 줄이기 설정. 켜져 있으면 정지·진동 효과를 쓰지 않는다. */
  reducedMotion() {
    return !!this.motionQuery?.matches;
  }

  orbitBy(deltaX, deltaY) {
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;
    const s = this.config.visual.camera.orbit, orbit = this.cameraRig.orbit;
    const yaw = orbit.yaw - deltaX * s.sensitivity;
    orbit.yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    orbit.pitch = Math.max(s.minPitch, Math.min(s.maxPitch, orbit.pitch + deltaY * s.sensitivity));
  }

  resetCamera() {
    const s = this.config.visual.camera;
    this.cameraRig.orbit.yaw = 0;
    this.cameraRig.orbit.pitch = Math.atan2(s.elevation, s.distance);
  }

  screenMovement(right, back, team = this.cameraRig.team) {
    const toward = team === 1 ? -1 : 1, yaw = this.cameraRig.orbit.yaw;
    const length = Math.max(1, Math.hypot(right, back));
    const cosine = Math.cos(yaw), sine = Math.sin(yaw);
    // The local camera turns only the submitted input. World-space movement
    // remains the shared simulation/network contract for both players.
    return { x: (right * sine - back * cosine) * toward / length,
      z: (right * cosine + back * sine) * toward / length };
  }

  updateCamera(viewData, context, dt) {
    const s = this.config.visual.camera, rig = this.cameraRig;
    const mode = context.mode ?? viewData.state?.mode;
    const team = mode === 'local' ? 0 : context.team === 1 ? 1 : 0;
    const toward = team === 0 ? 1 : -1;
    const selected = viewData.state?.selected || [2, 5];
    const player = this.meshes.get(`p${selected[team]}:pelvis`);
    if (!player) return;
    const ball = this.meshes.get('ball');
    const localPair = mode === 'local' ? this.meshes.get(`p${selected[1]}:pelvis`) : null;
    if (localPair) {
      rig.target.copy(player.position).add(localPair.position).multiplyScalar(.5);
    } else {
      rig.target.copy(player.position);
      rig.target.x += toward * s.focusAhead;
    }
    if (ball) {
      rig.target.x += Math.max(-s.maxLateral, Math.min(s.maxLateral, (ball.position.x - rig.target.x) * s.ballWeight));
      rig.target.z += Math.max(-s.maxLateral, Math.min(s.maxLateral, (ball.position.z - rig.target.z) * s.ballWeight));
    }
    // Jump height stays visible against the court: never follow the pelvis or
    // ball vertically. User orbit survives framing, rallies, and viewport changes.
    rig.target.y = s.focusHeight;
    const phase = viewData.state?.phase;
    const snap = !rig.initialized || rig.team !== team || rig.mode !== mode || (phase === 'ready' && rig.phase !== 'ready');
    const blend = snap ? 1 : 1 - Math.exp(-s.follow * dt);
    rig.focus.lerp(rig.target, blend);
    const cosine = Math.cos(rig.orbit.yaw), sine = Math.sin(rig.orbit.yaw);
    const pitchCosine = Math.cos(rig.orbit.pitch);
    rig.offset.set(-toward * cosine * pitchCosine, Math.sin(rig.orbit.pitch), toward * sine * pitchCosine);
    rig.right.set(toward * sine, 0, toward * cosine);
    rig.up.crossVectors(rig.offset, rig.right);
    const tangent = Math.tan(this.camera.fov * Math.PI / 360);
    const topInset = this.width < s.narrowWidth ? s.narrowTopInset : s.topInset;
    const topMargin = Math.max(.2, Math.min(s.frameMargin, 1 - 2 * topInset / this.height));
    let distance = Math.hypot(s.distance, s.elevation);
    const include = (point, radius = 0) => {
      rig.relative.copy(point).sub(rig.focus);
      const depthOffset = rig.relative.dot(rig.offset);
      const horizontal = (Math.abs(rig.relative.dot(rig.right)) + radius) / (tangent * this.camera.aspect * s.frameMargin);
      const projectedHeight = rig.relative.dot(rig.up);
      // Preserve room below the scoreboard and rally notice, especially on
      // short landscape screens, without reducing the lower play area.
      const verticalMargin = projectedHeight > 0 ? topMargin : s.frameMargin;
      const vertical = (Math.abs(projectedHeight) + radius) / (tangent * verticalMargin);
      distance = Math.max(distance, depthOffset + Math.max(horizontal, vertical));
    };
    for (const id of mode === 'local' ? selected : [selected[team]]) {
      const body = this.meshes.get(`p${id}:pelvis`);
      if (body) { rig.target.set(body.position.x, .04, body.position.z); include(rig.target, .38); }
      for (const part of ['head', 'footL', 'footR']) {
        const mesh = this.meshes.get(`p${id}:${part}`);
        if (mesh) include(mesh.position, .23);
      }
    }
    if (ball) include(ball.position, .28);
    for (const side of [-1, 1]) {
      rig.target.set(0, this.config.court.netHeight, side * (this.config.court.halfWidth + .3));
      include(rig.target, .1);
    }
    distance = Math.min(s.maxDistance, distance);
    // Move out promptly to keep incoming balls visible; move back in gently.
    const zoomBlend = snap || distance > rig.distance ? 1 : blend;
    rig.distance += (distance - rig.distance) * zoomBlend;
    this.camera.position.copy(rig.focus).addScaledVector(rig.offset, rig.distance);
    this.camera.lookAt(rig.focus); this.camera.updateMatrixWorld();
    rig.initialized = true; rig.team = team; rig.mode = mode; rig.phase = phase;
  }

  render(presentationFrame, viewData, nowMs, context = {}) {
    if (!viewData) return;
    const dt = Math.min(.05, Math.max(0, (nowMs - this.lastMs) / 1000)); this.lastMs = nowMs;
    for (const entity of viewData.entities) if (!this.meshes.has(entity.id)) this.createEntity(entity);
    const apply = (model, id) => {
      const mesh = this.meshes.get(id); if (!mesh) return;
      mesh.position.set(model.x, model.y, model.z);
      mesh.quaternion.set(model.qx, model.qy, model.qz, model.qw).normalize();
      this.updateLegGeometry(mesh, model.halfHeight);
    };
    if (presentationFrame) presentationFrame.forEach(apply);
    else for (const entity of viewData.entities) apply(entity, entity.id);
    if (this.width !== this.canvas.clientWidth || this.height !== this.canvas.clientHeight) this.resize();
    this.updateCamera(viewData, context, dt);
    this.applyShake();
    this.squashBall();
    this.updateAttackGuides(viewData, context);
    this.updateReceiveGuides(viewData, context);
    const selected = viewData.state?.selected || [2,5];
    for (let i = 0; i < 6; i++) {
      const body = this.meshes.get(`p${i}:pelvis`), head = this.meshes.get(`p${i}:head`), marker = this.playerMarkers[i];
      if (!body) { marker.ring.visible = marker.shadow.visible = marker.arrow.visible = false; continue; }
      const height = Math.max(0, body.position.y - .95);
      marker.shadow.visible = true; marker.shadow.position.x = body.position.x; marker.shadow.position.z = body.position.z;
      marker.shadow.scale.setScalar(1 + Math.min(1.4, height * .15)); marker.shadow.material.opacity = .13 / (1 + height * .3);
      marker.ring.position.x = body.position.x; marker.ring.position.z = body.position.z;
      const human = viewData.state?.mode === 'local' || (i < 3 ? 0 : 1) === this.cameraRig.team;
      marker.ring.visible = human && selected[i < 3 ? 0 : 1] === i;
      marker.arrow.visible = marker.ring.visible;
      if (head) marker.arrow.position.set(head.position.x, head.position.y + .30, head.position.z);
    }
    const ball = this.meshes.get('ball');
    if (ball) {
      const height = Math.max(0, ball.position.y);
      this.ballShadow.position.x = this.ballLocator.position.x = ball.position.x; this.ballShadow.position.z = this.ballLocator.position.z = ball.position.z;
      this.ballShadow.scale.setScalar(1 + Math.min(1, height * .10)); this.ballShadow.material.opacity = .30 / (1 + height * .12);
      this.ballLocator.visible = height > .3;
      this.ballHeight.visible = this.ballHeightTicks.visible = height > .3;
      this.heightData.set([ball.position.x, .057, ball.position.z, ball.position.x, Math.max(.057, height - .13), ball.position.z]);
      this.heightDistances[1] = Math.max(0, height - .187);
      this.heightGeometry.attributes.position.needsUpdate = true; this.heightGeometry.attributes.lineDistance.needsUpdate = true;
      const ticks = Math.min(16, Math.floor((height - .2) / .5));
      for (let i = 0; i < ticks; i++) {
        const y = (i + 1) * .5, offset = i * 6;
        this.heightTickData.set([ball.position.x, y, ball.position.z - .075, ball.position.x, y, ball.position.z + .075], offset);
      }
      this.heightTickGeometry.attributes.position.needsUpdate = true; this.heightTickGeometry.setDrawRange(0, Math.max(0, ticks) * 2);
      this.ballHalo.position.copy(ball.position); this.ballHalo.quaternion.copy(this.camera.quaternion);
      const depth = Math.max(1, this.temp.vector.copy(ball.position).applyMatrix4(this.camera.matrixWorldInverse).z * -1);
      const unitsPerPixel = 2 * depth * Math.tan(this.camera.fov * Math.PI / 360) / this.height;
      const boost = this.impacts.trailBoost();
      this.ballHalo.scale.setScalar(Math.max(1, 7 * unitsPerPixel / .14) * (boost ? 1.8 : 1));
      this.haloMaterial.color.setHex(boost ? boost.color : this.haloBaseColor);
      this.trailMaterial.color.setHex(boost ? boost.color : this.trailBase.color);
      this.trailMaterial.opacity = boost ? 1 : this.trailBase.opacity;
      const distance = ball.position.distanceTo(this.trailLast);
      if (distance > .055) {
        if (distance > 2 || viewData.state?.phase === 'ready' || viewData.state?.phase === 'point') this.trailCount = 0;
        this.trailData.copyWithin(3, 0, this.trailData.length - 3); this.trailData[0] = ball.position.x; this.trailData[1] = ball.position.y; this.trailData[2] = ball.position.z;
        this.trailCount = Math.min(20, this.trailCount + 1); this.trailLast.copy(ball.position);
        this.trailGeometry.attributes.position.needsUpdate = true; this.trailGeometry.setDrawRange(0, this.trailCount);
      }
      this.trail.visible = (viewData.state?.ballSpeed || 0) > 4 && this.trailCount > 1;
    }
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * 맞은 방향으로 공을 눌렀다 되돌린다(외형만). 위치·회전은 물리 값 그대로 두고 월드 축 기준 비균일 스케일만 행렬에 곱한다.
   * 부피를 보존하도록 수직 방향은 1/sqrt(축 방향 스케일)로 늘린다.
   */
  squashBall() {
    const ball = this.meshes.get('ball');
    if (!ball) return;
    const { axis, amount } = this.reducedMotion() ? { axis: null, amount: 0 } : this.impacts.deform();
    if (!amount) { if (!ball.matrixAutoUpdate) { ball.matrixAutoUpdate = true; ball.matrixWorldNeedsUpdate = true; } return; }
    const along = Math.max(.55, 1 - amount), across = 1 / Math.sqrt(along), k = along - across;
    const { x, y, z } = axis;
    // S = across·I + (along - across)·a·aᵀ, 이어서 회전 R, 그 뒤 이동 T
    const s = new this.THREE.Matrix4().set(
      across + k * x * x, k * x * y, k * x * z, 0,
      k * x * y, across + k * y * y, k * y * z, 0,
      k * x * z, k * y * z, across + k * z * z, 0,
      0, 0, 0, 1);
    ball.matrixAutoUpdate = false;
    ball.updateMatrix();
    const rotation = new this.THREE.Matrix4().makeRotationFromQuaternion(ball.quaternion);
    ball.matrix.copy(s).multiply(rotation).setPosition(ball.position);
    ball.matrixWorldNeedsUpdate = true;
  }

  /** 카메라를 화면 평면에서 짧게 흔든다. 위치만 바꾸므로 조준·입력·시뮬레이션에 영향이 없다. */
  applyShake() {
    // 화면 펀치: 시야각을 잠깐 줄여 확대한다. 기준 시야각은 resize가 정한다.
    const fov = this.baseFov * (1 - (this.reducedMotion() ? 0 : this.impacts.punch()));
    if (Math.abs(fov - this.camera.fov) > 1e-4) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    const { x: pixelX, y: pixelY } = this.impacts.shake(this.shakeOffset), rig = this.cameraRig;
    if (!pixelX && !pixelY || this.reducedMotion()) return;
    // px → 월드: 초점 거리에서 한 픽셀이 차지하는 길이. 화면이 달라도 같은 크기로 흔들린다.
    const unitsPerPixel = 2 * rig.distance * Math.tan(this.camera.fov * Math.PI / 360) / this.height;
    this.camera.position.addScaledVector(rig.right, pixelX * unitsPerPixel).addScaledVector(rig.up, pixelY * unitsPerPixel);
    this.camera.updateMatrixWorld();
  }

  resize() {
    const width = Math.max(1, this.canvas.clientWidth || window.innerWidth), height = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    this.width = width; this.height = height;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality === 'low' ? 1 : 1.5));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // A narrow viewport keeps the same horizontal view instead of cutting off
    // the court or backing the camera through the sideline scenery.
    const verticalFov = this.config.visual.camera.fov * Math.PI / 180;
    this.baseFov = 2 * Math.atan(Math.tan(verticalFov / 2) / Math.min(1, this.camera.aspect)) * 180 / Math.PI;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
  }

  setQuality(quality) {
    this.quality = quality === 'low' ? 'low' : 'high';
    this.renderer.shadowMap.enabled = this.quality === 'high';
    this.sun.castShadow = this.quality === 'high';
    this.resize();
  }

  dispose() {
    this.impacts.dispose(); this.field.dispose();
    for (const geometry of this.geometries.values()) geometry.dispose();
    for (const material of this.materials.values()) material.dispose();
    for (const texture of this.textures.values()) texture.dispose();
    this.renderer.dispose(); this.meshes.clear();
  }
}

export { TakrawView };

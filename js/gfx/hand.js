// First-person view model: the held item (or bare arm) drawn in its own
// pass on top of the world.
import * as THREE from '../../vendor/three.module.min.js';
import { ITEMS } from '../data/items.js';
import { makeEntityMaterial } from './materials.js';
import { modelTexture, partGeometry } from './models.js';

export class Hand {
  constructor(gfx) {
    this.gfx = gfx;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.holder = new THREE.Group();
    this.root.add(this.holder);
    this.armMat = makeEntityMaterial(modelTexture('player'));
    this.arm = new THREE.Mesh(partGeometry('player', 'rightArm'), this.armMat);
    this.heldId = -2;
    this.mesh = null;
    this.equip = 1;
    this.prevEquip = 1;
    this.pendingId = -1;
  }

  setAspect(a) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  buildFor(id) {
    if (this.mesh) {
      this.holder.remove(this.mesh);
      if (this.mesh !== this.arm) this.mesh.material.dispose();
    }
    this.heldId = id;
    if (id < 0) {
      this.mesh = this.arm;
      this.holder.add(this.arm);
      return;
    }
    this.mesh = this.gfx.items.createMesh(id);
    this.holder.add(this.mesh);
  }

  // Called every game tick for the equip animation.
  tick(player) {
    const stack = player.inventory.selectedStack();
    const id = stack ? stack.id : -1;
    this.prevEquip = this.equip;
    if (id !== this.heldId) {
      this.equip = Math.max(0, this.equip - 0.4);
      if (this.equip <= 0) this.buildFor(id);
    } else {
      this.equip = Math.min(1, this.equip + 0.4);
    }
  }

  update(game, partial) {
    const p = game.player;
    if (this.heldId === -2) this.buildFor(p.inventory.selectedStack()?.id ?? -1);
    const equip = this.prevEquip + (this.equip - this.prevEquip) * partial;
    const swing = p.swingProgress(partial);
    const sq = Math.sin(swing * swing * Math.PI);
    const sr = Math.sin(Math.sqrt(swing) * Math.PI);
    const h = this.holder;
    h.position.set(0, 0, 0);
    h.rotation.set(0, 0, 0);
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);

    // Walk bob (mirrors the camera bob a little)
    const bob = p.bobAmount(partial);
    const walk = p.walkPhase(partial);
    this.root.position.x += Math.sin(walk * Math.PI) * bob * 0.08;
    this.root.position.y -= Math.abs(Math.cos(walk * Math.PI) * bob) * 0.1;
    // Sway behind camera rotation
    const sway = p.handSway(partial);
    this.root.rotation.x += sway[0] * 0.0025;
    this.root.rotation.y += sway[1] * 0.0025;

    const lowered = (1 - equip) * 0.6;
    const using = p.useAnim(partial);
    const id = this.heldId;
    const def = id >= 0 ? ITEMS[id] : null;

    if (id < 0) {
      // Bare arm, pointing forward from the lower right.
      this.mesh.position.set(0, 0, 0);
      this.mesh.rotation.set(0, 0, 0);
      h.position.set(0.55 - sr * 0.25, -0.62 - lowered + Math.sin(swing * Math.PI * 2) * 0.12, -0.6 - sr * 0.15);
      h.rotation.set(-1.25 + sr * 0.3, 0.35 - sq * 0.4, 0.15 - sq * 0.3);
      h.scale.setScalar(0.9);
    } else if (this.mesh.userData.block) {
      this.mesh.position.set(0, 0, 0);
      this.mesh.rotation.set(0, Math.PI / 4, 0);
      this.mesh.scale.setScalar(1);
      h.position.set(0.52 - sr * 0.3, -0.48 - lowered + Math.sin(swing * Math.PI * 2) * 0.15, -0.78 - sr * 0.1);
      h.rotation.set(-sr * 0.5, -sq * 0.6, -sr * 0.2);
      h.scale.setScalar(0.42);
    } else {
      // Flat item held like a tool.
      const tool = def && (def.tool || def.use === 'bow');
      this.mesh.position.set(0, 0, 0);
      this.mesh.rotation.set(0, -Math.PI / 2 + 0.3, 0.2);
      this.mesh.scale.setScalar(1);
      h.position.set(0.56 - sr * 0.3, -0.42 - lowered + Math.sin(swing * Math.PI * 2) * 0.15, -0.72 - sr * 0.1);
      h.rotation.set(-sr * 0.8, -sq * 0.5, -sr * 0.4);
      h.scale.setScalar(tool ? 0.62 : 0.55);
    }

    if (using) {
      if (using.kind === 'eat') {
        const t = using.t;
        h.position.x -= 0.32 * Math.min(1, t * 4);
        h.position.y += 0.15 * Math.min(1, t * 4) + Math.abs(Math.cos(t * 30)) * 0.04;
        h.rotation.y += 0.6 * Math.min(1, t * 4);
      } else if (using.kind === 'bow') {
        h.position.x -= 0.2;
        h.position.z += 0.1 * using.pull;
        h.rotation.z += 0.3;
        h.position.y += Math.sin(using.pull * 40) * 0.004 * using.pull;
      } else if (using.kind === 'block') {
        h.rotation.z += 0.4;
      }
    }

    // Light at the player's eyes
    const light = game.lightAtPlayer;
    if (this.mesh.material.uniforms.uEntityLight) this.mesh.material.uniforms.uEntityLight.value.set(light[0] / 15, light[1] / 15, 1);
    else this.mesh.material.uniforms.uLight.value.set(light[0] / 15, light[1] / 15);
  }

  render(renderer) {
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}

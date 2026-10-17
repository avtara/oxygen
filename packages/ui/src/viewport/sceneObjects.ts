import * as THREE from 'three';
import { blockColor, collisionBoxes, type Motion } from '@oxygen/scene';
import type { EffectSession } from '../state/session.svelte';

/**
 * Preview-world geometry: blocks (drawn as their collision boxes, tinted by type; passable blocks such as
 * water or plants as translucent cubes) and the entity stand-in with its active locator.
 */
export class SceneObjects {
	readonly group = new THREE.Group();
	private blocks = new THREE.Group();
	private entity = new THREE.Group();
	/** the stand-in entity's box, for clicking it */
	get entityObject(): THREE.Object3D {
		return this.entity;
	}
	private locator: THREE.Mesh;
	/** the entity's waypoint path, when it walks one */
	private path = new THREE.Group();
	private pathKey = '';
	private blocksKey = '';
	private unitBox = new THREE.BoxGeometry(1, 1, 1);
	private pickMeshes: THREE.Object3D[] = [];

	constructor() {
		this.group.add(this.blocks, this.entity);
		// entity: a player-sized box with a nose showing which way it faces
		const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.6, 1.8, 0.6)), new THREE.LineBasicMaterial({ color: 0xdfe5f0, transparent: true, opacity: 0.6 }));
		box.position.y = 0.9;
		const nose = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.25, 12), new THREE.MeshBasicMaterial({ color: 0x93bdf5 }));
		nose.rotation.x = Math.PI / 2;
		nose.position.set(0, 1.62, 0.42);
		this.entity.add(box, nose);
		this.locator = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshBasicMaterial({ color: 0x93bdf5, depthTest: false }));
		this.locator.renderOrder = 15;
		this.group.add(this.locator, this.path);
	}

	private rebuildPath(m: Extract<Motion, { kind: 'path' }>) {
		for (const c of [...this.path.children]) {
			this.path.remove(c);
			const o = c as THREE.Line | THREE.Points;
			o.geometry.dispose();
			(o.material as THREE.Material).dispose();
		}
		const pts = m.points.map((p) => new THREE.Vector3(p[0], p[1] + 0.02, p[2]));
		if (!pts.length) return;
		const line = new (m.ends === 'loop' && pts.length > 2 ? THREE.LineLoop : THREE.Line)(
			new THREE.BufferGeometry().setFromPoints(pts),
			new THREE.LineDashedMaterial({ color: 0x93bdf5, dashSize: 0.25, gapSize: 0.15, transparent: true, opacity: 0.8 }),
		);
		line.computeLineDistances();
		const dots = new THREE.Points(new THREE.BufferGeometry().setFromPoints(pts), new THREE.PointsMaterial({ color: 0x93bdf5, size: 6, sizeAttenuation: false }));
		this.path.add(line, dots);
	}

	/** the entity stand-in, its locator and its path can be hidden (the blocks stay) */
	showEntity = true;

	sync(s: EffectSession): void {
		const key = `${s.id}:${s.blocks.version}`;
		if (key !== this.blocksKey) {
			this.blocksKey = key;
			this.rebuildBlocks(s);
		}
		const onEntity = s.spawnMode === 'entity';
		this.entity.visible = onEntity && this.showEntity;
		this.locator.visible = onEntity && this.showEntity;
		const motion = s.scene.entity.motion;
		this.path.visible = onEntity && this.showEntity && motion.kind === 'path';
		if (this.path.visible && motion.kind === 'path') {
			const key = JSON.stringify(motion);
			if (key !== this.pathKey) {
				this.pathKey = key;
				this.rebuildPath(motion);
			}
		}
		if (onEntity) {
			const e = s.entity;
			this.entity.position.set(e.position[0], e.position[1], e.position[2]);
			this.entity.quaternion.set(...e.rotation);
			const lp = e.locatorPosition(s.scene.entity.locator);
			this.locator.position.set(lp[0], lp[1], lp[2]);
		}
	}

	private rebuildBlocks(s: EffectSession) {
		for (const c of [...this.blocks.children]) {
			this.blocks.remove(c);
			const m = c as THREE.InstancedMesh;
			(m.material as THREE.Material).dispose();
			m.dispose?.();
		}
		this.pickMeshes = [];
		// group instances by (color, translucent)
		const batches = new Map<string, { color: number; translucent: boolean; mats: THREE.Matrix4[] }>();
		const m4 = new THREE.Matrix4();
		for (const [x, y, z, b] of s.blocks.entries()) {
			const boxes = collisionBoxes(b.name, b.states ?? {});
			const translucent = boxes.length === 0;
			const color = blockColor(b.name);
			const k = `${color}:${translucent}`;
			let batch = batches.get(k);
			if (!batch) batches.set(k, (batch = { color, translucent, mats: [] }));
			const list = translucent ? [[0, 0, 0, 1, 1, 1] as const] : boxes;
			for (const bx of list) {
				const sx = bx[3] - bx[0],
					sy = bx[4] - bx[1],
					sz = bx[5] - bx[2];
				m4.makeScale(sx, sy, sz).setPosition(x + bx[0] + sx / 2, y + bx[1] + sy / 2, z + bx[2] + sz / 2);
				batch.mats.push(m4.clone());
			}
		}
		for (const b of batches.values()) {
			const mat = new THREE.MeshLambertMaterial({ color: b.color, transparent: b.translucent, opacity: b.translucent ? 0.35 : 1, depthWrite: !b.translucent });
			const mesh = new THREE.InstancedMesh(this.unitBox, mat, b.mats.length);
			b.mats.forEach((m, i) => mesh.setMatrixAt(i, m));
			mesh.instanceMatrix.needsUpdate = true;
			this.blocks.add(mesh);
			this.pickMeshes.push(mesh);
		}
	}

	/**
	 * Where a click would place a block: the cell next to the hit face of a block, or the cell above the
	 * ground. `remove` returns the clicked block's cell instead.
	 */
	paintTarget(ray: THREE.Raycaster, remove: boolean, groundY = 0): [number, number, number] | null {
		const hits = ray.intersectObjects(this.pickMeshes, false);
		if (hits.length) {
			const h = hits[0];
			const n = h.face?.normal.clone() ?? new THREE.Vector3(0, 1, 0);
			if (h.object instanceof THREE.InstancedMesh && h.instanceId !== undefined) {
				const m = new THREE.Matrix4();
				h.object.getMatrixAt(h.instanceId, m);
				n.transformDirection(m).round();
			}
			const inside = h.point.clone().addScaledVector(n, -0.01);
			const cell = remove ? inside : h.point.clone().addScaledVector(n, 0.5);
			return [Math.floor(cell.x), Math.floor(cell.y), Math.floor(cell.z)];
		}
		if (remove) return null;
		const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -groundY);
		const p = new THREE.Vector3();
		if (!ray.ray.intersectPlane(ground, p)) return null;
		// the first whole cell at or above the ground's surface
		return [Math.floor(p.x), Math.ceil(groundY - 1e-6), Math.floor(p.z)];
	}
}

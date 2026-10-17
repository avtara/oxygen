import * as THREE from 'three';

/**
 * Ground grid drawn in a fragment shader on one quad: block lines, chunk (16-block) lines and the X/Z axes,
 * anti-aliased with screen-space derivatives and faded with distance. Scales by 16× when zoomed far out.
 */
export class GroundGrid {
	readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;

	constructor() {
		const material = new THREE.ShaderMaterial({
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
			uniforms: {
				uCell: { value: 1 },
				uCenter: { value: new THREE.Vector2() },
				uFade: { value: 40 },
				uMinor: { value: new THREE.Color(0x3a4360) },
				uMajor: { value: new THREE.Color(0x56628a) },
				uAxisX: { value: new THREE.Color(0x9a5560) },
				uAxisZ: { value: new THREE.Color(0x52699a) },
			},
			vertexShader: /* glsl */ `
				varying vec3 vWorld;
				void main() {
					vec4 w = modelMatrix * vec4(position, 1.0);
					vWorld = w.xyz;
					gl_Position = projectionMatrix * viewMatrix * w;
				}
			`,
			fragmentShader: /* glsl */ `
				uniform float uCell;
				uniform vec2 uCenter;
				uniform float uFade;
				uniform vec3 uMinor;
				uniform vec3 uMajor;
				uniform vec3 uAxisX;
				uniform vec3 uAxisZ;
				varying vec3 vWorld;

				float lines(vec2 p, float size) {
					vec2 q = p / size;
					vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q);
					return 1.0 - min(min(g.x, g.y), 1.0);
				}

				void main() {
					vec2 p = vWorld.xz;
					float minor = lines(p, uCell);
					float major = lines(p, uCell * 16.0);
					vec2 ax = abs(p) / fwidth(p);
					float onX = 1.0 - min(ax.y, 1.0); // the X axis is the line z = 0
					float onZ = 1.0 - min(ax.x, 1.0);
					float d = length(p - uCenter);
					float fade = 1.0 - smoothstep(uFade * 0.45, uFade, d);
					vec3 col = mix(uMinor, uMajor, major);
					col = mix(col, uAxisX, onX);
					col = mix(col, uAxisZ, onZ);
					float a = max(max(minor * 0.55, major * 0.9), max(onX, onZ)) * fade;
					if (a < 0.01) discard;
					gl_FragColor = vec4(col, a);
				}
			`,
		});
		this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
		this.mesh.rotation.x = -Math.PI / 2;
		this.mesh.renderOrder = -1;
		this.mesh.frustumCulled = false;
	}

	/** Follow the orbit target and distance */
	update(target: THREE.Vector3, distance: number, height = 0): void {
		const u = this.mesh.material.uniforms;
		const cell = distance > 120 ? 16 : 1;
		const fade = Math.max(24, distance * 6);
		u.uCell.value = cell;
		u.uFade.value = fade;
		u.uCenter.value.set(target.x, target.z);
		this.mesh.position.set(target.x, height, target.z);
		this.mesh.scale.set(fade * 2.2, fade * 2.2, 1);
	}
}

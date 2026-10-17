import type { ParticleFacing, Vec3 } from 'wintersky';

const POLE = 0.9999;

function v(a: Vec3, d = 3): string {
	return a.map((n) => (Math.round(n * 10 ** d) / 10 ** d + 0).toString()).join(', ');
}

export interface FacingExplanation {
	/** how the quad is built, in words */
	rule: string;
	/** what happened to the direction on the way */
	steps: string[];
	/** things that make this particle look wrong or vanish */
	warnings: string[];
}

/**
 * What the renderer did to orient one particle, as rules measured in-game (t34–t36):
 * the direction's normalization, the world-up construction or its pole fallback, and rotation.
 */
export function explainFacing(f: ParticleFacing, toCamera: Vec3): FacingExplanation {
	const steps: string[] = [];
	const warnings: string[] = [];
	const d = f.direction;
	const usesDirection = f.mode.startsWith('direction_') || f.mode === 'lookat_direction';
	let rule: string;
	switch (f.mode) {
		case 'rotate_xyz':
			rule = 'Faces the camera plane.';
			break;
		case 'rotate_y':
			rule = 'Faces the camera, turning only about the vertical axis.';
			break;
		case 'lookat_xyz':
			rule = 'Faces the camera position, kept upright toward world up.';
			break;
		case 'lookat_y':
			rule = 'Faces the camera position, turning only about the vertical axis.';
			break;
		case 'lookat_direction':
			rule = f.usedFallback
				? 'X follows the direction; it points straight up or down, so the quad turns about it using the fallback up axis.'
				: 'X follows the direction, and the quad turns about it to face the camera.';
			break;
		case 'direction_x':
			rule = f.usedFallback
				? 'Vertical direction: X follows it and the face is fixed toward −Z.'
				: 'X follows the direction. Y is world up, bent to be perpendicular to it. The face points along X × Y, not along the direction.';
			break;
		case 'direction_y':
			rule = f.usedFallback
				? 'Vertical direction: Y follows it and the face is fixed toward +Z (pointing down draws upside down).'
				: 'Y follows the direction. X is direction × world up, so a horizontal direction makes the quad lie flat, facing up.';
			break;
		case 'direction_z':
			rule = f.usedFallback
				? 'Vertical direction: the face points against the direction and Y is fixed toward +Z.'
				: 'The face points along the direction. Y is world up, bent to be perpendicular to it.';
			break;
		case 'emitter_transform_xy':
			rule = "Fixed to the emitter's XY plane, facing its +Z.";
			break;
		case 'emitter_transform_xz':
			rule = "Fixed to the emitter's XZ plane, facing its +Y.";
			break;
		case 'emitter_transform_yz':
			rule = "Fixed to the emitter's YZ plane, facing its +X.";
			break;
		default:
			rule = f.mode;
	}

	if (usesDirection) {
		if (f.velocity) {
			const { speed, minSpeed, held } = f.velocity;
			steps.push(`Direction from velocity: speed ${speed.toFixed(3)} b/s ${held ? '≤' : '>'} threshold ${minSpeed} b/s${held ? ', so the previous facing is kept' : ''}.`);
		} else steps.push(`Custom direction as evaluated: (${v(f.input)}).`);
		if (d) {
			steps.push(`Normalized: (${v(d)}). |y| = ${Math.abs(d[1]).toFixed(5)}, pole fallback above ${POLE}.`);
			if (!f.usedFallback && Math.abs(d[1]) > 0.98) warnings.push('Nearly vertical: a little more and the axes snap to the fixed pole orientation.');
		}
		if (f.degenerate) warnings.push(f.velocity ? 'No direction yet (the particle never moved faster than the threshold): the quad collapses and nothing is drawn.' : 'The direction is zero: the quad collapses and nothing is drawn.');
	}
	if (!f.degenerate) {
		steps.push(`Axes after rotation: X (${v(f.rotatedRight)}), Y (${v(f.rotatedUp)}), face (${v(f.normal)}).`);
		const facing = f.normal[0] * toCamera[0] + f.normal[1] * toCamera[1] + f.normal[2] * toCamera[2];
		if (facing < 0) warnings.push('The camera sees the back of this quad. Particles are one-sided, so it is not drawn from here.');
	}
	return { rule, steps, warnings };
}

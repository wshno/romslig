import * as THREE from 'three'

/**
 * How far from `target` a camera looking at it from the direction `dir` must be for the whole box to be in view.
 * `fov` is the vertical field of view in degrees and `aspect` is width / height of the view.
 */
export function distanceToFit(
  box: THREE.Box3,
  target: THREE.Vector3,
  dir: THREE.Vector3,
  fov: number,
  aspect: number,
): number {
  const back = dir.clone().normalize()
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), back).normalize()
  const up = new THREE.Vector3().crossVectors(back, right)
  const tanV = Math.tan(THREE.MathUtils.degToRad(fov) / 2)
  const tanH = tanV * aspect
  let distance = 0
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) {
        const p = new THREE.Vector3(x, y, z).sub(target)
        // A corner at depth (distance - p·back) is in view when it is inside both pairs of frustum sides
        const along = p.dot(back)
        distance = Math.max(distance, along + Math.abs(p.dot(right)) / tanH, along + Math.abs(p.dot(up)) / tanV)
      }
  return distance
}

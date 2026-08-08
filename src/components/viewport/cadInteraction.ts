/**
 * Small, renderer-free 3D interaction kernel for the native CAD viewport.
 *
 * This module intentionally owns only the pieces that the React interaction
 * layer needs: vectors/matrices, a perspective camera, a lightweight object
 * hierarchy, CPU ray queries, and an input-only canvas. Bevy owns every
 * visible viewport pixel; this file never creates a WebGL context.
 */

import { triangulateProfileRegion } from './profileTriangulation';

export const DoubleSide = 2;

export enum MOUSE {
  ROTATE = 0,
  DOLLY = 1,
  PAN = 2,
}

export const MathUtils = {
  clamp: (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value)),
  degToRad: (degrees: number) => (degrees * Math.PI) / 180,
  radToDeg: (radians: number) => (radians * 180) / Math.PI,
};

export class Vector2 {
  constructor(
    public x = 0,
    public y = 0,
  ) {}

  set(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }

  copy(other: Vector2): this {
    return this.set(other.x, other.y);
  }

  clone(): Vector2 {
    return new Vector2(this.x, this.y);
  }
}

export class Spherical {
  constructor(
    public radius = 1,
    public phi = 0,
    public theta = 0,
  ) {}

  setFromVector3(vector: Vector3): this {
    this.radius = vector.length();
    if (this.radius === 0) {
      this.theta = 0;
      this.phi = 0;
    } else {
      this.theta = Math.atan2(vector.x, vector.z);
      this.phi = Math.acos(MathUtils.clamp(vector.y / this.radius, -1, 1));
    }
    return this;
  }

  makeSafe(): this {
    const epsilon = 1e-6;
    this.phi = Math.max(epsilon, Math.min(Math.PI - epsilon, this.phi));
    return this;
  }
}

export class Vector3 {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
  ) {}

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  setScalar(value: number): this {
    return this.set(value, value, value);
  }

  copy(other: Vector3): this {
    return this.set(other.x, other.y, other.z);
  }

  clone(): Vector3 {
    return new Vector3(this.x, this.y, this.z);
  }

  fromArray(values: ArrayLike<number>, offset = 0): this {
    return this.set(
      values[offset] ?? 0,
      values[offset + 1] ?? 0,
      values[offset + 2] ?? 0,
    );
  }

  toArray(array: number[] = [], offset = 0): number[] {
    array[offset] = this.x;
    array[offset + 1] = this.y;
    array[offset + 2] = this.z;
    return array;
  }

  add(other: Vector3): this {
    this.x += other.x;
    this.y += other.y;
    this.z += other.z;
    return this;
  }

  addVectors(a: Vector3, b: Vector3): this {
    return this.set(a.x + b.x, a.y + b.y, a.z + b.z);
  }

  addScaledVector(other: Vector3, scale: number): this {
    this.x += other.x * scale;
    this.y += other.y * scale;
    this.z += other.z * scale;
    return this;
  }

  sub(other: Vector3): this {
    this.x -= other.x;
    this.y -= other.y;
    this.z -= other.z;
    return this;
  }

  subVectors(a: Vector3, b: Vector3): this {
    return this.set(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  multiplyScalar(scale: number): this {
    this.x *= scale;
    this.y *= scale;
    this.z *= scale;
    return this;
  }

  divideScalar(scale: number): this {
    return this.multiplyScalar(scale === 0 ? 0 : 1 / scale);
  }

  dot(other: Vector3): number {
    return this.x * other.x + this.y * other.y + this.z * other.z;
  }

  cross(other: Vector3): this {
    return this.crossVectors(this, other);
  }

  crossVectors(a: Vector3, b: Vector3): this {
    const ax = a.x;
    const ay = a.y;
    const az = a.z;
    const bx = b.x;
    const by = b.y;
    const bz = b.z;
    return this.set(
      ay * bz - az * by,
      az * bx - ax * bz,
      ax * by - ay * bx,
    );
  }

  lengthSq(): number {
    return this.dot(this);
  }

  length(): number {
    return Math.sqrt(this.lengthSq());
  }

  normalize(): this {
    const length = this.length();
    return length > 0 ? this.divideScalar(length) : this;
  }

  setLength(length: number): this {
    const current = this.length();
    return current > 0 ? this.multiplyScalar(length / current) : this;
  }

  distanceToSquared(other: Vector3): number {
    const dx = this.x - other.x;
    const dy = this.y - other.y;
    const dz = this.z - other.z;
    return dx * dx + dy * dy + dz * dz;
  }

  distanceTo(other: Vector3): number {
    return Math.sqrt(this.distanceToSquared(other));
  }

  lerp(other: Vector3, alpha: number): this {
    this.x += (other.x - this.x) * alpha;
    this.y += (other.y - this.y) * alpha;
    this.z += (other.z - this.z) * alpha;
    return this;
  }

  lerpVectors(a: Vector3, b: Vector3, alpha: number): this {
    return this.copy(a).lerp(b, alpha);
  }

  applyQuaternion(quaternion: Quaternion): this {
    const x = this.x;
    const y = this.y;
    const z = this.z;
    const qx = quaternion.x;
    const qy = quaternion.y;
    const qz = quaternion.z;
    const qw = quaternion.w;

    const ix = qw * x + qy * z - qz * y;
    const iy = qw * y + qz * x - qx * z;
    const iz = qw * z + qx * y - qy * x;
    const iw = -qx * x - qy * y - qz * z;

    return this.set(
      ix * qw + iw * -qx + iy * -qz - iz * -qy,
      iy * qw + iw * -qy + iz * -qx - ix * -qz,
      iz * qw + iw * -qz + ix * -qy - iy * -qx,
    );
  }

  applyMatrix4(matrix: Matrix4): this {
    const elements = matrix.elements;
    const x = this.x;
    const y = this.y;
    const z = this.z;
    const w =
      1 /
      (elements[3] * x +
        elements[7] * y +
        elements[11] * z +
        elements[15]);
    return this.set(
      (elements[0] * x +
        elements[4] * y +
        elements[8] * z +
        elements[12]) *
        w,
      (elements[1] * x +
        elements[5] * y +
        elements[9] * z +
        elements[13]) *
        w,
      (elements[2] * x +
        elements[6] * y +
        elements[10] * z +
        elements[14]) *
        w,
    );
  }

  transformDirection(matrix: Matrix4): this {
    const elements = matrix.elements;
    const x = this.x;
    const y = this.y;
    const z = this.z;
    return this.set(
      elements[0] * x + elements[4] * y + elements[8] * z,
      elements[1] * x + elements[5] * y + elements[9] * z,
      elements[2] * x + elements[6] * y + elements[10] * z,
    ).normalize();
  }

  project(camera: PerspectiveCamera): this {
    camera.updateMatrixWorld(true);
    return this.applyMatrix4(camera.matrixWorldInverse).applyMatrix4(
      camera.projectionMatrix,
    );
  }

  setFromSpherical(spherical: Spherical): this {
    const sinPhiRadius = Math.sin(spherical.phi) * spherical.radius;
    return this.set(
      sinPhiRadius * Math.sin(spherical.theta),
      Math.cos(spherical.phi) * spherical.radius,
      sinPhiRadius * Math.cos(spherical.theta),
    );
  }
}

export class Euler {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
  ) {}

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
}

export class Quaternion {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
    public w = 1,
  ) {}

  set(x: number, y: number, z: number, w: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    return this;
  }

  copy(other: Quaternion): this {
    return this.set(other.x, other.y, other.z, other.w);
  }

  clone(): Quaternion {
    return new Quaternion(this.x, this.y, this.z, this.w);
  }

  toArray(): [number, number, number, number] {
    return [this.x, this.y, this.z, this.w];
  }

  normalize(): this {
    const length = Math.hypot(this.x, this.y, this.z, this.w);
    if (length === 0) return this.set(0, 0, 0, 1);
    const inverse = 1 / length;
    return this.set(
      this.x * inverse,
      this.y * inverse,
      this.z * inverse,
      this.w * inverse,
    );
  }

  invert(): this {
    this.x *= -1;
    this.y *= -1;
    this.z *= -1;
    return this.normalize();
  }

  multiply(other: Quaternion): this {
    return this.multiplyQuaternions(this, other);
  }

  premultiply(other: Quaternion): this {
    return this.multiplyQuaternions(other, this);
  }

  multiplyQuaternions(a: Quaternion, b: Quaternion): this {
    const qax = a.x;
    const qay = a.y;
    const qaz = a.z;
    const qaw = a.w;
    const qbx = b.x;
    const qby = b.y;
    const qbz = b.z;
    const qbw = b.w;
    return this.set(
      qax * qbw + qaw * qbx + qay * qbz - qaz * qby,
      qay * qbw + qaw * qby + qaz * qbx - qax * qbz,
      qaz * qbw + qaw * qbz + qax * qby - qay * qbx,
      qaw * qbw - qax * qbx - qay * qby - qaz * qbz,
    );
  }

  setFromAxisAngle(axis: Vector3, angle: number): this {
    const half = angle / 2;
    const sine = Math.sin(half);
    return this.set(axis.x * sine, axis.y * sine, axis.z * sine, Math.cos(half));
  }

  setFromEuler(euler: Euler): this {
    const c1 = Math.cos(euler.x / 2);
    const c2 = Math.cos(euler.y / 2);
    const c3 = Math.cos(euler.z / 2);
    const s1 = Math.sin(euler.x / 2);
    const s2 = Math.sin(euler.y / 2);
    const s3 = Math.sin(euler.z / 2);
    return this.set(
      s1 * c2 * c3 + c1 * s2 * s3,
      c1 * s2 * c3 - s1 * c2 * s3,
      c1 * c2 * s3 + s1 * s2 * c3,
      c1 * c2 * c3 - s1 * s2 * s3,
    );
  }

  setFromUnitVectors(from: Vector3, to: Vector3): this {
    let r = from.dot(to) + 1;
    if (r < 1e-7) {
      r = 0;
      if (Math.abs(from.x) > Math.abs(from.z)) {
        this.set(-from.y, from.x, 0, r);
      } else {
        this.set(0, -from.z, from.y, r);
      }
    } else {
      const cross = new Vector3().crossVectors(from, to);
      this.set(cross.x, cross.y, cross.z, r);
    }
    return this.normalize();
  }

  setFromRotationMatrix(matrix: Matrix4): this {
    const te = matrix.elements;
    const m11 = te[0];
    const m12 = te[4];
    const m13 = te[8];
    const m21 = te[1];
    const m22 = te[5];
    const m23 = te[9];
    const m31 = te[2];
    const m32 = te[6];
    const m33 = te[10];
    const trace = m11 + m22 + m33;

    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1);
      this.w = 0.25 / s;
      this.x = (m32 - m23) * s;
      this.y = (m13 - m31) * s;
      this.z = (m21 - m12) * s;
    } else if (m11 > m22 && m11 > m33) {
      const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
      this.w = (m32 - m23) / s;
      this.x = 0.25 * s;
      this.y = (m12 + m21) / s;
      this.z = (m13 + m31) / s;
    } else if (m22 > m33) {
      const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
      this.w = (m13 - m31) / s;
      this.x = (m12 + m21) / s;
      this.y = 0.25 * s;
      this.z = (m23 + m32) / s;
    } else {
      const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
      this.w = (m21 - m12) / s;
      this.x = (m13 + m31) / s;
      this.y = (m23 + m32) / s;
      this.z = 0.25 * s;
    }
    return this.normalize();
  }
}

export class Matrix4 {
  elements: number[];

  constructor() {
    this.elements = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
  }

  identity(): this {
    return this.set(
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    );
  }

  set(
    n11: number,
    n12: number,
    n13: number,
    n14: number,
    n21: number,
    n22: number,
    n23: number,
    n24: number,
    n31: number,
    n32: number,
    n33: number,
    n34: number,
    n41: number,
    n42: number,
    n43: number,
    n44: number,
  ): this {
    const te = this.elements;
    te[0] = n11;
    te[4] = n12;
    te[8] = n13;
    te[12] = n14;
    te[1] = n21;
    te[5] = n22;
    te[9] = n23;
    te[13] = n24;
    te[2] = n31;
    te[6] = n32;
    te[10] = n33;
    te[14] = n34;
    te[3] = n41;
    te[7] = n42;
    te[11] = n43;
    te[15] = n44;
    return this;
  }

  copy(other: Matrix4): this {
    this.elements = [...other.elements];
    return this;
  }

  clone(): Matrix4 {
    return new Matrix4().copy(this);
  }

  fromArray(values: ArrayLike<number>, offset = 0): this {
    for (let index = 0; index < 16; index += 1) {
      this.elements[index] = values[offset + index] ?? (index % 5 === 0 ? 1 : 0);
    }
    return this;
  }

  toArray(array: number[] = [], offset = 0): number[] {
    for (let index = 0; index < 16; index += 1) {
      array[offset + index] = this.elements[index];
    }
    return array;
  }

  multiply(other: Matrix4): this {
    return this.multiplyMatrices(this, other);
  }

  premultiply(other: Matrix4): this {
    return this.multiplyMatrices(other, this);
  }

  multiplyMatrices(a: Matrix4, b: Matrix4): this {
    const ae = a.elements;
    const be = b.elements;
    const te = this.elements;
    const result = new Array<number>(16);
    for (let column = 0; column < 4; column += 1) {
      for (let row = 0; row < 4; row += 1) {
        let value = 0;
        for (let inner = 0; inner < 4; inner += 1) {
          value += ae[inner * 4 + row] * be[column * 4 + inner];
        }
        result[column * 4 + row] = value;
      }
    }
    for (let index = 0; index < 16; index += 1) te[index] = result[index];
    return this;
  }

  makeBasis(xAxis: Vector3, yAxis: Vector3, zAxis: Vector3): this {
    return this.set(
      xAxis.x, yAxis.x, zAxis.x, 0,
      xAxis.y, yAxis.y, zAxis.y, 0,
      xAxis.z, yAxis.z, zAxis.z, 0,
      0, 0, 0, 1,
    );
  }

  compose(position: Vector3, quaternion: Quaternion, scale: Vector3): this {
    const x = quaternion.x;
    const y = quaternion.y;
    const z = quaternion.z;
    const w = quaternion.w;
    const x2 = x + x;
    const y2 = y + y;
    const z2 = z + z;
    const xx = x * x2;
    const xy = x * y2;
    const xz = x * z2;
    const yy = y * y2;
    const yz = y * z2;
    const zz = z * z2;
    const wx = w * x2;
    const wy = w * y2;
    const wz = w * z2;
    const sx = scale.x;
    const sy = scale.y;
    const sz = scale.z;
    const te = this.elements;

    te[0] = (1 - (yy + zz)) * sx;
    te[1] = (xy + wz) * sx;
    te[2] = (xz - wy) * sx;
    te[3] = 0;
    te[4] = (xy - wz) * sy;
    te[5] = (1 - (xx + zz)) * sy;
    te[6] = (yz + wx) * sy;
    te[7] = 0;
    te[8] = (xz + wy) * sz;
    te[9] = (yz - wx) * sz;
    te[10] = (1 - (xx + yy)) * sz;
    te[11] = 0;
    te[12] = position.x;
    te[13] = position.y;
    te[14] = position.z;
    te[15] = 1;
    return this;
  }

  decompose(position: Vector3, quaternion: Quaternion, scale: Vector3): this {
    const te = this.elements;
    let sx = new Vector3(te[0], te[1], te[2]).length();
    const sy = new Vector3(te[4], te[5], te[6]).length();
    const sz = new Vector3(te[8], te[9], te[10]).length();
    const determinant = this.determinant();
    if (determinant < 0) sx = -sx;
    position.set(te[12], te[13], te[14]);
    scale.set(sx, sy, sz);
    const rotation = this.clone();
    const inverseSx = sx === 0 ? 0 : 1 / sx;
    const inverseSy = sy === 0 ? 0 : 1 / sy;
    const inverseSz = sz === 0 ? 0 : 1 / sz;
    rotation.elements[0] *= inverseSx;
    rotation.elements[1] *= inverseSx;
    rotation.elements[2] *= inverseSx;
    rotation.elements[4] *= inverseSy;
    rotation.elements[5] *= inverseSy;
    rotation.elements[6] *= inverseSy;
    rotation.elements[8] *= inverseSz;
    rotation.elements[9] *= inverseSz;
    rotation.elements[10] *= inverseSz;
    quaternion.setFromRotationMatrix(rotation);
    return this;
  }

  determinant(): number {
    const te = this.elements;
    const n11 = te[0];
    const n12 = te[4];
    const n13 = te[8];
    const n14 = te[12];
    const n21 = te[1];
    const n22 = te[5];
    const n23 = te[9];
    const n24 = te[13];
    const n31 = te[2];
    const n32 = te[6];
    const n33 = te[10];
    const n34 = te[14];
    const n41 = te[3];
    const n42 = te[7];
    const n43 = te[11];
    const n44 = te[15];
    return (
      n41 *
        (+n14 * n23 * n32 -
          n13 * n24 * n32 -
          n14 * n22 * n33 +
          n12 * n24 * n33 +
          n13 * n22 * n34 -
          n12 * n23 * n34) +
      n42 *
        (+n11 * n23 * n34 -
          n11 * n24 * n33 +
          n14 * n21 * n33 -
          n13 * n21 * n34 +
          n13 * n24 * n31 -
          n14 * n23 * n31) +
      n43 *
        (+n11 * n24 * n32 -
          n11 * n22 * n34 -
          n14 * n21 * n32 +
          n12 * n21 * n34 +
          n14 * n22 * n31 -
          n12 * n24 * n31) +
      n44 *
        (-n13 * n22 * n31 -
          n11 * n23 * n32 +
          n11 * n22 * n33 +
          n13 * n21 * n32 -
          n12 * n21 * n33 +
          n12 * n23 * n31)
    );
  }

  invert(): this {
    const te = this.elements;
    const n11 = te[0];
    const n21 = te[1];
    const n31 = te[2];
    const n41 = te[3];
    const n12 = te[4];
    const n22 = te[5];
    const n32 = te[6];
    const n42 = te[7];
    const n13 = te[8];
    const n23 = te[9];
    const n33 = te[10];
    const n43 = te[11];
    const n14 = te[12];
    const n24 = te[13];
    const n34 = te[14];
    const n44 = te[15];

    const t11 =
      n23 * n34 * n42 -
      n24 * n33 * n42 +
      n24 * n32 * n43 -
      n22 * n34 * n43 -
      n23 * n32 * n44 +
      n22 * n33 * n44;
    const t12 =
      n14 * n33 * n42 -
      n13 * n34 * n42 -
      n14 * n32 * n43 +
      n12 * n34 * n43 +
      n13 * n32 * n44 -
      n12 * n33 * n44;
    const t13 =
      n13 * n24 * n42 -
      n14 * n23 * n42 +
      n14 * n22 * n43 -
      n12 * n24 * n43 -
      n13 * n22 * n44 +
      n12 * n23 * n44;
    const t14 =
      n14 * n23 * n32 -
      n13 * n24 * n32 -
      n14 * n22 * n33 +
      n12 * n24 * n33 +
      n13 * n22 * n34 -
      n12 * n23 * n34;
    const determinant = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
    if (determinant === 0) return this.identity();
    const inverse = 1 / determinant;

    te[0] = t11 * inverse;
    te[1] =
      (n24 * n33 * n41 -
        n23 * n34 * n41 -
        n24 * n31 * n43 +
        n21 * n34 * n43 +
        n23 * n31 * n44 -
        n21 * n33 * n44) *
      inverse;
    te[2] =
      (n22 * n34 * n41 -
        n24 * n32 * n41 +
        n24 * n31 * n42 -
        n21 * n34 * n42 -
        n22 * n31 * n44 +
        n21 * n32 * n44) *
      inverse;
    te[3] =
      (n23 * n32 * n41 -
        n22 * n33 * n41 -
        n23 * n31 * n42 +
        n21 * n33 * n42 +
        n22 * n31 * n43 -
        n21 * n32 * n43) *
      inverse;
    te[4] = t12 * inverse;
    te[5] =
      (n13 * n34 * n41 -
        n14 * n33 * n41 +
        n14 * n31 * n43 -
        n11 * n34 * n43 -
        n13 * n31 * n44 +
        n11 * n33 * n44) *
      inverse;
    te[6] =
      (n14 * n32 * n41 -
        n12 * n34 * n41 -
        n14 * n31 * n42 +
        n11 * n34 * n42 +
        n12 * n31 * n44 -
        n11 * n32 * n44) *
      inverse;
    te[7] =
      (n12 * n33 * n41 -
        n13 * n32 * n41 +
        n13 * n31 * n42 -
        n11 * n33 * n42 -
        n12 * n31 * n43 +
        n11 * n32 * n43) *
      inverse;
    te[8] = t13 * inverse;
    te[9] =
      (n14 * n23 * n41 -
        n13 * n24 * n41 -
        n14 * n21 * n43 +
        n11 * n24 * n43 +
        n13 * n21 * n44 -
        n11 * n23 * n44) *
      inverse;
    te[10] =
      (n12 * n24 * n41 -
        n14 * n22 * n41 +
        n14 * n21 * n42 -
        n11 * n24 * n42 -
        n12 * n21 * n44 +
        n11 * n22 * n44) *
      inverse;
    te[11] =
      (n13 * n22 * n41 -
        n12 * n23 * n41 -
        n13 * n21 * n42 +
        n11 * n23 * n42 +
        n12 * n21 * n43 -
        n11 * n22 * n43) *
      inverse;
    te[12] = t14 * inverse;
    te[13] =
      (n13 * n24 * n31 -
        n14 * n23 * n31 +
        n14 * n21 * n33 -
        n11 * n24 * n33 -
        n13 * n21 * n34 +
        n11 * n23 * n34) *
      inverse;
    te[14] =
      (n14 * n22 * n31 -
        n12 * n24 * n31 -
        n14 * n21 * n32 +
        n11 * n24 * n32 +
        n12 * n21 * n34 -
        n11 * n22 * n34) *
      inverse;
    te[15] =
      (n12 * n23 * n31 -
        n13 * n22 * n31 +
        n13 * n21 * n32 -
        n11 * n23 * n32 -
        n12 * n21 * n33 +
        n11 * n22 * n33) *
      inverse;
    return this;
  }

  makePerspective(
    fovDegrees: number,
    aspect: number,
    near: number,
    far: number,
  ): this {
    const top = near * Math.tan(MathUtils.degToRad(fovDegrees) / 2);
    const height = 2 * top;
    const width = aspect * height;
    const left = -width / 2;
    const right = left + width;
    const bottom = top - height;
    const x = (2 * near) / (right - left);
    const y = (2 * near) / (top - bottom);
    const a = (right + left) / (right - left);
    const b = (top + bottom) / (top - bottom);
    const c = -(far + near) / (far - near);
    const d = (-2 * far * near) / (far - near);
    return this.set(
      x, 0, a, 0,
      0, y, b, 0,
      0, 0, c, d,
      0, 0, -1, 0,
    );
  }
}

export class Color {
  private value = 0xffffff;

  constructor(value: number | string | Color = 0xffffff) {
    this.set(value);
  }

  set(value: number | string | Color): this {
    if (value instanceof Color) return this.setHex(value.getHex());
    if (typeof value === 'number') return this.setHex(value);
    const text = value.trim().toLowerCase();
    if (text.startsWith('#')) {
      const digits = text.slice(1);
      if (digits.length === 3) {
        return this.setHex(
          Number.parseInt(
            `${digits[0]}${digits[0]}${digits[1]}${digits[1]}${digits[2]}${digits[2]}`,
            16,
          ),
        );
      }
      if (digits.length >= 6) {
        return this.setHex(Number.parseInt(digits.slice(0, 6), 16));
      }
    }
    const rgb = text.match(
      /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/,
    );
    if (rgb) {
      return this.setHex(
        (MathUtils.clamp(Math.round(Number(rgb[1])), 0, 255) << 16) |
          (MathUtils.clamp(Math.round(Number(rgb[2])), 0, 255) << 8) |
          MathUtils.clamp(Math.round(Number(rgb[3])), 0, 255),
      );
    }
    return this;
  }

  setHex(value: number): this {
    this.value = Math.max(0, Math.min(0xffffff, Math.round(value))) >>> 0;
    return this;
  }

  getHex(): number {
    return this.value;
  }

  getHexString(): string {
    return this.value.toString(16).padStart(6, '0');
  }

  get r(): number {
    return ((this.value >> 16) & 0xff) / 255;
  }

  get g(): number {
    return ((this.value >> 8) & 0xff) / 255;
  }

  get b(): number {
    return (this.value & 0xff) / 255;
  }
}

let objectId = 1;

export class Object3D {
  readonly id = objectId++;
  name = '';
  parent: Object3D | null = null;
  children: Object3D[] = [];
  position = new Vector3();
  rotation = new Euler();
  quaternion = new Quaternion();
  scale = new Vector3(1, 1, 1);
  matrix = new Matrix4();
  matrixWorld = new Matrix4();
  visible = true;
  renderOrder = 0;
  userData: Record<string, unknown> = {};

  add(...objects: Object3D[]): this {
    for (const object of objects) {
      if (object === this) continue;
      object.parent?.remove(object);
      object.parent = this;
      this.children.push(object);
    }
    return this;
  }

  remove(...objects: Object3D[]): this {
    for (const object of objects) {
      const index = this.children.indexOf(object);
      if (index < 0) continue;
      this.children.splice(index, 1);
      object.parent = null;
    }
    return this;
  }

  clear(): this {
    return this.remove(...this.children);
  }

  traverse(callback: (object: Object3D) => void): void {
    callback(this);
    for (const child of this.children) child.traverse(callback);
  }

  traverseVisible(callback: (object: Object3D) => void): void {
    if (!this.visible) return;
    callback(this);
    for (const child of this.children) child.traverseVisible(callback);
  }

  rotateX(angle: number): this {
    this.quaternion.multiply(
      new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), angle),
    );
    return this;
  }

  updateMatrix(): void {
    const effective = this.quaternion.clone();
    if (
      this.rotation.x !== 0 ||
      this.rotation.y !== 0 ||
      this.rotation.z !== 0
    ) {
      effective.multiply(new Quaternion().setFromEuler(this.rotation));
    }
    this.matrix.compose(this.position, effective, this.scale);
  }

  updateMatrixWorld(_force = false): void {
    this.updateMatrix();
    if (this.parent) {
      this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
    } else {
      this.matrixWorld.copy(this.matrix);
    }
    for (const child of this.children) child.updateMatrixWorld(_force);
  }

  updateWorldMatrix(updateParents: boolean, updateChildren: boolean): void {
    if (updateParents && this.parent) {
      this.parent.updateWorldMatrix(true, false);
    }
    this.updateMatrix();
    if (this.parent) {
      this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
    } else {
      this.matrixWorld.copy(this.matrix);
    }
    if (updateChildren) {
      for (const child of this.children) child.updateWorldMatrix(false, true);
    }
  }

  localToWorld(vector: Vector3): Vector3 {
    this.updateWorldMatrix(true, false);
    return vector.applyMatrix4(this.matrixWorld);
  }

  worldToLocal(vector: Vector3): Vector3 {
    this.updateWorldMatrix(true, false);
    return vector.applyMatrix4(this.matrixWorld.clone().invert());
  }

  getWorldPosition(target: Vector3): Vector3 {
    this.updateWorldMatrix(true, false);
    return target.set(
      this.matrixWorld.elements[12],
      this.matrixWorld.elements[13],
      this.matrixWorld.elements[14],
    );
  }
}

export class Group extends Object3D {}
export class Scene extends Group {}

export class PerspectiveCamera extends Object3D {
  up = new Vector3(0, 1, 0);
  projectionMatrix = new Matrix4();
  matrixWorldInverse = new Matrix4();

  constructor(
    public fov = 50,
    public aspect = 1,
    public near = 0.1,
    public far = 2000,
  ) {
    super();
    this.updateProjectionMatrix();
  }

  updateProjectionMatrix(): void {
    this.projectionMatrix.makePerspective(
      this.fov,
      Math.max(1e-9, this.aspect),
      this.near,
      this.far,
    );
  }

  lookAt(target: Vector3): void {
    const z = this.position.clone().sub(target).normalize();
    if (z.lengthSq() < 1e-12) z.z = 1;
    let x = new Vector3().crossVectors(this.up, z).normalize();
    if (x.lengthSq() < 1e-12) {
      z.x += 1e-6;
      x = new Vector3().crossVectors(this.up, z).normalize();
    }
    const y = new Vector3().crossVectors(z, x).normalize();
    this.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
    this.rotation.set(0, 0, 0);
    this.updateMatrixWorld(true);
  }

  override updateMatrixWorld(force = false): void {
    super.updateMatrixWorld(force);
    this.matrixWorldInverse.copy(this.matrixWorld).invert();
  }

  override updateWorldMatrix(
    updateParents: boolean,
    updateChildren: boolean,
  ): void {
    super.updateWorldMatrix(updateParents, updateChildren);
    this.matrixWorldInverse.copy(this.matrixWorld).invert();
  }
}

export class HemisphereLight extends Object3D {
  constructor(
    public skyColor: number | Color,
    public groundColor: number | Color,
    public intensity = 1,
  ) {
    super();
  }
}

export class DirectionalLight extends Object3D {
  constructor(
    public color: number | Color,
    public intensity = 1,
  ) {
    super();
  }
}

export class BufferAttribute {
  readonly count: number;

  constructor(
    public array: ArrayLike<number>,
    public itemSize: number,
  ) {
    this.count = Math.floor(array.length / itemSize);
  }

  getX(index: number): number {
    return this.array[index * this.itemSize] ?? 0;
  }

  getY(index: number): number {
    return this.array[index * this.itemSize + 1] ?? 0;
  }

  getZ(index: number): number {
    return this.array[index * this.itemSize + 2] ?? 0;
  }
}

export class Float32BufferAttribute extends BufferAttribute {
  constructor(values: Iterable<number> | ArrayLike<number>, itemSize: number) {
    super(Float32Array.from(values as Iterable<number>), itemSize);
  }
}

export class Sphere {
  constructor(
    public center = new Vector3(),
    public radius = -1,
  ) {}
}

export class Box3 {
  min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);

  makeEmpty(): this {
    this.min.set(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    this.max.set(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
    return this;
  }

  isEmpty(): boolean {
    return (
      this.max.x < this.min.x ||
      this.max.y < this.min.y ||
      this.max.z < this.min.z
    );
  }

  expandByPoint(point: Vector3): this {
    this.min.x = Math.min(this.min.x, point.x);
    this.min.y = Math.min(this.min.y, point.y);
    this.min.z = Math.min(this.min.z, point.z);
    this.max.x = Math.max(this.max.x, point.x);
    this.max.y = Math.max(this.max.y, point.y);
    this.max.z = Math.max(this.max.z, point.z);
    return this;
  }

  union(other: Box3): this {
    if (other.isEmpty()) return this;
    this.expandByPoint(other.min);
    this.expandByPoint(other.max);
    return this;
  }

  setFromObject(object: Object3D, precise = false): this {
    void precise;
    this.makeEmpty();
    object.updateWorldMatrix(true, true);
    object.traverseVisible((child) => {
      const geometry = geometryOf(child);
      if (!geometry) return;
      for (const attributeName of ['position', 'instanceStart', 'instanceEnd']) {
        const positions = geometry.getAttribute(attributeName);
        if (!positions) continue;
        for (let index = 0; index < positions.count; index += 1) {
          this.expandByPoint(
            new Vector3(
              positions.getX(index),
              positions.getY(index),
              positions.getZ(index),
            ).applyMatrix4(child.matrixWorld),
          );
        }
      }
    });
    return this;
  }

  getBoundingSphere(target: Sphere): Sphere {
    if (this.isEmpty()) {
      target.center.set(0, 0, 0);
      target.radius = 0;
      return target;
    }
    target.center
      .addVectors(this.min, this.max)
      .multiplyScalar(0.5);
    target.radius = target.center.distanceTo(this.max);
    return target;
  }
}

export class BufferGeometry {
  protected attributes = new Map<string, BufferAttribute>();
  boundingBox: Box3 | null = null;
  boundingSphere: Sphere | null = null;

  setAttribute(name: string, attribute: BufferAttribute): this {
    this.attributes.set(name, attribute);
    return this;
  }

  getAttribute(name: string): BufferAttribute | undefined {
    return this.attributes.get(name);
  }

  setFromPoints(points: ArrayLike<Vector3>): this {
    const values: number[] = [];
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      values.push(point.x, point.y, point.z);
    }
    return this.setAttribute('position', new Float32BufferAttribute(values, 3));
  }

  computeBoundingBox(): void {
    const positions = this.getAttribute('position');
    const box = new Box3();
    if (positions) {
      for (let index = 0; index < positions.count; index += 1) {
        box.expandByPoint(
          new Vector3(
            positions.getX(index),
            positions.getY(index),
            positions.getZ(index),
          ),
        );
      }
    }
    this.boundingBox = box;
  }

  computeBoundingSphere(): void {
    if (!this.boundingBox) this.computeBoundingBox();
    this.boundingSphere = this.boundingBox!.getBoundingSphere(new Sphere());
  }

  computeVertexNormals(): void {
    const positions = this.getAttribute('position');
    if (!positions || positions.count < 3) return;
    const normals = new Float32Array(positions.count * 3);
    for (let index = 0; index + 2 < positions.count; index += 3) {
      const a = attributeVector(positions, index);
      const b = attributeVector(positions, index + 1);
      const c = attributeVector(positions, index + 2);
      const normal = new Vector3()
        .crossVectors(b.clone().sub(a), c.clone().sub(a))
        .normalize();
      for (let corner = 0; corner < 3; corner += 1) {
        const offset = (index + corner) * 3;
        normals[offset] = normal.x;
        normals[offset + 1] = normal.y;
        normals[offset + 2] = normal.z;
      }
    }
    this.setAttribute('normal', new BufferAttribute(normals, 3));
  }

  dispose(): void {
    // CPU arrays are garbage-collected; retained for API-compatible cleanup.
  }
}

export class PlaneGeometry extends BufferGeometry {
  constructor(
    public width = 1,
    public height = 1,
  ) {
    super();
    const x = width / 2;
    const y = height / 2;
    this.setAttribute(
      'position',
      new Float32BufferAttribute(
        [-x, -y, 0, x, -y, 0, x, y, 0, -x, -y, 0, x, y, 0, -x, y, 0],
        3,
      ),
    );
  }
}

export class EdgesGeometry extends BufferGeometry {
  constructor(source: BufferGeometry) {
    super();
    if (source instanceof PlaneGeometry) {
      const x = source.width / 2;
      const y = source.height / 2;
      this.setAttribute(
        'position',
        new Float32BufferAttribute(
          [
            -x, -y, 0, x, -y, 0,
            x, -y, 0, x, y, 0,
            x, y, 0, -x, y, 0,
            -x, y, 0, -x, -y, 0,
          ],
          3,
        ),
      );
    } else {
      const sourcePositions = source.getAttribute('position');
      if (sourcePositions) {
        this.setAttribute(
          'position',
          new Float32BufferAttribute(
            Array.from(sourcePositions.array),
            sourcePositions.itemSize,
          ),
        );
      }
    }
  }
}

export class Path {
  points: Vector2[] = [];
  closed = false;

  moveTo(x: number, y: number): this {
    this.points = [new Vector2(x, y)];
    return this;
  }

  lineTo(x: number, y: number): this {
    this.points.push(new Vector2(x, y));
    return this;
  }

  closePath(): this {
    this.closed = true;
    return this;
  }
}

export class Shape extends Path {
  holes: Path[] = [];
}

export class ShapeGeometry extends BufferGeometry {
  constructor(public shape: Shape) {
    super();
    const positions: number[] = [];
    const triangulation = triangulateProfileRegion(
      shape.points,
      shape.holes.map((hole) => hole.points),
    );
    if (triangulation) {
      for (const index of triangulation.indices) {
        const point = triangulation.vertices[index];
        positions.push(point.x, point.y, 0);
      }
    }
    this.setAttribute('position', new Float32BufferAttribute(positions, 3));
  }
}

type MaterialParameters = {
  color?: number | string | Color;
  transparent?: boolean;
  opacity?: number;
  depthTest?: boolean;
  depthWrite?: boolean;
  side?: number;
  vertexColors?: boolean;
  polygonOffset?: boolean;
  polygonOffsetFactor?: number;
  polygonOffsetUnits?: number;
};

export class Material {
  color: Color;
  transparent: boolean;
  opacity: number;
  depthTest: boolean;
  depthWrite: boolean;
  side: number;
  vertexColors: boolean;
  polygonOffset: boolean;
  polygonOffsetFactor: number;
  polygonOffsetUnits: number;

  constructor(parameters: MaterialParameters = {}) {
    this.color = new Color(parameters.color ?? 0xffffff);
    this.transparent = parameters.transparent ?? false;
    this.opacity = parameters.opacity ?? 1;
    this.depthTest = parameters.depthTest ?? true;
    this.depthWrite = parameters.depthWrite ?? true;
    this.side = parameters.side ?? 0;
    this.vertexColors = parameters.vertexColors ?? false;
    this.polygonOffset = parameters.polygonOffset ?? false;
    this.polygonOffsetFactor = parameters.polygonOffsetFactor ?? 0;
    this.polygonOffsetUnits = parameters.polygonOffsetUnits ?? 0;
  }

  dispose(): void {
    // Materials contain no GPU resources in the native viewport path.
  }
}

export class LineBasicMaterial extends Material {}

export class LineDashedMaterial extends LineBasicMaterial {
  dashSize: number;
  gapSize: number;

  constructor(
    parameters: MaterialParameters & { dashSize?: number; gapSize?: number } = {},
  ) {
    super(parameters);
    this.dashSize = parameters.dashSize ?? 3;
    this.gapSize = parameters.gapSize ?? 1;
  }
}

export class MeshBasicMaterial extends Material {}

export class MeshStandardMaterial extends Material {
  roughness: number;
  metalness: number;
  emissive: Color;
  emissiveIntensity = 1;

  constructor(
    parameters: MaterialParameters & {
      roughness?: number;
      metalness?: number;
      emissive?: number | string | Color;
      emissiveIntensity?: number;
    } = {},
  ) {
    super(parameters);
    this.roughness = parameters.roughness ?? 1;
    this.metalness = parameters.metalness ?? 0;
    this.emissive = new Color(parameters.emissive ?? 0);
    this.emissiveIntensity = parameters.emissiveIntensity ?? 1;
  }
}

export class PointsMaterial extends Material {
  size: number;
  sizeAttenuation: boolean;

  constructor(
    parameters: MaterialParameters & {
      size?: number;
      sizeAttenuation?: boolean;
    } = {},
  ) {
    super(parameters);
    this.size = parameters.size ?? 1;
    this.sizeAttenuation = parameters.sizeAttenuation ?? true;
  }
}

export class Texture {
  constructor(public image: HTMLCanvasElement | null = null) {}

  dispose(): void {
    // Canvas-backed data is garbage-collected.
  }
}

export class CanvasTexture extends Texture {
  constructor(image: HTMLCanvasElement) {
    super(image);
  }
}

export class SpriteMaterial extends Material {
  map: Texture | null;
  rotation: number;

  constructor(
    parameters: MaterialParameters & {
      map?: Texture | null;
      rotation?: number;
    } = {},
  ) {
    super(parameters);
    this.map = parameters.map ?? null;
    this.rotation = parameters.rotation ?? 0;
  }
}

export class Mesh<
  TGeometry extends BufferGeometry = BufferGeometry,
  TMaterial extends Material | Material[] = Material | Material[],
> extends Object3D {
  constructor(
    public geometry: TGeometry = new BufferGeometry() as TGeometry,
    public material: TMaterial = new Material() as TMaterial,
  ) {
    super();
  }
}

export class Line<
  TGeometry extends BufferGeometry = BufferGeometry,
  TMaterial extends Material | Material[] = Material | Material[],
> extends Object3D {
  constructor(
    public geometry: TGeometry = new BufferGeometry() as TGeometry,
    public material: TMaterial = new LineBasicMaterial() as TMaterial,
  ) {
    super();
  }

  computeLineDistances(): this {
    return this;
  }
}

export class LineSegments<
  TGeometry extends BufferGeometry = BufferGeometry,
  TMaterial extends Material | Material[] = Material | Material[],
> extends Line<TGeometry, TMaterial> {}

export class Points<
  TGeometry extends BufferGeometry = BufferGeometry,
  TMaterial extends Material | Material[] = Material | Material[],
> extends Object3D {
  constructor(
    public geometry: TGeometry = new BufferGeometry() as TGeometry,
    public material: TMaterial = new PointsMaterial() as unknown as TMaterial,
  ) {
    super();
  }
}

export class Sprite<
  TMaterial extends SpriteMaterial = SpriteMaterial,
> extends Object3D {
  geometry = new BufferGeometry();

  constructor(public material: TMaterial = new SpriteMaterial() as TMaterial) {
    super();
  }
}

export class GridHelper extends LineSegments {
  constructor(
    size = 10,
    divisions = 10,
    colorCenterLine: number | string | Color = 0x444444,
    colorGrid: number | string | Color = 0x888888,
  ) {
    const positions: number[] = [];
    const half = size / 2;
    const step = size / Math.max(1, divisions);
    for (let index = 0; index <= divisions; index += 1) {
      const coordinate = -half + index * step;
      positions.push(-half, 0, coordinate, half, 0, coordinate);
      positions.push(coordinate, 0, -half, coordinate, 0, half);
    }
    super(
      new BufferGeometry().setAttribute(
        'position',
        new Float32BufferAttribute(positions, 3),
      ),
      new LineBasicMaterial({
        color: colorGrid,
        vertexColors: colorCenterLine !== colorGrid,
      }),
    );
  }
}

export class PolylineGeometry extends BufferGeometry {
  setPositions(values: number[]): this {
    this.setAttribute('position', new Float32BufferAttribute(values, 3));
    const starts: number[] = [];
    const ends: number[] = [];
    for (let index = 0; index + 5 < values.length; index += 3) {
      starts.push(values[index], values[index + 1], values[index + 2]);
      ends.push(values[index + 3], values[index + 4], values[index + 5]);
    }
    this.setAttribute('instanceStart', new Float32BufferAttribute(starts, 3));
    this.setAttribute('instanceEnd', new Float32BufferAttribute(ends, 3));
    return this;
  }
}

export class SegmentListGeometry extends BufferGeometry {
  setPositions(values: number[]): this {
    this.setAttribute('position', new Float32BufferAttribute(values, 3));
    const starts: number[] = [];
    const ends: number[] = [];
    for (let index = 0; index + 5 < values.length; index += 6) {
      starts.push(values[index], values[index + 1], values[index + 2]);
      ends.push(values[index + 3], values[index + 4], values[index + 5]);
    }
    this.setAttribute('instanceStart', new Float32BufferAttribute(starts, 3));
    this.setAttribute('instanceEnd', new Float32BufferAttribute(ends, 3));
    return this;
  }
}

export class ScreenLineMaterial extends Material {
  linewidth: number;
  resolution = new Vector2(1, 1);

  constructor(parameters: MaterialParameters & { linewidth?: number } = {}) {
    super(parameters);
    this.linewidth = parameters.linewidth ?? 1;
  }
}

export class ScreenPolyline extends Line<
  PolylineGeometry,
  ScreenLineMaterial
> {}

export class ScreenLineSegments extends LineSegments<
  SegmentListGeometry,
  ScreenLineMaterial
> {}

/**
 * Canvas used exclusively for DOM hit delivery. Keeping a canvas element
 * preserves automation/accessibility selectors from the prior viewport while
 * deliberately requesting no 2D or WebGL rendering context.
 */
export class ViewportInputSurface {
  readonly domElement: HTMLCanvasElement;
  private pixelRatio = 1;

  constructor() {
    this.domElement = document.createElement('canvas');
    this.domElement.dataset.cadInteractionSurface = 'true';
    this.domElement.setAttribute(
      'aria-label',
      'Native CAD viewport interaction surface',
    );
    Object.assign(this.domElement.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      display: 'block',
      touchAction: 'none',
      background: 'transparent',
    });
  }

  setPixelRatio(ratio: number): void {
    this.pixelRatio = Math.max(1, ratio);
  }

  setSize(width: number, height: number): void {
    this.domElement.width = Math.max(1, Math.round(width * this.pixelRatio));
    this.domElement.height = Math.max(1, Math.round(height * this.pixelRatio));
    this.domElement.style.width = `${Math.max(0, width)}px`;
    this.domElement.style.height = `${Math.max(0, height)}px`;
  }

  dispose(): void {
    // No rendering context exists.
  }
}

type OrbitEvent = { type: 'change' };
type OrbitListener = (event: OrbitEvent) => void;

/**
 * Bound one absolute-pointer sample before it reaches camera math. Native
 * capture can occasionally resume with a stale screen coordinate after a
 * focus, DPI, or window-layout change. A normal fast drag is limited to one
 * useful viewport step; a much larger discontinuity is treated as a new
 * anchor instead of rotating or panning the model across the scene.
 */
export function boundedPointerDelta(
  dx: number,
  dy: number,
  viewportWidth: number,
  viewportHeight: number,
): [number, number] | null {
  if (![dx, dy, viewportWidth, viewportHeight].every(Number.isFinite)) return null;
  const magnitude = Math.hypot(dx, dy);
  if (magnitude === 0) return [0, 0];
  const viewportExtent = Math.max(1, viewportWidth, viewportHeight);
  const limit = Math.max(48, Math.min(160, viewportExtent * 0.2));
  if (magnitude > limit * 3) return null;
  if (magnitude <= limit) return [dx, dy];
  const scale = limit / magnitude;
  return [dx * scale, dy * scale];
}

/**
 * CAD orbit controller with the existing mouse mapping:
 * right/Shift-middle orbit, middle pan. Wheel handling remains in Viewport so
 * trackpad classification and product-specific zoom behavior stay unchanged.
 */
export class CadOrbitControls {
  target = new Vector3();
  enabled = true;
  enableDamping = false;
  dampingFactor = 0.08;
  mouseButtons: { LEFT: MOUSE | number; MIDDLE: MOUSE | number; RIGHT: MOUSE | number } = {
    LEFT: MOUSE.ROTATE,
    MIDDLE: MOUSE.DOLLY,
    RIGHT: MOUSE.PAN,
  };

  private listeners = new Set<OrbitListener>();
  private drag:
    | {
        pointerId: number;
        action: MOUSE | number;
        x: number;
        y: number;
      }
    | null = null;

  constructor(
    private camera: PerspectiveCamera,
    private element: HTMLElement,
  ) {
    element.addEventListener('pointerdown', this.onPointerDown);
    element.addEventListener('pointermove', this.onPointerMove);
    element.addEventListener('pointerup', this.onPointerUp);
    element.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('blur', this.onWindowBlur);
  }

  addEventListener(type: 'change', listener: OrbitListener): void {
    if (type === 'change') this.listeners.add(listener);
  }

  removeEventListener(type: 'change', listener: OrbitListener): void {
    if (type === 'change') this.listeners.delete(listener);
  }

  update(): boolean {
    return false;
  }

  dispose(): void {
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerup', this.onPointerUp);
    this.element.removeEventListener('pointercancel', this.onPointerUp);
    window.removeEventListener('blur', this.onWindowBlur);
    this.listeners.clear();
    this.cancelInteraction();
  }

  /** End a captured gesture without applying any final camera movement. */
  cancelInteraction(): void {
    const pointerId = this.drag?.pointerId;
    this.drag = null;
    if (pointerId !== undefined && this.element.hasPointerCapture?.(pointerId)) {
      try {
        this.element.releasePointerCapture?.(pointerId);
      } catch {
        // Win32 capture may already have been released before WebView2 relays
        // the cancellation into the DOM.
      }
    }
  }

  private emitChange(): void {
    const event: OrbitEvent = { type: 'change' };
    for (const listener of this.listeners) listener(event);
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled) return;
    const action =
      event.button === 0
        ? this.mouseButtons.LEFT
        : event.button === 1
          ? this.mouseButtons.MIDDLE
          : event.button === 2
            ? this.mouseButtons.RIGHT
            : -1;
    if (action < 0) return;
    this.drag = {
      pointerId: event.pointerId,
      action,
      x: event.clientX,
      y: event.clientY,
    };
    try {
      this.element.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic pointer input from the native Windows viewport already has
      // Win32 capture and continues targeting this interaction surface.
    }
    event.preventDefault();
  };

  private onPointerMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!this.enabled || !drag || drag.pointerId !== event.pointerId) return;
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    const rawDx = event.clientX - drag.x;
    const rawDy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    const bounded = boundedPointerDelta(
      rawDx,
      rawDy,
      this.element.clientWidth,
      this.element.clientHeight,
    );
    if (!bounded) return;
    const [dx, dy] = bounded;
    if (dx === 0 && dy === 0) return;
    if (drag.action === MOUSE.ROTATE) {
      orbitCamera(
        this.camera,
        this.target,
        dx,
        dy,
        Math.max(1, this.element.clientHeight),
      );
    } else if (drag.action === MOUSE.PAN) {
      const distance = Math.max(1, this.camera.position.distanceTo(this.target));
      const worldPerPixel =
        (2 *
          distance *
          Math.tan(MathUtils.degToRad(this.camera.fov / 2))) /
        Math.max(1, this.element.clientHeight);
      const right = new Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
      const up = new Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
      const delta = right
        .multiplyScalar(-dx * worldPerPixel)
        .addScaledVector(up, dy * worldPerPixel);
      this.camera.position.add(delta);
      this.target.add(delta);
      this.camera.lookAt(this.target);
    }
    this.emitChange();
    event.preventDefault();
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.drag || this.drag.pointerId !== event.pointerId) return;
    this.cancelInteraction();
  };

  private onWindowBlur = (): void => this.cancelInteraction();
}

export function orbitCamera(
  camera: PerspectiveCamera,
  target: Vector3,
  dx: number,
  dy: number,
  viewportHeight: number,
): void {
  const offset = camera.position.clone().sub(target);
  const upToY = new Quaternion().setFromUnitVectors(
    camera.up.clone().normalize(),
    new Vector3(0, 1, 0),
  );
  const yToUp = upToY.clone().invert();
  offset.applyQuaternion(upToY);
  const spherical = new Spherical().setFromVector3(offset);
  spherical.theta -= (2 * Math.PI * dx) / Math.max(1, viewportHeight);
  spherical.phi -= (2 * Math.PI * dy) / Math.max(1, viewportHeight);
  spherical.makeSafe();
  offset.setFromSpherical(spherical).applyQuaternion(yToUp);
  camera.position.copy(target).add(offset);
  camera.lookAt(target);
}

export class Plane {
  normal = new Vector3(1, 0, 0);
  constant = 0;

  setFromNormalAndCoplanarPoint(normal: Vector3, point: Vector3): this {
    this.normal.copy(normal).normalize();
    this.constant = -point.dot(this.normal);
    return this;
  }
}

export class Ray {
  constructor(
    public origin = new Vector3(),
    public direction = new Vector3(0, 0, -1),
  ) {}

  at(distance: number, target: Vector3): Vector3 {
    return target.copy(this.direction).multiplyScalar(distance).add(this.origin);
  }

  intersectPlane(plane: Plane, target: Vector3): Vector3 | null {
    const denominator = plane.normal.dot(this.direction);
    const signedOrigin = this.origin.dot(plane.normal) + plane.constant;
    if (Math.abs(denominator) < 1e-12) {
      return Math.abs(signedOrigin) < 1e-9 ? target.copy(this.origin) : null;
    }
    const distance = -signedOrigin / denominator;
    if (distance < 0) return null;
    return this.at(distance, target);
  }
}

export interface Intersection<TObject extends Object3D = Object3D> {
  distance: number;
  point: Vector3;
  object: TObject;
}

export class Raycaster {
  ray = new Ray();
  near = 0;
  far = Number.POSITIVE_INFINITY;
  params: { Line: { threshold: number }; Points: { threshold: number } } = {
    Line: { threshold: 1 },
    Points: { threshold: 1 },
  };

  setFromCamera(coordinates: Vector2, camera: PerspectiveCamera): void {
    camera.updateMatrixWorld(true);
    this.ray.origin.copy(camera.position);
    this.ray.direction
      .set(
        coordinates.x *
          camera.aspect *
          Math.tan(MathUtils.degToRad(camera.fov / 2)),
        coordinates.y * Math.tan(MathUtils.degToRad(camera.fov / 2)),
        -1,
      )
      .normalize()
      .applyQuaternion(camera.quaternion)
      .normalize();
  }

  intersectObject<TObject extends Object3D>(
    object: TObject,
    recursive = true,
  ): Array<Intersection<TObject>> {
    return this.intersectObjects([object], recursive);
  }

  intersectObjects<TObject extends Object3D>(
    objects: TObject[],
    recursive = true,
  ): Array<Intersection<TObject>> {
    const hits: Array<Intersection<TObject>> = [];
    for (const object of objects) {
      object.updateWorldMatrix(true, true);
      this.intersectOne(object, recursive, hits as Array<Intersection<Object3D>>);
    }
    hits.sort((a, b) => a.distance - b.distance);
    return hits;
  }

  private intersectOne(
    object: Object3D,
    recursive: boolean,
    hits: Array<Intersection<Object3D>>,
  ): void {
    if (!object.visible) return;
    if (object instanceof Mesh) this.intersectMesh(object, hits);
    else if (object instanceof Line) this.intersectLine(object, hits);
    else if (object instanceof Points) this.intersectPoints(object, hits);
    if (recursive) {
      for (const child of object.children) this.intersectOne(child, true, hits);
    }
  }

  private pushHit(
    object: Object3D,
    distance: number,
    point: Vector3,
    hits: Array<Intersection<Object3D>>,
  ): void {
    if (distance < this.near || distance > this.far) return;
    hits.push({ object, distance, point });
  }

  private intersectMesh(
    mesh: Mesh,
    hits: Array<Intersection<Object3D>>,
  ): void {
    const geometry = mesh.geometry;
    if (geometry instanceof PlaneGeometry || geometry instanceof ShapeGeometry) {
      const localOrigin = new Vector3(0, 0, 0).applyMatrix4(mesh.matrixWorld);
      const localNormal = new Vector3(0, 0, 1).transformDirection(mesh.matrixWorld);
      const hit = this.ray.intersectPlane(
        new Plane().setFromNormalAndCoplanarPoint(localNormal, localOrigin),
        new Vector3(),
      );
      if (!hit) return;
      const local = hit.clone().applyMatrix4(mesh.matrixWorld.clone().invert());
      if (geometry instanceof PlaneGeometry) {
        if (
          Math.abs(local.x) > geometry.width / 2 + 1e-9 ||
          Math.abs(local.y) > geometry.height / 2 + 1e-9
        ) {
          return;
        }
      } else if (!pointInShape(local.x, local.y, geometry.shape)) {
        return;
      }
      this.pushHit(mesh, hit.distanceTo(this.ray.origin), hit, hits);
      return;
    }

    const positions = geometry.getAttribute('position');
    if (!positions) return;
    let closest: { distance: number; point: Vector3 } | null = null;
    for (let index = 0; index + 2 < positions.count; index += 3) {
      const a = attributeVector(positions, index).applyMatrix4(mesh.matrixWorld);
      const b = attributeVector(positions, index + 1).applyMatrix4(mesh.matrixWorld);
      const c = attributeVector(positions, index + 2).applyMatrix4(mesh.matrixWorld);
      const hitDistance = rayTriangleDistance(this.ray, a, b, c);
      if (
        hitDistance === null ||
        (closest && hitDistance >= closest.distance)
      ) {
        continue;
      }
      closest = {
        distance: hitDistance,
        point: this.ray.at(hitDistance, new Vector3()),
      };
    }
    if (closest) this.pushHit(mesh, closest.distance, closest.point, hits);
  }

  private intersectLine(
    line: Line,
    hits: Array<Intersection<Object3D>>,
  ): void {
    const geometry = line.geometry;
    const segments = segmentsForGeometry(
      geometry,
      line instanceof LineSegments,
    );
    let closest:
      | { rayDistance: number; distance: number; point: Vector3 }
      | null = null;
    for (const [localA, localB] of segments) {
      const a = localA.applyMatrix4(line.matrixWorld);
      const b = localB.applyMatrix4(line.matrixWorld);
      const result = closestRaySegment(this.ray, a, b);
      if (
        result.distance > this.params.Line.threshold ||
        (closest && result.rayDistance >= closest.rayDistance)
      ) {
        continue;
      }
      closest = {
        rayDistance: result.rayDistance,
        distance: result.distance,
        point: this.ray.at(result.rayDistance, new Vector3()),
      };
    }
    if (closest) {
      this.pushHit(line, closest.rayDistance, closest.point, hits);
    }
  }

  private intersectPoints(
    points: Points,
    hits: Array<Intersection<Object3D>>,
  ): void {
    const positions = points.geometry.getAttribute('position');
    if (!positions) return;
    let closest:
      | { rayDistance: number; distance: number; point: Vector3 }
      | null = null;
    for (let index = 0; index < positions.count; index += 1) {
      const point = attributeVector(positions, index).applyMatrix4(points.matrixWorld);
      const offset = point.clone().sub(this.ray.origin);
      const rayDistance = Math.max(0, offset.dot(this.ray.direction));
      const rayPoint = this.ray.at(rayDistance, new Vector3());
      const distance = rayPoint.distanceTo(point);
      if (
        distance > this.params.Points.threshold ||
        (closest && rayDistance >= closest.rayDistance)
      ) {
        continue;
      }
      closest = { rayDistance, distance, point: rayPoint };
    }
    if (closest) this.pushHit(points, closest.rayDistance, closest.point, hits);
  }
}

function attributeVector(attribute: BufferAttribute, index: number): Vector3 {
  return new Vector3(
    attribute.getX(index),
    attribute.getY(index),
    attribute.getZ(index),
  );
}

function geometryOf(object: Object3D): BufferGeometry | null {
  if (
    object instanceof Mesh ||
    object instanceof Line ||
    object instanceof Points ||
    object instanceof Sprite
  ) {
    return object.geometry;
  }
  return null;
}

function segmentsForGeometry(
  geometry: BufferGeometry,
  independentSegments: boolean,
): Array<[Vector3, Vector3]> {
  const starts = geometry.getAttribute('instanceStart');
  const ends = geometry.getAttribute('instanceEnd');
  const segments: Array<[Vector3, Vector3]> = [];
  if (starts && ends) {
    const count = Math.min(starts.count, ends.count);
    for (let index = 0; index < count; index += 1) {
      segments.push([
        attributeVector(starts, index),
        attributeVector(ends, index),
      ]);
    }
    return segments;
  }
  const positions = geometry.getAttribute('position');
  if (!positions) return segments;
  const step = independentSegments ? 2 : 1;
  for (let index = 0; index + 1 < positions.count; index += step) {
    segments.push([
      attributeVector(positions, index),
      attributeVector(positions, index + 1),
    ]);
  }
  return segments;
}

function rayTriangleDistance(
  ray: Ray,
  a: Vector3,
  b: Vector3,
  c: Vector3,
): number | null {
  const edge1 = b.clone().sub(a);
  const edge2 = c.clone().sub(a);
  const p = new Vector3().crossVectors(ray.direction, edge2);
  const determinant = edge1.dot(p);
  if (Math.abs(determinant) < 1e-10) return null;
  const inverse = 1 / determinant;
  const t = ray.origin.clone().sub(a);
  const u = t.dot(p) * inverse;
  if (u < -1e-9 || u > 1 + 1e-9) return null;
  const q = new Vector3().crossVectors(t, edge1);
  const v = ray.direction.dot(q) * inverse;
  if (v < -1e-9 || u + v > 1 + 1e-9) return null;
  const distance = edge2.dot(q) * inverse;
  return distance >= 0 ? distance : null;
}

function closestRaySegment(
  ray: Ray,
  start: Vector3,
  end: Vector3,
): { rayDistance: number; segmentT: number; distance: number } {
  const segment = end.clone().sub(start);
  const relative = ray.origin.clone().sub(start);
  const a = ray.direction.lengthSq();
  const b = ray.direction.dot(segment);
  const c = segment.lengthSq();
  const d = ray.direction.dot(relative);
  const e = segment.dot(relative);
  const denominator = a * c - b * b;
  let rayDistance =
    Math.abs(denominator) < 1e-12 ? 0 : (b * e - c * d) / denominator;
  let segmentT =
    Math.abs(denominator) < 1e-12 ? e / Math.max(c, 1e-12) : (a * e - b * d) / denominator;
  segmentT = MathUtils.clamp(segmentT, 0, 1);
  rayDistance = Math.max(0, (b * segmentT - d) / Math.max(a, 1e-12));
  if (rayDistance === 0) {
    segmentT = MathUtils.clamp(e / Math.max(c, 1e-12), 0, 1);
  }
  const onRay = ray.at(rayDistance, new Vector3());
  const onSegment = start.clone().addScaledVector(segment, segmentT);
  return {
    rayDistance,
    segmentT,
    distance: onRay.distanceTo(onSegment),
  };
}

function pointInPolygon(x: number, y: number, points: Vector2[]): boolean {
  let inside = false;
  for (
    let current = 0, previous = points.length - 1;
    current < points.length;
    previous = current++
  ) {
    const a = points[current];
    const b = points[previous];
    const crosses =
      a.y > y !== b.y > y &&
      x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y || 1e-30) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInShape(x: number, y: number, shape: Shape): boolean {
  if (!pointInPolygon(x, y, shape.points)) return false;
  return !shape.holes.some((hole) => pointInPolygon(x, y, hole.points));
}

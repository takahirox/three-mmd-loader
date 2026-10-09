/** Structural subset of initialized Ammo.js used by MMDPhysics. No runtime import. */
export interface AmmoVector3 {
	x(): number; y(): number; z(): number;
	setValue( x: number, y: number, z: number ): void;
}
export interface AmmoQuaternion {
	x(): number; y(): number; z(): number; w(): number;
	setX( x: number ): void; setY( y: number ): void; setZ( z: number ): void; setW( w: number ): void;
}
export interface AmmoTransform {
	setIdentity(): void;
	getOrigin(): AmmoVector3;
	getRotation(): AmmoQuaternion;
	getBasis(): { getRotation( quaternion: AmmoQuaternion ): void };
	setRotation( quaternion: AmmoQuaternion ): void;
}
export interface AmmoShape { calculateLocalInertia( mass: number, inertia: AmmoVector3 ): void }
export interface AmmoMotionState {
	getWorldTransform( transform: AmmoTransform ): void;
	setWorldTransform( transform: AmmoTransform ): void;
}
export interface AmmoBodyInfo {
	set_m_friction( friction: number ): void;
	set_m_restitution( restitution: number ): void;
}
export interface AmmoBody {
	setInterpolationWorldTransform?( transform: AmmoTransform ): void;
	setInterpolationLinearVelocity?( velocity: AmmoVector3 ): void;
	setInterpolationAngularVelocity?( velocity: AmmoVector3 ): void;
	setLinearVelocity?( velocity: AmmoVector3 ): void;
	setAngularVelocity?( velocity: AmmoVector3 ): void;
	clearForces?(): void;
	getCenterOfMassTransform(): AmmoTransform;
	setCenterOfMassTransform( transform: AmmoTransform ): void;
	getMotionState(): AmmoMotionState;
	getCollisionFlags(): number;
	setCollisionFlags( flags: number ): void;
	setActivationState( state: number ): void;
	setDamping( linear: number, angular: number ): void;
	setSleepingThresholds( linear: number, angular: number ): void;
}
export interface AmmoConstraint {
	setLinearLowerLimit( limit: AmmoVector3 ): void;
	setLinearUpperLimit( limit: AmmoVector3 ): void;
	setAngularLowerLimit( limit: AmmoVector3 ): void;
	setAngularUpperLimit( limit: AmmoVector3 ): void;
	enableSpring( index: number, enabled: boolean ): void;
	setStiffness( index: number, stiffness: number ): void;
	setParam?( parameter: number, value: number, axis: number ): void;
}
export interface AmmoWorld {
	setGravity( gravity: AmmoVector3 ): void;
	stepSimulation( time: number, maxSteps: number, unitStep: number ): number;
	addRigidBody( body: AmmoBody, group: number, mask: number ): void;
	removeRigidBody?( body: AmmoBody ): void;
	removeConstraint?( constraint: AmmoConstraint ): void;
	addConstraint( constraint: AmmoConstraint, disableCollisions: boolean ): void;
}
export interface AmmoAPI {
	btVector3: new ( x?: number, y?: number, z?: number ) => AmmoVector3;
	btQuaternion: new ( x?: number, y?: number, z?: number, w?: number ) => AmmoQuaternion;
	btTransform: new () => AmmoTransform;
	btSphereShape: new ( radius: number ) => AmmoShape;
	btBoxShape: new ( size: AmmoVector3 ) => AmmoShape;
	btCapsuleShape: new ( radius: number, height: number ) => AmmoShape;
	btDefaultMotionState: new ( transform: AmmoTransform ) => AmmoMotionState;
	btRigidBodyConstructionInfo: new ( mass: number, state: AmmoMotionState, shape: AmmoShape, inertia: AmmoVector3 ) => AmmoBodyInfo;
	btRigidBody: new ( info: AmmoBodyInfo ) => AmmoBody;
	btGeneric6DofSpringConstraint: new ( a: AmmoBody, b: AmmoBody, frameA: AmmoTransform, frameB: AmmoTransform, useReferenceFrameA: boolean ) => AmmoConstraint;
	btDefaultCollisionConfiguration: new () => object;
	btCollisionDispatcher: new ( configuration: object ) => object;
	btDbvtBroadphase: new () => object;
	btSequentialImpulseConstraintSolver: new () => object;
	btDiscreteDynamicsWorld: new ( dispatcher: object, broadphase: object, solver: object, configuration: object ) => AmmoWorld;
}

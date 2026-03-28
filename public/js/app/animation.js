import * as THREE from 'three';

export function createAnimationController({
  state,
  getPartMeshes,
  animationControlsElement,
  playButton,
  pauseButton,
  resetButton,
  timelineInput,
  timeDisplayElement,
  speedButtons = [],
  onStatus = () => {},
}) {
  const animationState = state.animation;
  const clock = new THREE.Clock(false);

  function captureInitialStates() {
    animationState.initialStates.clear();
    for (const part of getPartMeshes()) {
      animationState.initialStates.set(part.id, {
        pos: part.mesh.position.clone(),
        quat: part.mesh.quaternion.clone(),
      });
    }
  }

  function showControls() {
    animationControlsElement?.classList.add('visible');
  }

  function hideControls() {
    animationControlsElement?.classList.remove('visible');
  }

  function getAngleAtTime(keyframes, time) {
    if (!keyframes || keyframes.length === 0) return 0;
    if (time <= keyframes[0].t) return keyframes[0].angle;
    const last = keyframes[keyframes.length - 1];
    if (time >= last.t) return last.angle;

    for (let index = 0; index < keyframes.length - 1; index += 1) {
      if (time >= keyframes[index].t && time < keyframes[index + 1].t) {
        const alpha = (time - keyframes[index].t) / (keyframes[index + 1].t - keyframes[index].t);
        return keyframes[index].angle + alpha * (keyframes[index + 1].angle - keyframes[index].angle);
      }
    }
    return last.angle;
  }

  function getDisplacementAtTime(keyframes, time) {
    if (!keyframes || keyframes.length === 0) return 0;
    if (time <= keyframes[0].t) return keyframes[0].displacement || 0;
    const last = keyframes[keyframes.length - 1];
    if (time >= last.t) return last.displacement || 0;

    for (let index = 0; index < keyframes.length - 1; index += 1) {
      if (time >= keyframes[index].t && time < keyframes[index + 1].t) {
        const alpha = (time - keyframes[index].t) / (keyframes[index + 1].t - keyframes[index].t);
        const start = keyframes[index].displacement || 0;
        const end = keyframes[index + 1].displacement || 0;
        return start + alpha * (end - start);
      }
    }
    return last.displacement || 0;
  }

  function getAnchorAtTime(keyframes, time) {
    if (!keyframes || keyframes.length === 0) return [0, 0, 0];
    if (time <= keyframes[0].t) return keyframes[0].anchor || [0, 0, 0];
    const last = keyframes[keyframes.length - 1];
    if (time >= last.t) return last.anchor || [0, 0, 0];

    for (let index = 0; index < keyframes.length - 1; index += 1) {
      if (time >= keyframes[index].t && time < keyframes[index + 1].t) {
        const alpha = (time - keyframes[index].t) / (keyframes[index + 1].t - keyframes[index].t);
        const start = keyframes[index].anchor || [0, 0, 0];
        const end = keyframes[index + 1].anchor || [0, 0, 0];
        return [
          start[0] + alpha * (end[0] - start[0]),
          start[1] + alpha * (end[1] - start[1]),
          start[2] + alpha * (end[2] - start[2]),
        ];
      }
    }
    return last.anchor || [0, 0, 0];
  }

  function applyRevoluteTransform(mesh, axis, anchor, angleDeg, initial) {
    const radians = THREE.MathUtils.degToRad(angleDeg);
    const axisVector = new THREE.Vector3(...axis).normalize();
    const anchorVector = new THREE.Vector3(...anchor);

    mesh.position.copy(initial.pos);
    mesh.quaternion.copy(initial.quat);

    const offset = mesh.position.clone().sub(anchorVector);
    offset.applyAxisAngle(axisVector, radians);
    mesh.position.copy(anchorVector).add(offset);

    const rotation = new THREE.Quaternion().setFromAxisAngle(axisVector, radians);
    mesh.quaternion.premultiply(rotation);
  }

  function applyPrismaticTransform(mesh, axis, displacement, initial) {
    mesh.position.copy(initial.pos);
    mesh.quaternion.copy(initial.quat);
    const axisVector = new THREE.Vector3(...axis).normalize();
    mesh.position.addScaledVector(axisVector, displacement);
  }

  function applyFloatingTransform(mesh, axis, initialAnchor, keyframeAnchor, angleDeg, initial) {
    mesh.position.copy(initial.pos);
    mesh.quaternion.copy(initial.quat);

    mesh.position.add(new THREE.Vector3(
      keyframeAnchor[0] - initialAnchor[0],
      keyframeAnchor[1] - initialAnchor[1],
      keyframeAnchor[2] - initialAnchor[2],
    ));

    const radians = THREE.MathUtils.degToRad(angleDeg);
    const axisVector = new THREE.Vector3(...axis).normalize();
    const anchorVector = new THREE.Vector3(...keyframeAnchor);
    const offset = mesh.position.clone().sub(anchorVector);
    offset.applyAxisAngle(axisVector, radians);
    mesh.position.copy(anchorVector).add(offset);
    const rotation = new THREE.Quaternion().setFromAxisAngle(axisVector, radians);
    mesh.quaternion.premultiply(rotation);
  }

  function updateTimelineUI() {
    if (!animationState.motionData) return;
    if (timelineInput) {
      timelineInput.value = Math.round((animationState.motionTime / animationState.motionData.duration) * 1000);
    }
    if (timeDisplayElement) {
      timeDisplayElement.textContent = `${animationState.motionTime.toFixed(1)}s`;
    }
  }

  function applyMotionFrame(time) {
    const motionData = animationState.motionData;
    if (!motionData || !motionData.parts) return;

    for (const part of getPartMeshes()) {
      const partMotion = motionData.parts[part.id];
      if (!partMotion) continue;
      const initial = animationState.initialStates.get(part.id);
      if (!initial) continue;

      if (partMotion.type === 'revolute') {
        const angle = getAngleAtTime(partMotion.keyframes, time);
        applyRevoluteTransform(part.mesh, partMotion.axis, partMotion.anchor, angle, initial);
      } else if (partMotion.type === 'prismatic') {
        const displacement = getDisplacementAtTime(partMotion.keyframes, time);
        applyPrismaticTransform(part.mesh, partMotion.axis, displacement, initial);
      } else if (partMotion.type === 'cylindrical') {
        const angle = getAngleAtTime(partMotion.keyframes, time);
        const displacement = getDisplacementAtTime(partMotion.keyframes, time);
        applyRevoluteTransform(part.mesh, partMotion.axis, partMotion.anchor, angle, initial);
        const axisVector = new THREE.Vector3(...partMotion.axis).normalize();
        part.mesh.position.addScaledVector(axisVector, displacement);
      } else if (partMotion.type === 'floating') {
        const angle = getAngleAtTime(partMotion.keyframes, time);
        const anchor = getAnchorAtTime(partMotion.keyframes, time);
        applyFloatingTransform(part.mesh, partMotion.axis, partMotion.anchor, anchor, angle, initial);
      }
    }
  }

  function resetMotion() {
    animationState.motionPlaying = false;
    animationState.motionTime = 0;
    clock.stop();
    if (animationState.motionData) {
      applyMotionFrame(0);
      updateTimelineUI();
    }
  }

  function clearMotion() {
    animationState.motionData = null;
    animationState.motionPlaying = false;
    animationState.motionTime = 0;
    animationState.initialStates.clear();
    clock.stop();
    hideControls();
  }

  function setMotionData(motionData) {
    animationState.motionData = motionData;
    captureInitialStates();
    showControls();
    updateTimelineUI();
    onStatus('Motion data loaded — press Play', 'success');
  }

  function tick() {
    const motionData = animationState.motionData;
    if (!animationState.motionPlaying || !motionData) return;

    const delta = clock.getDelta();
    animationState.motionTime += delta * animationState.motionSpeed;
    if (animationState.motionTime >= motionData.duration) {
      animationState.motionTime = motionData.loop
        ? animationState.motionTime % motionData.duration
        : motionData.duration;
      if (!motionData.loop) {
        animationState.motionPlaying = false;
        clock.stop();
      }
    }

    applyMotionFrame(animationState.motionTime);
    updateTimelineUI();
  }

  playButton?.addEventListener('click', () => {
    if (!animationState.motionData) return;
    animationState.motionPlaying = true;
    clock.start();
  });

  pauseButton?.addEventListener('click', () => {
    animationState.motionPlaying = false;
    clock.stop();
  });

  resetButton?.addEventListener('click', resetMotion);

  timelineInput?.addEventListener('input', () => {
    if (!animationState.motionData) return;
    animationState.motionPlaying = false;
    clock.stop();
    animationState.motionTime = (Number(timelineInput.value) / 1000) * animationState.motionData.duration;
    applyMotionFrame(animationState.motionTime);
    updateTimelineUI();
  });

  for (const button of speedButtons) {
    button.addEventListener('click', () => {
      animationState.motionSpeed = parseFloat(button.dataset.speed) || 1;
      for (const candidate of speedButtons) {
        candidate.classList.remove('selected');
      }
      button.classList.add('selected');
    });
  }

  return {
    clearMotion,
    hasMotionData() {
      return Boolean(animationState.motionData);
    },
    setMotionData,
    tick,
  };
}

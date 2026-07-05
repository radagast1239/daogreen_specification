import React, { useEffect, useRef, useImperativeHandle } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, OrthographicCamera } from '@react-three/drei';
import { Crab3D } from './crabVisuals.jsx';
import { computeFrameOrthoZoom, frameCameraPosition } from './frameViewFit.js';
import { shouldShowNftChannels } from './frameNftChannels.js';

function CameraController({ mode, center, size, resetKey }) {
  const { camera, size: viewport } = useThree();
  const controlsRef = useRef();

  useEffect(() => {
    if (!controlsRef.current) return;

    const [cx, cy, cz] = center;
    controlsRef.current.reset();
    controlsRef.current.target.set(cx, cy, cz);

    const [px, py, pz] = frameCameraPosition(mode, center, size);
    camera.position.set(px, py, pz);
    camera.lookAt(cx, cy, cz);

    if (camera.isOrthographicCamera) {
      camera.zoom = computeFrameOrthoZoom(
        mode,
        size,
        viewport.width,
        viewport.height,
      );
    }

    camera.updateProjectionMatrix();
    controlsRef.current.update();
  }, [mode, center, size, camera, viewport.width, viewport.height, resetKey]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableRotate={false}
      enableZoom
      enablePan
    />
  );
}

function IsoCaptureBridge({ captureRef, viewMode }) {
  const { gl } = useThree();

  useImperativeHandle(captureRef, () => ({
    captureIso: () =>
      new Promise((resolve, reject) => {
        if (!gl?.domElement) {
          reject(new Error('WebGL canvas unavailable'));
          return;
        }
        requestAnimationFrame(() => {
          try {
            resolve(gl.domElement.toDataURL('image/png'));
          } catch (err) {
            reject(err);
          }
        });
      }),
  }), [gl, viewMode]);

  return null;
}

const VIEW_MODES = [
  { id: 'iso', label: 'Изометрия' },
  { id: 'front', label: 'Спереди' },
  { id: 'side', label: 'Сбоку' },
  { id: 'top', label: 'Сверху' },
];

export default function Frame3DView({ params, geom, captureRef, hasErrors }) {
  const [viewMode, setViewMode] = React.useState('iso');
  const [viewResetKey, setViewResetKey] = React.useState(0);

  if (hasErrors || !geom || geom.validationErrors?.length || !geom.dimensions) {
    return (
      <div className="fc-viewer">
        <div className="fc-viewer__empty">3D вид недоступен — исправьте параметры каркаса</div>
      </div>
    );
  }

  const { tubeWidthMm, tubeHeightMm, connectionType, showConnectors, showTrays, trayEnabled } = params;
  const showChannelVis = shouldShowNftChannels(params);
  const nft = geom.nftChannels;

  const colorPost = '#4f5b66';
  const colorLong = '#cc5500';
  const colorCross = '#666666';
  const colorTray = '#b0b8c0';
  const colorChannel = '#1e9fd4';

  const center = [geom.dimensions.lengthMm / 2, geom.dimensions.postHeight / 2, geom.dimensions.depthMm / 2];
  const size = [geom.dimensions.lengthMm, geom.dimensions.postHeight, geom.dimensions.depthMm];

  return (
    <div className="fc-viewer">
      <div className="fc-viewer__toolbar">
        <span className="fc-viewer__label">Вид</span>
        <div className="fc-segment" role="group" aria-label="Режим просмотра">
          {VIEW_MODES.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`fc-segment__btn${viewMode === id ? ' is-active' : ''}`}
              onClick={() => setViewMode(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={() => {
            setViewMode('iso');
            setViewResetKey((k) => k + 1);
          }}
        >
          Сбросить
        </button>
      </div>

      <div className="fc-viewer__canvas">
        <Canvas gl={{ preserveDrawingBuffer: true }} style={{ width: '100%', height: '100%' }} dpr={[1, 2]}>
          <OrthographicCamera makeDefault near={-50000} far={50000} />

          <CameraController mode={viewMode} center={center} size={size} resetKey={viewResetKey} />
          {captureRef && <IsoCaptureBridge captureRef={captureRef} viewMode={viewMode} />}

          <ambientLight intensity={0.6} />
          <directionalLight position={[10000, 10000, 10000]} intensity={0.8} />
          <directionalLight position={[-10000, 5000, -5000]} intensity={0.3} />

          <group>
            {geom.posts.map((p, i) => (
              <mesh key={`post-${i}`} position={[p.x, p.z, p.y]}>
                <boxGeometry args={[tubeWidthMm, p.length, tubeHeightMm]} />
                <meshStandardMaterial color={colorPost} />
              </mesh>
            ))}

            {geom.longitudinalBeams.map((b, i) => (
              <mesh key={`long-${i}`} position={[b.x, b.z, b.y]}>
                <boxGeometry args={[b.length, tubeHeightMm, tubeWidthMm]} />
                <meshStandardMaterial color={colorLong} />
              </mesh>
            ))}

            {geom.crossBeams.map((b, i) => (
              <mesh key={`cross-${i}`} position={[b.x, b.z, b.y]}>
                <boxGeometry args={[tubeWidthMm, tubeHeightMm, b.length]} />
                <meshStandardMaterial color={colorCross} />
              </mesh>
            ))}

            {showConnectors && connectionType === 'crab' && geom.connectors.map((c, i) => (
              <Crab3D key={`conn-${i}`} c={c} w={tubeWidthMm} h={tubeHeightMm} />
            ))}

            {showTrays && trayEnabled && geom.trays.map((t, i) => (
              <mesh key={`tray-${i}`} position={[t.x, t.z, t.y]}>
                <boxGeometry args={[t.length, t.height, t.width]} />
                <meshStandardMaterial color={colorTray} transparent opacity={0.55} />
              </mesh>
            ))}

            {showChannelVis && nft?.runs?.map((c, i) => (
              <mesh key={`ch-run-${i}`} position={[c.x, c.z, c.y]} renderOrder={10}>
                <boxGeometry args={[c.length, c.height, c.width]} />
                <meshStandardMaterial color={colorChannel} transparent opacity={0.88} depthWrite={false} />
              </mesh>
            ))}

            {showChannelVis && nft?.drops?.map((c, i) => (
              <mesh key={`ch-drop-${i}`} position={[c.x, c.z, c.y]} renderOrder={11}>
                <boxGeometry args={[c.width, c.length, c.depth]} />
                <meshStandardMaterial color={colorChannel} transparent opacity={0.95} depthWrite={false} />
              </mesh>
            ))}
          </group>

          <Grid infiniteGrid fadeDistance={10000} sectionColor="#cccccc" cellColor="#eeeeee" position={[center[0], 0, center[2]]} />
        </Canvas>
      </div>
    </div>
  );
}

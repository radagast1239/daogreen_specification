import React from 'react';

/** T-образный краб: горизонтальная муфта + вертикальная ножка + «ушки» под болты */
export function Crab2D({ x, y, type, rotation = 0, scale = 1 }) {
  const fill = '#f0d060';
  const stroke = '#8a7020';
  const sw = 1.2 / scale;

  if (type === 'A6') {
    const arm = 11 / scale;
    const thick = 3.5 / scale;
    return (
      <g transform={`translate(${x}, ${y}) rotate(${rotation})`}>
        <rect x={-arm} y={-thick / 2} width={arm * 2} height={thick} fill={fill} stroke={stroke} strokeWidth={sw} rx={1 / scale} />
        <rect x={-thick / 2} y={-arm} width={thick} height={arm * 2} fill={fill} stroke={stroke} strokeWidth={sw} rx={1 / scale} />
        <rect x={-arm * 0.5} y={-arm * 0.5} width={arm} height={arm} fill="none" stroke={stroke} strokeWidth={sw * 0.7} transform="rotate(45)" />
      </g>
    );
  }

  if (type === 'A4') {
    const arm = 12 / scale;
    const thick = 4 / scale;
    return (
      <g transform={`translate(${x}, ${y}) rotate(${rotation})`}>
        <rect x={-arm} y={-thick / 2} width={arm * 2} height={thick} fill={fill} stroke={stroke} strokeWidth={sw} rx={1 / scale} />
        <rect x={-thick / 2} y={-arm} width={thick} height={arm * 2} fill={fill} stroke={stroke} strokeWidth={sw} rx={1 / scale} />
        <rect x={-arm * 0.55} y={-arm * 0.55} width={arm * 1.1} height={arm * 1.1} fill="none" stroke={stroke} strokeWidth={sw * 0.8} />
      </g>
    );
  }

  if (type === 'X') {
    const arm = 14 / scale;
    const thick = 5 / scale;
    return (
      <g transform={`translate(${x}, ${y}) rotate(${rotation})`}>
        {/* Две зажимные пластины крестом */}
        <rect x={-arm} y={-thick / 2} width={arm * 2} height={thick} fill={fill} stroke={stroke} strokeWidth={sw} rx={1 / scale} />
        <rect x={-thick / 2} y={-arm} width={thick} height={arm * 2} fill={fill} stroke={stroke} strokeWidth={sw} rx={1 / scale} />
        {/* Уголки-ушки */}
        <circle cx={-arm * 0.6} cy={-arm * 0.6} r={1.8 / scale} fill={stroke} />
        <circle cx={arm * 0.6} cy={-arm * 0.6} r={1.8 / scale} fill={stroke} />
        <circle cx={-arm * 0.6} cy={arm * 0.6} r={1.8 / scale} fill={stroke} />
        <circle cx={arm * 0.6} cy={arm * 0.6} r={1.8 / scale} fill={stroke} />
      </g>
    );
  }

  if (type === 'G') {
    const armH = 16 / scale;
    const armV = 12 / scale;
    const thick = 5 / scale;
    return (
      <g transform={`translate(${x}, ${y}) rotate(${rotation})`}>
        <rect x={0} y={-thick / 2} width={armH} height={thick} fill={fill} stroke={stroke} strokeWidth={sw} rx={1 / scale} />
        <rect x={-thick / 2} y={-armV} width={thick} height={armV} fill={fill} stroke={stroke} strokeWidth={sw} rx={1 / scale} />
        <circle cx={armH * 0.55} cy={0} r={1.2 / scale} fill={stroke} />
        <circle cx={0} cy={-armV * 0.55} r={1.2 / scale} fill={stroke} />
      </g>
    );
  }

  // T-образный
  const sleeveW = 18 / scale;
  const sleeveH = 5 / scale;
  const legW = 5 / scale;
  const legH = 10 / scale;
  const ear = 3 / scale;

  return (
    <g transform={`translate(${x}, ${y}) rotate(${rotation})`}>
      {/* Горизонтальная муфта на балке */}
      <rect x={-sleeveW / 2} y={-sleeveH / 2} width={sleeveW} height={sleeveH} fill={fill} stroke={stroke} strokeWidth={sw} rx={1 / scale} />
      {/* Вертикальная ножка на стойку */}
      <rect x={-legW / 2} y={sleeveH / 2} width={legW} height={legH} fill={fill} stroke={stroke} strokeWidth={sw} rx={1 / scale} />
      {/* Ушки с отверстиями */}
      <polygon points={`${-sleeveW / 2 - ear},${-sleeveH / 2} ${-sleeveW / 2},${-sleeveH / 2 - ear} ${-sleeveW / 2},${sleeveH / 2 + ear} ${-sleeveW / 2 - ear},${sleeveH / 2}`} fill={fill} stroke={stroke} strokeWidth={sw} />
      <polygon points={`${sleeveW / 2 + ear},${-sleeveH / 2} ${sleeveW / 2},${-sleeveH / 2 - ear} ${sleeveW / 2},${sleeveH / 2 + ear} ${sleeveW / 2 + ear},${sleeveH / 2}`} fill={fill} stroke={stroke} strokeWidth={sw} />
      <circle cx={-sleeveW / 2 - ear / 2} cy={0} r={1.2 / scale} fill={stroke} />
      <circle cx={sleeveW / 2 + ear / 2} cy={0} r={1.2 / scale} fill={stroke} />
    </g>
  );
}

/** 3D: оцинкованная штамповка */
export function Crab3D({ c, w, h }) {
  const mat = <meshStandardMaterial color="#c8ccd0" metalness={0.85} roughness={0.25} />;
  const t = Math.max(2, w * 0.12);
  const arm = w * 2.8;
  const gap = w * 0.55;

  if (c.type === 'A6') {
    return (
      <group position={[c.x, c.z, c.y]}>
        {[0, Math.PI / 3, (2 * Math.PI) / 3].map((rot, i) => (
          <mesh key={i} position={[0, 0, 0]} rotation={[0, rot, 0]}>
            <boxGeometry args={[arm, t, arm * 0.3]} />
            {mat}
          </mesh>
        ))}
      </group>
    );
  }

  if (c.type === 'A4') {
    return (
      <group position={[c.x, c.z, c.y]}>
        <mesh position={[0, 0, gap]}>
          <boxGeometry args={[arm, t, arm * 0.35]} />
          {mat}
        </mesh>
        <mesh position={[0, 0, -gap]}>
          <boxGeometry args={[arm, t, arm * 0.35]} />
          {mat}
        </mesh>
        <mesh position={[0, gap, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <boxGeometry args={[arm, t, arm * 0.35]} />
          {mat}
        </mesh>
        <mesh position={[0, -gap, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <boxGeometry args={[arm, t, arm * 0.35]} />
          {mat}
        </mesh>
      </group>
    );
  }

  if (c.type === 'X') {
    return (
      <group position={[c.x, c.z, c.y]}>
        {/* Крест: две пересекающиеся зажимные пластины */}
        <mesh position={[0, 0, gap]}>
          <boxGeometry args={[arm, t, arm * 0.35]} />
          {mat}
        </mesh>
        <mesh position={[0, 0, -gap]}>
          <boxGeometry args={[arm, t, arm * 0.35]} />
          {mat}
        </mesh>
        <mesh position={[0, gap, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <boxGeometry args={[arm, t, arm * 0.35]} />
          {mat}
        </mesh>
        <mesh position={[0, -gap, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <boxGeometry args={[arm, t, arm * 0.35]} />
          {mat}
        </mesh>
      </group>
    );
  }

  if (c.type === 'G') {
    const sign = c.orientation === 'left' ? -1 : 1;
    return (
      <group position={[c.x, c.z, c.y]} rotation={[0, c.orientation === 'left' ? Math.PI : 0, 0]}>
        <mesh position={[sign * arm * 0.35, 0, 0]}>
          <boxGeometry args={[arm * 0.75, t, w * 0.5]} />
          {mat}
        </mesh>
        <mesh position={[0, -h * 0.55, 0]}>
          <boxGeometry args={[w * 0.5, h * 1.0, w * 0.5]} />
          {mat}
        </mesh>
      </group>
    );
  }

  // T-образный
  let rotZ = 0;
  let offX = 0;
  let offZ = 0;
  if (c.orientation === 'right') { rotZ = Math.PI / 2; offX = arm * 0.15; }
  else if (c.orientation === 'left') { rotZ = -Math.PI / 2; offX = -arm * 0.15; }
  else if (c.orientation === 'down') { offZ = arm * 0.15; }
  else if (c.orientation === 'up') { offZ = -arm * 0.15; }

  return (
    <group position={[c.x, c.z, c.y]} rotation={[0, rotZ, 0]}>
      {/* Горизонтальная муфта */}
      <mesh position={[offX, 0, offZ + gap]}>
        <boxGeometry args={[arm, t, w * 0.5]} />
        {mat}
      </mesh>
      <mesh position={[offX, 0, offZ - gap]}>
        <boxGeometry args={[arm, t, w * 0.5]} />
        {mat}
      </mesh>
      {/* Вертикальная ножка */}
      <mesh position={[offX, -h * 0.6, offZ]}>
        <boxGeometry args={[w * 0.5, h * 1.1, w * 0.5]} />
        {mat}
      </mesh>
    </group>
  );
}

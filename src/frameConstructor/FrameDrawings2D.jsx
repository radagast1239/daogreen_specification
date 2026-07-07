import React from 'react';
import { Crab2D } from './crabVisuals.jsx';
import { beamElevationCenterZ } from './framePdfExport.js';
import { shouldShowNftChannels, channelNeedsSleeves, channelSegmentLengthsMm, tierSnakeConnectSide, NFT_CHANNEL_HEIGHT_MM } from './frameNftChannels.js';

function ChannelRunTopShapes({ run, tierCount, styles }) {
  const startX = run.x - run.length / 2;
  const endX = run.x + run.length / 2;
  const segments = channelSegmentLengthsMm(run.length);
  let offset = 0;
  const items = [];

  segments.forEach((segLen, idx) => {
    items.push(
      <rect
        key={`seg-${idx}`}
        x={startX + offset}
        y={run.y - run.width / 2}
        width={segLen}
        height={run.width}
        style={styles.channel}
      />,
    );
    offset += segLen;
    if (idx < segments.length - 1 && channelNeedsSleeves(run.length)) {
      const jointX = startX + offset;
      const sleeveSize = run.width * 0.42;
      items.push(
        <rect
          key={`sl-${idx}`}
          x={jointX - sleeveSize / 2}
          y={run.y - sleeveSize / 2}
          width={sleeveSize}
          height={sleeveSize}
          style={styles.channelSleeve}
        />,
      );
    }
  });

  const elbowSize = run.width * 1.05;
  if (run.tierIndex > 0) {
    const side = tierSnakeConnectSide(run.tierIndex - 1);
    const ex = side === 'right' ? endX : startX;
    items.push(
      <rect
        key="el-lo"
        x={ex - elbowSize / 2}
        y={run.y - elbowSize / 2}
        width={elbowSize}
        height={elbowSize}
        style={styles.channelDrop}
      />,
    );
  }
  if (run.tierIndex < tierCount - 1) {
    const side = tierSnakeConnectSide(run.tierIndex);
    const ex = side === 'right' ? endX : startX;
    items.push(
      <rect
        key="el-hi"
        x={ex - elbowSize / 2}
        y={run.y - elbowSize / 2}
        width={elbowSize}
        height={elbowSize}
        style={styles.channelDrop}
      />,
    );
  }

  return items;
}

function DimensionLine({ x1, y1, x2, y2, label, offset = 40, isVertical = false, isRotatedText = false }) {
  const styles = {
    line: { stroke: '#000', strokeWidth: 1 },
    text: { fill: '#000', fontSize: '24px', textAnchor: 'middle', fontFamily: 'sans-serif' }
  };

  const dx = isVertical ? -offset : 0;
  const dy = isVertical ? 0 : offset;
  
  const extLength = 20;

  const cx = (x1 + x2) / 2 + dx;
  const cy = (y1 + y2) / 2 + dy;

  const textTransform = isRotatedText ? `rotate(-90 ${cx} ${cy})` : '';

  return (
    <g>
      {/* Extension lines */}
      <line x1={x1} y1={y1} x2={x1 + dx + (isVertical ? -extLength : 0)} y2={y1 + dy + (isVertical ? 0 : extLength)} style={styles.line} />
      <line x1={x2} y1={y2} x2={x2 + dx + (isVertical ? -extLength : 0)} y2={y2 + dy + (isVertical ? 0 : extLength)} style={styles.line} />
      
      {/* Main dimension line */}
      <line x1={x1 + dx} y1={y1 + dy} x2={x2 + dx} y2={y2 + dy} style={styles.line} />
      
      {/* Arrows (simple ticks for now, or actual arrows) */}
      <polygon points={isVertical 
        ? `${x1+dx},${y1} ${x1+dx-5},${y1+10} ${x1+dx+5},${y1+10}` 
        : `${x1},${y1+dy} ${x1+10},${y1+dy-5} ${x1+10},${y1+dy+5}`} fill="#000" />
      <polygon points={isVertical 
        ? `${x2+dx},${y2} ${x2+dx-5},${y2-10} ${x2+dx+5},${y2-10}` 
        : `${x2},${y2+dy} ${x2-10},${y2+dy-5} ${x2-10},${y2+dy+5}`} fill="#000" />

      {/* Label */}
      <text x={cx} y={isVertical ? cy + 8 : cy - 8} style={styles.text} transform={textTransform}>
        {Math.round(label)}
      </text>
    </g>
  );
}

export default function FrameDrawings2D({ params, geom }) {
  if (!geom || geom.validationErrors?.length || !geom.posts) {
    return null;
  }

  const { lengthMm, depthMm, tubeWidthMm, tubeHeightMm, tierCount, showDimensions, connectionType, showTrays, trayEnabled } = params;
  const isAngle = params.constructionType === 'perforated_angle';
  const showConnectors = isAngle ? false : params.showConnectors;
  const showChannelVis = shouldShowNftChannels(params);
  const nft = geom.nftChannels;
  const totalDepthMm = geom.dimensions?.depthMm ?? depthMm;
  const postHeight = geom.postHeight;
  const scale = 1;

  // Render scale calculation
  const padding = 100;
  const getViewBox = (w, h) => `0 0 ${w + padding * 2} ${h + padding * 2}`;
  
  const viewBoxFront = getViewBox(lengthMm, postHeight);
  const viewBoxSide = getViewBox(totalDepthMm, postHeight);
  const viewBoxTop = getViewBox(lengthMm, totalDepthMm);

  const crabSize = 12; // Visual size in SVG units, not scaled by mm

  const styles = {
    post: { fill: '#4f5b66', stroke: '#333', strokeWidth: 1 },
    long: { fill: '#cc5500', stroke: '#333', strokeWidth: 1 },
    cross: { fill: '#666666', stroke: '#333', strokeWidth: 1 },
    crab: { fill: '#ffd700', stroke: '#b8860b', strokeWidth: 1 },
    tray: { fill: '#b0b8c0', stroke: '#707880', strokeWidth: 1, fillOpacity: 0.55 },
    channel: { fill: '#4ec4ef', stroke: '#157aa3', strokeWidth: 1.2, fillOpacity: 0.88 },
    channelDrop: { fill: '#1e9fd4', stroke: '#157aa3', strokeWidth: 1.4, fillOpacity: 0.95 },
    channelSleeve: { fill: '#ff8f00', stroke: '#e65100', strokeWidth: 1.2, fillOpacity: 0.95 },
  };

  return (
    <div className="fc-drawings">
      {/* FRONT VIEW */}
      <div className="fc-drawing">
        <h4 className="fc-drawing__title">Вид спереди</h4>
        <div className="fc-drawing__frame">
          <svg viewBox={viewBoxFront} style={{ width: '100%', height: '100%' }}>
            <g transform={`translate(${padding}, ${padding})`}>
              {/* Posts */}
              {geom.posts.filter(p => p.y === tubeWidthMm / 2).map((p, i) => (
                <rect key={`p-${i}`} x={p.x - tubeWidthMm / 2} y={postHeight - p.z - p.length / 2} width={tubeWidthMm} height={p.length} style={styles.post} />
              ))}
              {/* Longitudinal Beams */}
              {geom.longitudinalBeams.filter(b => b.y === tubeWidthMm / 2).map((b, i) => (
                <rect key={`l-${i}`} x={b.x - b.length / 2} y={postHeight - b.z - tubeHeightMm / 2} width={b.length} height={tubeHeightMm} style={styles.long} />
              ))}
            {/* Connectors */}
            {showConnectors && connectionType === 'crab' && geom.connectors.filter(c => c.y === tubeWidthMm / 2 && c.axis === 'post').map((c, i) => {
              let rot = 0;
              if (c.type === 'G') {
                rot = c.orientation === 'left' ? 180 : 0;
              } else if (c.type === 'T') {
                rot = c.orientation === 'right' ? 90 : -90;
              }
              return <Crab2D key={`c-${i}`} x={c.x} y={postHeight - c.z} type={c.type} rotation={rot} scale={scale} />
            })}

            {showChannelVis && nft?.runs?.map((c, i) => (
              <rect
                key={`ch-f-${i}`}
                x={c.x - c.length / 2}
                y={postHeight - c.z - c.height / 2}
                width={c.length}
                height={c.height}
                style={styles.channel}
              />
            ))}
            {showChannelVis && nft?.drops?.map((c, i) => (
              <rect
                key={`ch-fd-${i}`}
                x={c.x - c.width / 2}
                y={postHeight - c.z - c.length / 2}
                width={c.width}
                height={c.length}
                style={styles.channelDrop}
              />
            ))}
              
              {showDimensions && (
                <>
                  <DimensionLine x1={0} y1={postHeight} x2={lengthMm} y2={postHeight} label={lengthMm} offset={60} />
                  <DimensionLine x1={0} y1={postHeight} x2={0} y2={0} label={postHeight} offset={60} isVertical isRotatedText />
                  
                  {Array.from({ length: tierCount }).map((_, i) => {
                    if (i === 0) {
                      const centerZ = params.bottomOffsetMm;
                      return (
                        <DimensionLine
                          key={`d-${i}`}
                          x1={lengthMm}
                          y1={postHeight}
                          x2={lengthMm}
                          y2={postHeight - centerZ}
                          label={params.bottomOffsetMm}
                          offset={60}
                          isVertical
                          isRotatedText
                        />
                      );
                    }
                    const prevTop = geom.levels[i - 1] + tubeHeightMm / 2;
                    const top = geom.levels[i] + tubeHeightMm / 2;
                    return (
                      <DimensionLine
                        key={`d-${i}`}
                        x1={lengthMm}
                        y1={postHeight - prevTop}
                        x2={lengthMm}
                        y2={postHeight - top}
                        label={params.tierSpacingMm}
                        offset={60}
                        isVertical
                        isRotatedText
                      />
                    );
                  })}
                </>
              )}
            </g>
          </svg>
        </div>
      </div>

      {/* SIDE VIEW */}
      <div className="fc-drawing">
        <h4 className="fc-drawing__title">Вид сбоку</h4>
        <div className="fc-drawing__frame">
          <svg viewBox={viewBoxSide} style={{ width: '100%', height: '100%' }}>
            <g transform={`translate(${padding}, ${padding})`}>
              {/* Posts */}
              {geom.posts.filter(p => p.x === tubeWidthMm / 2).map((p, i) => (
                <rect key={`p-${i}`} x={p.y - tubeWidthMm / 2} y={postHeight - p.z - p.length / 2} width={tubeWidthMm} height={p.length} style={styles.post} />
              ))}
              {/* Cross Beams */}
              {geom.crossBeams.filter(b => geom.crossBeams[0] && b.x === geom.crossBeams[0].x).map((b, i) => {
                const renderZ = beamElevationCenterZ(b.z, geom, tubeHeightMm);
                return (
                  <rect key={`cb-${i}`} x={b.y - b.length / 2} y={postHeight - renderZ - tubeHeightMm / 2} width={b.length} height={tubeHeightMm} style={styles.cross} />
                );
              })}
            {/* Connectors */}
            {showConnectors && connectionType === 'crab' && geom.connectors.filter(c => c.x === tubeWidthMm / 2).map((c, i) => {
              let rot = 0;
              if (c.type === 'T' && c.axis === 'cross') {
                rot = c.orientation === 'down' ? 90 : -90;
              }
              const renderZ = beamElevationCenterZ(c.z, geom, tubeHeightMm);
              return <Crab2D key={`c-${i}`} x={c.y} y={postHeight - renderZ} type={c.type} rotation={rot} scale={scale} />;
            })}
              {showChannelVis && nft?.runs?.map((c, i) => {
                const sideW = c.width * 1.12;
                return (
                  <g key={`ch-s-${i}`}>
                    <rect
                      x={c.y - sideW / 2}
                      y={postHeight - c.z - c.height / 2}
                      width={sideW}
                      height={c.height}
                      style={styles.channel}
                    />
                    {channelNeedsSleeves(c.length) && (
                      <rect
                        x={c.y - sideW * 0.18}
                        y={postHeight - c.z - c.height * 0.28}
                        width={sideW * 0.36}
                        height={c.height * 0.56}
                        style={styles.channelSleeve}
                      />
                    )}
                  </g>
                );
              })}
              {showChannelVis && nft?.drops?.map((c, i) => (
                <rect
                  key={`ch-sd-${i}`}
                  x={c.y - c.depth / 2}
                  y={postHeight - c.z - c.length / 2}
                  width={c.depth}
                  height={c.length}
                  style={styles.channelDrop}
                />
              ))}
              {showChannelVis && nft?.elbows?.map((c, i) => {
                const size = NFT_CHANNEL_HEIGHT_MM * 0.9;
                return (
                  <rect
                    key={`ch-el-${i}`}
                    x={c.y - size / 2}
                    y={postHeight - c.z - size / 2}
                    width={size}
                    height={size}
                    style={styles.channelDrop}
                  />
                );
              })}
              {/* Trays */}
              {showTrays && trayEnabled && geom.trays.map((t, i) => (
                <rect key={`t-${i}`} x={t.y - t.width / 2} y={postHeight - t.z - t.height / 2} width={t.width} height={t.height} style={styles.tray} />
              ))}
              
              {showDimensions && (
                <>
                  <DimensionLine x1={0} y1={postHeight} x2={totalDepthMm} y2={postHeight} label={totalDepthMm} offset={60} />
                  {showTrays && trayEnabled && geom.trays.length > 0 && (
                    <DimensionLine x1={geom.trays[0].y - geom.trays[0].width / 2} y1={0} x2={geom.trays[0].y + geom.trays[0].width / 2} y2={0} label={geom.trays[0].width} offset={-40} />
                  )}
                </>
              )}
            </g>
          </svg>
        </div>
      </div>

      {/* TOP VIEW */}
      <div className="fc-drawing fc-drawing--wide">
        <h4 className="fc-drawing__title">Вид сверху</h4>
        <div className="fc-drawing__frame">
          <svg viewBox={viewBoxTop} style={{ width: '100%', height: '100%' }}>
            <g transform={`translate(${padding}, ${padding})`}>
              {/* Cross Beams (top level) */}
              {geom.crossBeams.filter(b => b.z === geom.levels[geom.levels.length - 1]).map((b, i) => (
                <rect key={`cb-${i}`} x={b.x - tubeWidthMm / 2} y={b.y - b.length / 2} width={tubeWidthMm} height={b.length} style={styles.cross} />
              ))}
              {/* Longitudinal (top level) */}
              {geom.longitudinalBeams.filter(b => b.z === geom.levels[geom.levels.length - 1]).map((b, i) => (
                <rect key={`l-${i}`} x={b.x - b.length / 2} y={b.y - tubeWidthMm / 2} width={b.length} height={tubeWidthMm} style={styles.long} />
              ))}
              {/* Posts (top) */}
              {geom.posts.map((p, i) => (
                <rect key={`p-${i}`} x={p.x - tubeWidthMm / 2} y={p.y - tubeWidthMm / 2} width={tubeWidthMm} height={tubeWidthMm} style={styles.post} />
              ))}
            {/* Connectors (top) */}
            {showConnectors && connectionType === 'crab' && geom.connectors.filter(c => c.z === geom.levels[geom.levels.length - 1]).map((c, i) => {
              let rot = 0;
              if (c.type === 'T') {
                if (c.axis === 'post') {
                  rot = c.orientation === 'right' ? 90 : -90;
                } else {
                  rot = c.orientation === 'down' ? 180 : 0;
                }
              }
              return <Crab2D key={`c-${i}`} x={c.x} y={c.y} type={c.type} rotation={rot} scale={scale} />
            })}
              {showChannelVis && nft?.runs?.map((c, i) => (
                <ChannelRunTopShapes key={`ch-t-${i}`} run={c} tierCount={tierCount} styles={styles} />
              ))}
              {/* Tray (top) */}
              {showTrays && trayEnabled && geom.trays.map((t, i) => (
                <rect
                  key={`t-top-${i}`}
                  x={t.x - t.length / 2}
                  y={t.y - t.width / 2}
                  width={t.length}
                  height={t.width}
                  style={styles.tray}
                />
              ))}

              {showDimensions && (
                <>
                  <DimensionLine x1={0} y1={totalDepthMm} x2={lengthMm} y2={totalDepthMm} label={lengthMm} offset={60} />
                  <DimensionLine x1={0} y1={totalDepthMm} x2={0} y2={0} label={totalDepthMm} offset={60} isVertical isRotatedText />
                  
                  {/* Spacings for top level */}
                  {geom.beamLayouts[geom.beamLayouts.length - 1] && (
                    <>
                      {geom.beamLayouts[geom.beamLayouts.length - 1].xPositions.map((x, i, arr) => {
                        if (i === 0) {
                          return <DimensionLine key={`s-${i}`} x1={0} y1={0} x2={x} y2={0} label={x} offset={-40} />;
                        }
                        return <DimensionLine key={`s-${i}`} x1={arr[i-1]} y1={0} x2={x} y2={0} label={x - arr[i-1]} offset={-40} />;
                      })}
                      {geom.beamLayouts[geom.beamLayouts.length - 1].xPositions.length > 0 && (
                        <DimensionLine 
                          x1={geom.beamLayouts[geom.beamLayouts.length - 1].xPositions[geom.beamLayouts[geom.beamLayouts.length - 1].xPositions.length - 1]} 
                          y1={0} 
                          x2={lengthMm} 
                          y2={0} 
                          label={geom.beamLayouts[geom.beamLayouts.length - 1].endInsetMm} 
                          offset={-40} 
                        />
                      )}
                    </>
                  )}
                </>
              )}
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
}

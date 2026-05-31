import React, { useMemo } from "react";
import { motion } from "motion/react";

interface DimSource {
  _inferred?: boolean;
  _source?: 'local' | 'overview' | 'deep';
}

interface RadarChartProps {
  security: ({ score: number } & DimSource) | null;
  correctness: ({ score: number } & DimSource) | null;
  dependency: ({ score: number } & DimSource) | null;
  maintainability: ({ score: number } & DimSource) | null;
  architecture: ({ score: number } & DimSource) | null;
  performance: ({ score: number } & DimSource) | null;
  robustness: ({ score: number } & DimSource) | null;
  testQuality: ({ score: number } & DimSource) | null;
  overallScore: number | null;
  highlightedDimension: string | null;
}

const CX = 130;
const CY = 130;
const R = 70;

function polarToCartesian(angleDeg: number, radius: number) {
  const rad = (angleDeg - 90) * Math.PI / 180;
  return { x: CX + radius * Math.cos(rad), y: CY + radius * Math.sin(rad) };
}

const DIMENSIONS = [
  { key: "security", label: "安全", angle: -90 },
  { key: "correctness", label: "正确性", angle: -45 },
  { key: "dependency", label: "依赖", angle: 0 },
  { key: "performance", label: "性能", angle: 45 },
  { key: "robustness", label: "容错", angle: 90 },
  { key: "testQuality", label: "测试", angle: 135 },
  { key: "maintainability", label: "可维护", angle: 180 },
  { key: "architecture", label: "架构", angle: 225 },
] as const;

function hexagonPoints(radius: number): string {
  return DIMENSIONS.map((d) => {
    const { x, y } = polarToCartesian(d.angle, radius);
    return `${x},${y}`;
  }).join(" ");
}

function getPointColor(score: number): string {
  if (score <= 0) return "#6b7280";
  if (score < 50) return "#ef4444";
  if (score < 70) return "#f59e0b";
  return "#10b981";
}

function sourceLabel(data: DimSource | null): string {
  if (!data || data._inferred) return "";
  if (data._source === 'overview') return "快审";
  if (data._source === 'deep') return "深检";
  return "";
}

export default function RadarChart({
  security,
  correctness,
  dependency,
  maintainability,
  architecture,
  performance,
  robustness,
  testQuality,
  overallScore,
  highlightedDimension,
}: RadarChartProps) {
  const propsMap = useMemo(
    () => ({
      security,
      correctness,
      dependency,
      maintainability,
      architecture,
      performance,
      robustness,
      testQuality,
    }),
    [
      security,
      correctness,
      dependency,
      maintainability,
      architecture,
      performance,
      robustness,
      testQuality,
    ]
  );

  const scores = useMemo(() => {
    return DIMENSIONS.map((d) => {
      const dimProp = propsMap[d.key as keyof typeof propsMap];
      return dimProp?.score ?? 0;
    });
  }, [propsMap]);

  const dataPoints = useMemo(() => {
    return DIMENSIONS.map((d, i) => {
      const score = scores[i];
      const radius = (score / 100) * R;
      const { x, y } = polarToCartesian(d.angle, radius);
      return { x, y, score };
    });
  }, [scores]);

  const polygonPoints = useMemo(() => {
    return dataPoints.map((p) => `${p.x},${p.y}`).join(" ");
  }, [dataPoints]);

  const hasLowScore = useMemo(
    () => scores.some((s) => s > 0 && s < 50),
    [scores]
  );

  const hasAnyData = useMemo(() => scores.some((s) => s > 0), [scores]);

  return (
    <div className="w-[320px] h-[320px] flex items-center justify-center">
      <svg viewBox="0 0 260 260" className="w-[320px] h-[320px]">
        <polygon
          points={hexagonPoints(R)}
          fill="none"
          stroke="rgba(255,255,255,0.15)"
          strokeWidth="1"
        />
        <polygon
          points={hexagonPoints(R * 0.6)}
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth="1"
        />
        <polygon
          points={hexagonPoints(R * 0.3)}
          fill="none"
          stroke="rgba(255,255,255,0.05)"
          strokeWidth="1"
        />

        {DIMENSIONS.map((d) => {
          const { x, y } = polarToCartesian(d.angle, R);
          return (
            <line
              key={d.key}
              x1={CX}
              y1={CY}
              x2={x}
              y2={y}
              stroke="rgba(255,255,255,0.12)"
              strokeWidth="1"
            />
          );
        })}

        {hasAnyData && (
          <motion.polygon
            points={polygonPoints}
            fill="rgba(16,185,129,0.08)"
            stroke="#10b981"
            strokeWidth="1.5"
            strokeDasharray={hasLowScore ? "4 3" : undefined}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
          />
        )}

        {dataPoints.map((p, i) => {
          const dimKey = DIMENSIONS[i].key;
          const isHighlighted = highlightedDimension === dimKey;
          const opacity =
            highlightedDimension && !isHighlighted ? 0.3 : 1;
          const color = getPointColor(p.score);

          return (
            <g key={dimKey}>
              {isHighlighted && (
                <motion.circle
                  cx={p.x}
                  cy={p.y}
                  r={7}
                  fill="none"
                  stroke={color}
                  strokeWidth="1.5"
                  initial={{ opacity: 0, r: 2 }}
                  animate={{ opacity: 1, r: 7 }}
                  transition={{ duration: 0.3 }}
                />
              )}
              <motion.circle
                cx={p.x}
                cy={p.y}
                r={isHighlighted ? 5 : 4}
                fill={color}
                opacity={opacity}
                initial={{ opacity: 0 }}
                animate={{ opacity }}
                transition={{ duration: 0.4, delay: 0.05 * i }}
              />
            </g>
          );
        })}

        {DIMENSIONS.map((d) => {
          const { x, y } = polarToCartesian(d.angle, R + 24);
          const dimData = propsMap[d.key as keyof typeof propsMap];
          const srcLabel = sourceLabel(dimData);
          const labelY = srcLabel ? y - 6 : y;
          const subY = srcLabel ? y + 10 : y;
          return (
            <g key={d.key}>
              <text
                x={x}
                y={labelY}
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-zinc-400 text-[11px] font-bold"
              >
                {d.label}
              </text>
              {srcLabel && (
                <text
                  x={x}
                  y={subY}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className={srcLabel === "深检" ? "fill-emerald-400 text-[9px]" : "fill-yellow-400 text-[9px]"}
                >
                  {srcLabel}
                </text>
              )}
            </g>
          );
        })}

        {overallScore !== null && (
          <>
            <text
              x={CX}
              y={CY - 6}
              textAnchor="middle"
              className="font-bold fill-white"
              fontSize="28"
            >
              {overallScore}
            </text>
            <text
              x={CX}
              y={CY + 16}
              textAnchor="middle"
              className="fill-zinc-500"
              fontSize="10"
            >
              综合评分
            </text>
          </>
        )}
      </svg>
    </div>
  );
}
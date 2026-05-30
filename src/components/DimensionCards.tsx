import React from "react";
import { SecurityAudit, CorrectnessAudit, DependencyAudit, EngineeringScore, ChangeImpact, AuditLevel } from "../types";

export function SkeletonCard() {
  return (
    <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-3 animate-pulse">
      <div className="h-3 bg-zinc-800 rounded w-2/3 mb-2" />
      <div className="h-4 bg-zinc-800 rounded w-1/2" />
    </div>
  );
}

export function InferredBadge() {
  return <span className="text-[9px] text-zinc-600 ml-1 cursor-help" title="本地启发式分析结果">🔍</span>;
}

const levelBadgeConfig: Record<AuditLevel, { bg: string; text: string; label: string }> = {
  critical: { bg: "bg-rose-600", text: "text-white", label: "CRITICAL" },
  warning: { bg: "bg-amber-500", text: "text-zinc-950", label: "WARNING" },
  pass: { bg: "bg-emerald-500", text: "text-zinc-950", label: "PASS" },
  na: { bg: "bg-zinc-700", text: "text-zinc-400", label: "N/A" },
};

const levelBorder: Record<AuditLevel, string> = {
  critical: "border-rose-500",
  warning: "border-amber-500",
  pass: "border-emerald-500",
  na: "border-zinc-600",
};

export function LevelBadge({ level }: { level: AuditLevel }) {
  const cfg = levelBadgeConfig[level];
  return (
    <span className={`text-[8px] px-1.5 py-0.5 rounded font-black uppercase font-mono ${cfg.bg} ${cfg.text}`}>
      {cfg.label}
    </span>
  );
}

function severityColor(severity: string) {
  if (severity === "high") return "text-rose-400";
  if (severity === "medium") return "text-amber-400";
  return "text-zinc-400";
}

interface AuditCardProps {
  highlighted: boolean;
  onHover: (entering: boolean) => void;
  onClick: () => void;
  expanded: boolean;
}

function cardClasses(highlighted: boolean): string {
  return [
    "bg-zinc-900/40 border border-zinc-800 border-l-[3px] rounded-r-lg p-3 cursor-pointer",
    "transition-all duration-200",
    "hover:bg-zinc-900/60",
    highlighted ? "ring-1 ring-zinc-600 scale-[1.02]" : "",
  ].join(" ");
}

function expandIcon(expanded: boolean) {
  return (
    <span className="text-[8px] text-zinc-500 ml-auto shrink-0 transition-transform duration-200" style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}>
      ▼
    </span>
  );
}

export function SecurityCard({
  data,
  highlighted,
  onHover,
  onClick,
  expanded,
}: { data: SecurityAudit | null } & AuditCardProps) {
  if (!data) {
    return (
      <div className={cardClasses(highlighted)} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} onClick={onClick}>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-500 font-mono">🔒 Security</span>
          <LevelBadge level="na" />
          {expandIcon(false)}
        </div>
      </div>
    );
  }

  const displayVulns = expanded ? data.vulnerabilities : data.vulnerabilities.slice(0, 2);

  return (
    <div
      className={`${cardClasses(highlighted)} ${levelBorder[data.level]}`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onClick={onClick}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] text-zinc-400 font-mono">🔒 Security</span>
        <LevelBadge level={data.level} />
        {data._inferred && <InferredBadge />}
        <span className="text-[9px] text-zinc-500 font-mono">{data.score}/100</span>
        {expandIcon(expanded)}
      </div>

      {displayVulns.length > 0 ? (
        <ul className="space-y-1">
          {displayVulns.map((v, i) => (
            <li key={i} className="text-[9px] leading-relaxed">
              <span className={severityColor(v.severity)}>●</span>{" "}
              <span className="text-zinc-300">{v.category}:</span>{" "}
              <span className="text-zinc-400">{v.description.length > 60 ? v.description.slice(0, 60) + "..." : v.description}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[9px] text-zinc-500">未发现已知漏洞</p>
      )}

      {!expanded && data.vulnerabilities.length > 2 && (
        <p className="text-[8px] text-zinc-600 mt-1">还有 {data.vulnerabilities.length - 2} 项...</p>
      )}
    </div>
  );
}

const concernTypeLabel: Record<string, string> = {
  logic_error: "逻辑错误",
  race_condition: "竞态条件",
  boundary_gap: "边界缺失",
  api_misuse: "API 误用",
  null_safety: "空安全",
  state_inconsistency: "状态不一致",
};

export function CorrectnessCard({
  data,
  highlighted,
  onHover,
  onClick,
  expanded,
}: { data: CorrectnessAudit | null } & AuditCardProps) {
  if (!data) {
    return (
      <div className={cardClasses(highlighted)} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} onClick={onClick}>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-500 font-mono">✅ Correctness</span>
          <LevelBadge level="na" />
          {expandIcon(false)}
        </div>
      </div>
    );
  }

  const displayConcerns = expanded ? data.concerns : data.concerns.slice(0, 2);

  return (
    <div
      className={`${cardClasses(highlighted)} ${levelBorder[data.level]}`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onClick={onClick}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] text-zinc-400 font-mono">✅ Correctness</span>
        <LevelBadge level={data.level} />
        {data._inferred && <InferredBadge />}
        <span className="text-[9px] text-zinc-500 font-mono">{data.score}/100</span>
        {expandIcon(expanded)}
      </div>

      {displayConcerns.length > 0 ? (
        <ul className="space-y-1">
          {displayConcerns.map((c, i) => (
            <li key={i} className="text-[9px] leading-relaxed">
              <span className="text-amber-400">●</span>{" "}
              <span className="text-zinc-500">{concernTypeLabel[c.type] || c.type}:</span>{" "}
              <span className="text-zinc-300">{c.description.length > 60 ? c.description.slice(0, 60) + "..." : c.description}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[9px] text-zinc-500">未发现逻辑问题</p>
      )}

      {!expanded && data.concerns.length > 2 && (
        <p className="text-[8px] text-zinc-600 mt-1">还有 {data.concerns.length - 2} 项...</p>
      )}
    </div>
  );
}

export function DependencyCard({
  data,
  highlighted,
  onHover,
  onClick,
  expanded,
}: { data: DependencyAudit | null } & AuditCardProps) {
  if (!data) {
    return (
      <div className={cardClasses(highlighted)} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} onClick={onClick}>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-500 font-mono">📦 Dependencies</span>
          <LevelBadge level="na" />
          {expandIcon(false)}
        </div>
      </div>
    );
  }

  const allItems = [
    ...data.outdatedDeps.map((d) => ({ kind: "outdated" as const, name: d.name, detail: `${d.currentVersion}${d.latestVersion ? " → " + d.latestVersion : ""}`, risk: d.risk })),
    ...data.licenseIssues.map((l) => ({ kind: "license" as const, name: l.name, detail: l.license, risk: l.risk })),
  ];

  const displayItems = expanded ? allItems : allItems.slice(0, 2);

  return (
    <div
      className={`${cardClasses(highlighted)} ${levelBorder[data.level]}`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onClick={onClick}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] text-zinc-400 font-mono">📦 Dependencies</span>
        <LevelBadge level={data.level} />
        {data._inferred && <InferredBadge />}
        <span className="text-[9px] text-zinc-500 font-mono">{data.score}/100</span>
        {expandIcon(expanded)}
      </div>

      {displayItems.length > 0 ? (
        <ul className="space-y-1">
          {displayItems.map((item, i) => (
            <li key={i} className="text-[9px] leading-relaxed">
              <span className={item.kind === "outdated" ? "text-amber-400" : "text-rose-400"}>●</span>{" "}
              <span className="text-zinc-300">{item.name}</span>{" "}
              <span className="text-zinc-500">{item.detail}</span>{" "}
              <span className="text-zinc-600">[{item.risk}]</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[9px] text-zinc-500">无依赖问题</p>
      )}

      {!expanded && allItems.length > 2 && (
        <p className="text-[8px] text-zinc-600 mt-1">还有 {allItems.length - 2} 项...</p>
      )}
    </div>
  );
}

export function EngineeringScoreCard({
  label,
  icon,
  data,
  highlighted,
  dim,
  onHover,
  onClick,
  expanded,
}: {
  label: string;
  icon: string;
  data: EngineeringScore | null;
  highlighted: boolean;
  dim: string;
  onHover: (entering: boolean) => void;
  onClick: () => void;
  expanded: boolean;
}) {
  if (!data) {
    return (
      <div className={cardClasses(highlighted)} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} onClick={onClick}>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-500 font-mono">{icon} {label}</span>
          <span className="text-[8px] text-zinc-600 font-mono">--</span>
          {expandIcon(false)}
        </div>
      </div>
    );
  }

  const scoreColor =
    data.score >= 80 ? "text-emerald-400" :
    data.score >= 60 ? "text-amber-400" :
    "text-rose-400";

  return (
    <div
      className={`${cardClasses(highlighted)}`}
      style={dim ? { opacity: parseFloat(dim) } : undefined}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-zinc-400 font-mono">{icon} {label}</span>
        <div className="flex items-center gap-1.5">
          {data._inferred && <InferredBadge />}
          <span className={`text-sm font-black font-mono ${scoreColor}`}>{data.score}</span>
          {expandIcon(expanded)}
        </div>
      </div>

      {expanded && (
        <div className="mt-2 space-y-2 border-t border-zinc-800/60 pt-2">
          {data.highlights.length > 0 && (
            <div>
              <p className="text-[8px] text-emerald-500 uppercase font-bold mb-1">亮点</p>
              <ul className="space-y-0.5">
                {data.highlights.map((h, i) => (
                  <li key={i} className="text-[9px] text-zinc-300 flex items-start gap-1">
                    <span className="text-emerald-400 shrink-0">+</span>
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.suggestions.length > 0 && (
            <div>
              <p className="text-[8px] text-amber-500 uppercase font-bold mb-1">建议</p>
              <ul className="space-y-0.5">
                {data.suggestions.map((s, i) => (
                  <li key={i} className="text-[9px] text-zinc-400 flex items-start gap-1">
                    <span className="text-amber-400 shrink-0">→</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const impactLevelBadge: Record<string, { bg: string; text: string; label: string }> = {
  high: { bg: "bg-rose-600", text: "text-white", label: "HIGH IMPACT" },
  medium: { bg: "bg-amber-500", text: "text-zinc-950", label: "MEDIUM" },
  low: { bg: "bg-emerald-500", text: "text-zinc-950", label: "LOW" },
};

export function ImpactBar({ data }: { data: ChangeImpact | null }) {
  if (!data) return null;

  const badge = impactLevelBadge[data.level] || impactLevelBadge.medium;

  return (
    <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-3 flex items-center gap-3 flex-wrap">
      <span className="text-[10px] text-zinc-500 font-mono shrink-0">📊 Change Impact</span>
      <span className={`text-[8px] px-1.5 py-0.5 rounded font-black uppercase font-mono ${badge.bg} ${badge.text}`}>
        {badge.label}
      </span>
      {data._inferred && <InferredBadge />}

      {data.affectedModules.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[9px] text-zinc-600">模块:</span>
          {data.affectedModules.map((m, i) => (
            <span key={i} className="text-[9px] bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded font-mono">
              {m}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 text-[9px] ml-auto">
        {data.publicApiChanges && (
          <span className="text-amber-400 font-mono">⚠ Public API</span>
        )}
        {data.dataModelChanges && (
          <span className="text-rose-400 font-mono">⚠ Data Model</span>
        )}
      </div>
    </div>
  );
}

import React, { useState } from "react";
import { motion } from "motion/react";
import { SecurityAudit, CorrectnessAudit, DependencyAudit, EngineeringScore, AuditLevel, RiskItem, DataflowTrace } from "../types";

const ITEM_LABELS: Record<string, string> = {
  sql_injection: 'SQL注入',
  nosql_injection: 'NoSQL注入',
  xss: 'XSS',
  command_injection: '命令注入',
  hardcoded_secret: '硬编码密钥',
  auth_bypass: '认证绕过',
  path_traversal: '路径遍历',
  insecure_deserialization: '不安全反序列化',
  crypto_flaw: '加密缺陷',
  info_leak: '信息泄露',
  logic_error: '逻辑错误',
  race_condition: '竞态条件',
  null_safety: '空安全',
  boundary_handling: '边界处理',
  api_misuse: 'API误用',
  state_inconsistency: '状态不一致',
  error_handling: '错误处理',
};

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

export function SourceBadge({ source }: { source?: 'local' | 'overview' | 'deep' }) {
  if (source === 'local') return <span className="text-[9px] text-zinc-500/80 font-mono border border-zinc-600/30 rounded px-1 py-0.5">本地分析</span>;
  if (source === 'overview') return <span className="text-[9px] text-yellow-400/80 font-mono border border-yellow-400/30 rounded px-1 py-0.5">快速审查</span>;
  if (source === 'deep') return <span className="text-[9px] text-emerald-400/80 font-mono border border-emerald-400/30 rounded px-1 py-0.5">深度检查</span>;
  return null;
}

const levelBadgeConfig: Record<AuditLevel, { bg: string; text: string; label: string }> = {
  critical: { bg: "bg-rose-600", text: "text-white", label: "CRITICAL" },
  warning: { bg: "bg-amber-500", text: "text-zinc-950", label: "WARNING" },
  pass: { bg: "bg-emerald-500", text: "text-zinc-950", label: "PASS" },
  na: { bg: "bg-zinc-700", text: "text-zinc-400", label: "N/A" },
};

export function LevelBadge({ level }: { level: AuditLevel }) {
  const cfg = levelBadgeConfig[level];
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded font-black uppercase font-mono ${cfg.bg} ${cfg.text}`}>
      {cfg.label}
    </span>
  );
}

function renderBadges(data: { _inferred?: boolean; _source?: 'local' | 'overview' | 'deep' }) {
  if (data._inferred) return <InferredBadge />;
  return <SourceBadge source={data._source} />;
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
    "bg-zinc-900/50 border border-zinc-800 rounded-lg cursor-pointer",
    "transition-all duration-200",
    "hover:bg-zinc-900/70 hover:border-zinc-700",
    highlighted ? "ring-1 ring-emerald-500/30 scale-[1.01]" : "",
  ].join(" ");
}

function expandIcon(expanded: boolean) {
  return (
    <span className="text-[10px] text-zinc-500 ml-auto shrink-0 transition-transform duration-200" style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}>
      ▼
    </span>
  );
}

function scoreColorClass(score: number): string {
  if (score >= 80) return "text-emerald-400";
  if (score >= 60) return "text-amber-400";
  return "text-rose-400";
}

const HEADER_ROW = "flex items-center gap-2.5 px-3 py-3.5";
const BODY_WRAPPER = "mt-2 space-y-2.5 border-t border-zinc-800/60 pt-3 px-3 pb-3.5";

export function SecurityCard({
  data,
  highlighted,
  onHover,
  onClick,
  expanded,
  riskItems,
  dataflowTraces,
}: { data: SecurityAudit | null; riskItems?: RiskItem[]; dataflowTraces?: Record<string, DataflowTrace> } & AuditCardProps) {
  if (!data) {
    return (
      <motion.div initial={{ opacity: 0.6, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.25 }} className={cardClasses(highlighted)} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} onClick={onClick}>
        <div className={HEADER_ROW}>
          <span className="text-sm">🔒</span>
          <span className="text-sm text-zinc-500 font-mono font-bold">Security</span>
          <LevelBadge level="na" />
          <span className="text-sm text-zinc-600 font-mono w-10 text-right shrink-0">--</span>
          {expandIcon(false)}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0.6, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25 }}
      className={cardClasses(highlighted)}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onClick={onClick}
    >
      <div className={HEADER_ROW}>
        <span className="text-sm">🔒</span>
        <span className="text-sm text-zinc-300 font-mono font-bold">安全</span>
        <LevelBadge level={data.level} />
        {renderBadges(data)}
        <span className={`text-lg font-black font-mono w-10 text-right shrink-0 ${scoreColorClass(data.score)}`}>{data.score}</span>
        {expandIcon(expanded)}
      </div>

      {expanded && (
        <div className={BODY_WRAPPER}>
          {data.vulnerabilities.length > 0 ? (
            <ul className="space-y-1.5">
              {data.vulnerabilities.map((v, i) => (
                <li key={i} className="text-[10px] leading-relaxed">
                  <span className={severityColor(v.severity)}>●</span>{" "}
                  <span className="text-zinc-300 font-mono">{v.category}</span>
                  <span className="text-zinc-600 mx-1">—</span>
                  <span className="text-zinc-400">{v.description}</span>
                  <span className="text-zinc-600 ml-1 text-[9px]">{v.filePath}:{v.lineNumber}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[10px] text-zinc-500">未发现已知漏洞</p>
          )}
          <RiskItemPanel items={riskItems || data.items || []} traces={dataflowTraces} dimLabel="安全" />
        </div>
      )}
    </motion.div>
  );
}

export function RiskItemPanel({ items, traces, dimLabel }: {
  items: RiskItem[];
  traces?: Record<string, DataflowTrace>;
  dimLabel: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const riskCount = items.filter(i => i.verdict === 'risk').length;

  if (items.length === 0) return null;

  return (
    <div className="mt-2.5 border-t border-zinc-800/60 pt-2.5 px-3 pb-3">
      <button
        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        className="flex items-center gap-2 text-[11px] text-zinc-400 hover:text-zinc-200 w-full text-left"
      >
        <span className="text-[10px]">{expanded ? '▼' : '▶'}</span>
        <span>{dimLabel}逐项审计</span>
        {riskCount > 0 && (
          <span className="text-red-400 font-semibold text-[10px]">{riskCount} risk</span>
        )}
        <span className="text-emerald-400 text-[10px]">{items.filter(i => i.verdict === 'pass').length} pass</span>
        <span className="text-zinc-600 text-[10px]">{items.filter(i => i.verdict === 'na').length} na</span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-1 max-h-60 overflow-y-auto">
          {items.map(item => {
            const isRisk = item.verdict === 'risk';
            const isCritical = isRisk && item.severity === 'critical';
            const isWarning = isRisk && item.severity === 'warning';
            const trace = traces?.[item.id];

            return (
              <div key={item.id} className={[
                "flex items-start gap-2 text-[10px] py-1 px-2 rounded",
                isCritical ? "bg-red-950/30 border border-red-800/40" :
                isWarning ? "bg-yellow-950/30 border border-yellow-800/40" :
                item.verdict === 'pass' ? "bg-emerald-950/20 border border-emerald-800/30" :
                "bg-zinc-900/30 border border-zinc-800/30",
              ].join(" ")}>
                <span className={[
                  "mt-0.5 shrink-0 text-[10px]",
                  isRisk ? "text-red-400" : item.verdict === 'pass' ? "text-emerald-400" : "text-zinc-600",
                ].join(" ")}>
                  {isRisk ? '✕' : item.verdict === 'pass' ? '✓' : '−'}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-zinc-200 font-medium text-[10px]">{ITEM_LABELS[item.id] || item.id}</span>
                    {item.severity && (
                      <span className={[
                        "text-[8px] px-1 py-px rounded font-mono",
                        item.severity === 'critical' ? "text-red-400 bg-red-950/50" : "text-yellow-400 bg-yellow-950/50",
                      ].join(" ")}>{item.severity}</span>
                    )}
                  </div>
                  <p className="text-zinc-400 mt-0.5 leading-relaxed text-[10px]">{item.evidence}</p>
                  {item.codeLocation && (
                    <p className="text-zinc-600 text-[9px] mt-0.5 font-mono">{item.codeLocation.filePath}:{item.codeLocation.lineNumber}</p>
                  )}
                  {trace?.finalVerdict === 'confirmed_risk' && (
                    <div className="mt-1 p-1.5 bg-red-950/40 border border-red-800/30 rounded text-[9px]">
                      <span className="text-red-400 font-semibold">⛓ 数据流确认:</span>
                      <span className="text-zinc-400 ml-1">{trace.attackScenario}</span>
                    </div>
                  )}
                  {trace?.finalVerdict === 'false_positive' && (
                    <div className="mt-1 p-1.5 bg-emerald-950/30 border border-emerald-800/30 rounded text-[9px]">
                      <span className="text-emerald-400 font-semibold">✓ 误报已排除</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
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
  riskItems,
  dataflowTraces,
}: { data: CorrectnessAudit | null; riskItems?: RiskItem[]; dataflowTraces?: Record<string, DataflowTrace> } & AuditCardProps) {
  if (!data) {
    return (
      <motion.div initial={{ opacity: 0.6, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.25 }} className={cardClasses(highlighted)} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} onClick={onClick}>
        <div className={HEADER_ROW}>
          <span className="text-sm">✅</span>
          <span className="text-sm text-zinc-500 font-mono font-bold">Correctness</span>
          <LevelBadge level="na" />
          <span className="text-sm text-zinc-600 font-mono w-10 text-right shrink-0">--</span>
          {expandIcon(false)}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0.6, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25 }}
      className={cardClasses(highlighted)}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onClick={onClick}
    >
      <div className={HEADER_ROW}>
        <span className="text-sm">✅</span>
        <span className="text-sm text-zinc-300 font-mono font-bold">正确性</span>
        <LevelBadge level={data.level} />
        {renderBadges(data)}
        <span className={`text-lg font-black font-mono w-10 text-right shrink-0 ${scoreColorClass(data.score)}`}>{data.score}</span>
        {expandIcon(expanded)}
      </div>

      {expanded && (
        <div className={BODY_WRAPPER}>
          {data.concerns.length > 0 ? (
            <ul className="space-y-1.5">
              {data.concerns.map((c, i) => (
                <li key={i} className="text-[10px] leading-relaxed">
                  <span className="text-amber-400">●</span>{" "}
                  <span className="text-zinc-500 font-mono">{concernTypeLabel[c.type] || c.type}</span>
                  <span className="text-zinc-600 mx-1">—</span>
                  <span className="text-zinc-300">{c.description}</span>
                  <span className="text-zinc-600 ml-1 text-[9px]">{c.filePath}:{c.lineNumber}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[10px] text-zinc-500">未发现逻辑问题</p>
          )}
          <RiskItemPanel items={riskItems || data.items || []} traces={dataflowTraces} dimLabel="正确性" />
        </div>
      )}
    </motion.div>
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
      <motion.div initial={{ opacity: 0.6, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.25 }} className={cardClasses(highlighted)} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} onClick={onClick}>
        <div className={HEADER_ROW}>
          <span className="text-sm">📦</span>
          <span className="text-sm text-zinc-500 font-mono font-bold">Dependencies</span>
          <LevelBadge level="na" />
          <span className="text-sm text-zinc-600 font-mono w-10 text-right shrink-0">--</span>
          {expandIcon(false)}
        </div>
      </motion.div>
    );
  }

  const allItems = [
    ...data.outdatedDeps.map((d) => ({ kind: "outdated" as const, name: d.name, detail: `${d.currentVersion}${d.latestVersion ? " → " + d.latestVersion : ""}`, risk: d.risk })),
    ...data.licenseIssues.map((l) => ({ kind: "license" as const, name: l.name, detail: l.license, risk: l.risk })),
  ];

  return (
    <motion.div
      initial={{ opacity: 0.6, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25 }}
      className={cardClasses(highlighted)}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onClick={onClick}
    >
      <div className={HEADER_ROW}>
        <span className="text-sm">📦</span>
        <span className="text-sm text-zinc-300 font-mono font-bold">依赖</span>
        <LevelBadge level={data.level} />
        {renderBadges(data)}
        <span className={`text-lg font-black font-mono w-10 text-right shrink-0 ${scoreColorClass(data.score)}`}>{data.score}</span>
        {expandIcon(expanded)}
      </div>

      {expanded && (
        <div className={BODY_WRAPPER}>
          {allItems.length > 0 ? (
            <ul className="space-y-1.5">
              {allItems.map((item, i) => (
                <li key={i} className="text-[10px] leading-relaxed">
                  <span className={item.kind === "outdated" ? "text-amber-400" : "text-rose-400"}>●</span>{" "}
                  <span className="text-zinc-300 font-mono">{item.name}</span>{" "}
                  <span className="text-zinc-500">{item.detail}</span>{" "}
                  <span className="text-zinc-600">[{item.risk}]</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[10px] text-zinc-500">无依赖问题</p>
          )}
        </div>
      )}
    </motion.div>
  );
}

export function EngineeringScoreCard({
  label,
  icon,
  data,
  highlighted,
  onHover,
  onClick,
  expanded,
}: {
  label: string;
  icon: string;
  data: EngineeringScore | null;
  highlighted: boolean;
  onHover: (entering: boolean) => void;
  onClick: () => void;
  expanded: boolean;
}) {
  if (!data) {
    return (
      <motion.div initial={{ opacity: 0.6, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.25 }} className={cardClasses(highlighted)} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} onClick={onClick}>
        <div className={HEADER_ROW}>
          <span className="text-sm">{icon}</span>
          <span className="text-sm text-zinc-500 font-mono font-bold">{label}</span>
          <span className="text-sm text-zinc-600 font-mono w-10 text-right shrink-0">--</span>
          {expandIcon(false)}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0.6, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25 }}
      className={cardClasses(highlighted)}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onClick={onClick}
    >
      <div className={HEADER_ROW}>
        <span className="text-sm">{icon}</span>
        <span className="text-sm text-zinc-300 font-mono font-bold">{label}</span>
        {renderBadges(data)}
        <span className={`text-lg font-black font-mono w-10 text-right shrink-0 ${scoreColorClass(data.score)}`}>{data.score}</span>
        {expandIcon(expanded)}
      </div>

      {expanded && (
        <div className={BODY_WRAPPER}>
          {data.highlights.length > 0 && (
            <div>
              <p className="text-[9px] text-emerald-500 uppercase font-bold mb-1">亮点</p>
              <ul className="space-y-1">
                {data.highlights.map((h, i) => (
                  <li key={i} className="text-[10px] text-zinc-300 flex items-start gap-1.5">
                    <span className="text-emerald-400 shrink-0 mt-0.5">+</span>
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.suggestions.length > 0 && (
            <div>
              <p className="text-[9px] text-amber-500 uppercase font-bold mb-1">建议</p>
              <ul className="space-y-1">
                {data.suggestions.map((s, i) => (
                  <li key={i} className="text-[10px] text-zinc-400 flex items-start gap-1.5">
                    <span className="text-amber-400 shrink-0 mt-0.5">→</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}
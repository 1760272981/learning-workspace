import { useMemo, useRef, useEffect } from 'react'
import { motion, useScroll, useTransform, useReducedMotion, type MotionValue } from 'framer-motion'
import type { Concept, MarkStatus } from '../types'

interface Props {
  concepts: Concept[]
  marks: Record<string, MarkStatus>
  activeId: string | null
  onNodeClick: (id: string) => void
}

const SVG_W = 480
const CX = SVG_W / 2
const NODE_SPACING = 175
const SNAKE_AMP = 108

const KIND_COLORS: Record<string, [string, string, string]> = {
  concept: ['#bfdbfe', '#3b82f6', '#1d4ed8'],
  operation: ['#ddd6fe', '#8b5cf6', '#6d28d9'],
  fact: ['#99f6e4', '#14b8a6', '#0f766e'],
}
const STATUS_COLORS: Record<string, [string, string, string]> = {
  understood: ['#fde68a', '#f59e0b', '#b45309'],
  skipped: ['#e5e7eb', '#9ca3af', '#6b7280'],
}
const BRANCH_TINTS = ['rgba(59,130,246,0.10)', 'rgba(139,92,246,0.10)', 'rgba(20,184,166,0.10)', 'rgba(245,158,11,0.10)']

interface Pt { x: number; y: number }

function buildWaypoints(count: number): Pt[] {
  const pts: Pt[] = [{ x: CX, y: 40 }]
  for (let i = 0; i < count; i++) {
    const dir = i % 2 === 0 ? -1 : 1
    pts.push({ x: CX + dir * SNAKE_AMP, y: 40 + (i + 1) * NODE_SPACING })
  }
  pts.push({ x: CX, y: 40 + (count + 1) * NODE_SPACING })
  return pts
}

function splinePath(pts: Pt[]): string {
  if (pts.length < 2) return ''
  let d = `M${pts[0].x} ${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
  }
  return d
}

function sampleAlongCubic(pts: Pt[], perSeg = 40): (Pt & { len: number; angle: number })[] {
  const out: (Pt & { len: number; angle: number })[] = []
  let acc = 0
  let prev: Pt | null = null
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 }
    for (let t = i === 0 ? 0 : 1; t <= perSeg; t++) {
      const u = t / perSeg
      const m = 1 - u
      const x = m * m * m * p1.x + 3 * m * m * u * c1.x + 3 * m * u * u * c2.x + u * u * u * p2.x
      const y = m * m * m * p1.y + 3 * m * m * u * c1.y + 3 * m * u * u * c2.y + u * u * u * p2.y
      const dx = 3 * m * m * (c1.x - p1.x) + 6 * m * u * (c2.x - c1.x) + 3 * u * u * (p2.x - c2.x)
      const dy = 3 * m * m * (c1.y - p1.y) + 6 * m * u * (c2.y - c1.y) + 3 * u * u * (p2.y - c2.y)
      if (prev) acc += Math.hypot(x - prev.x, y - prev.y)
      out.push({ x, y, len: acc, angle: (Math.atan2(dy, dx) * 180) / Math.PI })
      prev = { x, y }
    }
  }
  return out
}

function pointAt(samples: (Pt & { len: number; angle: number })[], target: number) {
  if (samples.length === 0) return { x: CX, y: 0, angle: -90 }
  if (target <= samples[0].len) return samples[0]
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].len >= target) {
      const a = samples[i - 1], b = samples[i]
      const f = (target - a.len) / (b.len - a.len || 1)
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, angle: a.angle + (b.angle - a.angle) * f }
    }
  }
  return samples[samples.length - 1]
}

function Leaf({ x, y, angle, scale, dark }: { x: number; y: number; angle: number; scale: number; dark?: boolean }) {
  return (
    <g transform={`translate(${x}, ${y}) rotate(${angle}) scale(${scale})`}>
      <path d="M0 0 Q14 -11 31 -4 Q16 7 0 0Z" fill={dark ? '#16a34a' : '#4ade80'} />
      <path d="M2 -0.5 Q14 -6 29 -4" fill="none" stroke={dark ? '#15803d' : '#22c55e'} strokeWidth="1.2" />
    </g>
  )
}

function Cloud({ x, y, scale, depth, scrollY }: { x: number; y: number; scale: number; depth: number; scrollY: MotionValue<number> }) {
  const reduced = useReducedMotion()
  const py = useTransform(scrollY, [0, 1400], [0, -70 * depth])
  return (
    <motion.g style={{ y: py }}>
      <motion.g
        animate={reduced ? undefined : { x: [0, 22, 0] }}
        transition={{ duration: 10 + depth * 4, repeat: Infinity, ease: 'easeInOut' }}
      >
        <g transform={`translate(${x}, ${y}) scale(${scale})`} opacity="0.85">
          <ellipse cx="0" cy="0" rx="34" ry="17" fill="white" />
          <ellipse cx="-22" cy="5" rx="20" ry="13" fill="white" />
          <ellipse cx="24" cy="6" rx="22" ry="12" fill="white" />
          <ellipse cx="4" cy="-9" rx="18" ry="12" fill="white" />
        </g>
      </motion.g>
    </motion.g>
  )
}

function Pollen({ x, y, delay }: { x: number; y: number; delay: number }) {
  const reduced = useReducedMotion()
  if (reduced) return null
  return (
    <motion.circle
      cx={x} cy={y} r="2.4" fill="#fde68a"
      animate={{ y: [0, -46, 0], opacity: [0, 0.8, 0] }}
      transition={{ duration: 7, repeat: Infinity, delay, ease: 'easeInOut' }}
    />
  )
}

function FruitNode({ x, y, concept, status, isActive, onClick, index }: {
  x: number; y: number
  concept: Concept
  status?: MarkStatus
  isActive: boolean
  onClick: () => void
  index: number
}) {
  const reduced = useReducedMotion()
  const colors = status ? STATUS_COLORS[status] : KIND_COLORS[concept.kind]
  const gradId = `fruit-${concept.id}`
  const label = concept.title.length > 10 ? concept.title.slice(0, 10) + '…' : concept.title
  const verified = (concept.verifications || []).length

  return (
    <motion.g
      className="tree-node"
      role="button"
      tabIndex={0}
      aria-label={`${concept.title}，${status === 'understood' ? '已理解' : status === 'skipped' ? '已跳过' : '未标记'}，回车查看详情`}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', damping: 13, stiffness: 170, delay: 0.5 + index * 0.09 }}
      style={{ cursor: 'pointer', transformOrigin: `${x}px ${y}px` }}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      whileHover={reduced ? undefined : { scale: 1.12 }}
      whileTap={{ scale: 0.92 }}
    >
      <title>{concept.title}</title>
      <defs>
        <radialGradient id={gradId} cx="35%" cy="30%">
          <stop offset="0%" stopColor={colors[0]} />
          <stop offset="62%" stopColor={colors[1]} />
          <stop offset="100%" stopColor={colors[2]} />
        </radialGradient>
      </defs>

      {/* 键盘焦点环 */}
      <circle className="node-focus-ring" cx={x} cy={y} r="33" fill="none" stroke="#f59e0b" strokeWidth="3" opacity="0" />

      {isActive && (
        <motion.circle
          cx={x} cy={y} r="32" fill="none" stroke="#fbbf24" strokeWidth="3"
          animate={reduced ? undefined : { opacity: [1, 0.35, 1], r: [32, 38, 32] }}
          transition={{ duration: 1.4, repeat: Infinity }}
        />
      )}

      <motion.g animate={reduced ? undefined : { y: [0, -3.5, 0] }} transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut', delay: index * 0.35 }}>
        {/* 果柄 */}
        <path d={`M${x} ${y - 20} Q${x + 3} ${y - 30} ${x - 2} ${y - 38}`} fill="none" stroke="#3d9b4f" strokeWidth="3.5" strokeLinecap="round" />
        {/* 叶萼 */}
        <path d={`M${x - 11} ${y - 19} Q${x} ${y - 31} ${x + 11} ${y - 19} Q${x} ${y - 25} ${x - 11} ${y - 19}Z`} fill="#4ade80" stroke="#22c55e" strokeWidth="0.8" />
        {/* 果实 */}
        <circle cx={x} cy={y} r="24" fill={`url(#${gradId})`} stroke="rgba(18,53,36,0.18)" strokeWidth="1.2" />
        {/* 高光 */}
        <ellipse cx={x - 7} cy={y - 9} rx="7" ry="9" fill="rgba(255,255,255,0.45)" />
        <circle cx={x + 8} cy={y + 8} r="2.5" fill="rgba(255,255,255,0.3)" />
        {/* 果脐 */}
        <circle cx={x} cy={y + 15} r="2" fill="rgba(18,53,36,0.18)" />
      </motion.g>

      {/* 状态徽标 */}
      {status === 'understood' && (
        <g transform={`translate(${x + 14}, ${y - 26})`}>
          <circle r="9" fill="#f59e0b" stroke="white" strokeWidth="1.5" />
          <path transform="translate(-5,-5) scale(0.85)" d="M6 0 L7.8 4.5 L12 4.5 L8.7 7.2 L9.9 12 L6 9.3 L2.1 12 L3.3 7.2 L0 4.5 L4.2 4.5Z" fill="white" />
        </g>
      )}
      {status === 'skipped' && <circle cx={x + 18} cy={y - 18} r="7" fill="#9ca3af" stroke="white" strokeWidth="1.5" />}
      {verified > 0 && (
        <g transform={`translate(${x - 20}, ${y - 26})`}>
          <circle r="8" fill="#16a34a" stroke="white" strokeWidth="1.5" />
          <path d="M-3.5 0 L-1 2.5 L3.5 -2.5" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}

      {/* 标题 */}
      <text x={x} y={y + 43} textAnchor="middle" fill="#123524" fontSize="12.5" fontWeight="700" fontFamily="inherit" stroke="rgba(255,255,255,0.9)" strokeWidth="3.5" paintOrder="stroke">
        {label}
      </text>
    </motion.g>
  )
}

export function KnowledgeTree({ concepts, marks, activeId, onNodeClick }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { scrollY } = useScroll({ container: scrollRef })

  const { pathD, nodes, leaves, totalH, branchBands } = useMemo(() => {
    const n = concepts.length
    const wpts = buildWaypoints(n)
    const totalH = 40 + (n + 1) * NODE_SPACING + 130
    const pathD = splinePath(wpts)
    const samples = sampleAlongCubic(wpts)
    const totalLen = samples.length ? samples[samples.length - 1].len : 0

    const startLen = totalLen * 0.06
    const usable = totalLen - startLen - totalLen * 0.04
    const nodes = concepts.map((c, i) => {
      const p = pointAt(samples, startLen + (usable * (i + 0.5)) / Math.max(1, n))
      return { concept: c, x: p.x, y: p.y }
    })

    const leaves: { x: number; y: number; angle: number; scale: number; dark: boolean }[] = []
    for (let l = totalLen * 0.02; l < totalLen * 0.98; l += 60) {
      const p = pointAt(samples, l)
      const side = Math.floor(l / 60) % 2 === 0 ? 1 : -1
      const perp = p.angle + 90 * side
      const ox = Math.cos((perp * Math.PI) / 180) * 16
      const oy = Math.sin((perp * Math.PI) / 180) * 16
      leaves.push({ x: p.x + ox, y: p.y + oy, angle: perp, scale: 0.75 + (l % 3) * 0.12, dark: side > 0 })
    }

    // 分支色带 + 标签
    const branchBands: { name: string; y: number; h: number; tint: string }[] = []
    const order: string[] = []
    nodes.forEach((nd) => {
      if (!order.includes(nd.concept.branch)) order.push(nd.concept.branch)
    })
    order.forEach((name, bi) => {
      const ys = nodes.filter((nd) => nd.concept.branch === name).map((nd) => nd.y)
      const minY = Math.min(...ys) - 70
      const maxY = Math.max(...ys) + 70
      branchBands.push({ name, y: minY, h: maxY - minY, tint: BRANCH_TINTS[bi % BRANCH_TINTS.length] })
    })

    return { pathD, nodes, leaves, totalH, branchBands }
  }, [concepts])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [totalH])

  return (
    <div ref={scrollRef} className="vine-scroll h-full overflow-y-auto overflow-x-hidden">
      <svg width="100%" viewBox={`0 0 ${SVG_W} ${totalH}`} style={{ maxWidth: 520, margin: '0 auto', display: 'block' }} role="img" aria-label="知识生长藤条树">
        <defs>
          <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7cc9f2" />
            <stop offset="55%" stopColor="#bfe6fa" />
            <stop offset="100%" stopColor="#eafaf1" />
          </linearGradient>
          <linearGradient id="vineHalo" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#14532d" />
            <stop offset="50%" stopColor="#166534" />
            <stop offset="100%" stopColor="#14532d" />
          </linearGradient>
          <linearGradient id="vineBody" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#16a34a" />
            <stop offset="45%" stopColor="#3ecf6a" />
            <stop offset="100%" stopColor="#15803d" />
          </linearGradient>
          <radialGradient id="sunGlow" cx="50%" cy="50%">
            <stop offset="0%" stopColor="rgba(255,240,180,0.9)" />
            <stop offset="100%" stopColor="rgba(255,240,180,0)" />
          </radialGradient>
        </defs>

        <rect width={SVG_W} height={totalH} fill="url(#skyGrad)" />

        {/* 太阳 */}
        <circle cx={SVG_W - 70} cy={70} r="60" fill="url(#sunGlow)" />
        <circle cx={SVG_W - 70} cy={70} r="24" fill="#fde68a" />

        {/* 分支色带 */}
        {branchBands.map((b, i) => (
          <g key={i}>
            <rect x={16} y={b.y} width={SVG_W - 32} height={b.h} rx={26} fill={b.tint} />
            <g transform={`translate(30, ${b.y + 18})`}>
              <rect x={0} y={-14} width={Math.max(76, b.name.length * 14 + 24)} height={27} rx={13.5} fill="rgba(255,255,255,0.92)" stroke="#86efac" strokeWidth="1.5" />
              <text x={12} y={4} fill="#166534" fontSize="12" fontWeight="700">{b.name}</text>
            </g>
          </g>
        ))}

        <Cloud x={70} y={110} scale={0.85} depth={0.5} scrollY={scrollY} />
        <Cloud x={390} y={260} scale={0.6} depth={0.9} scrollY={scrollY} />
        <Cloud x={60} y={totalH * 0.4} scale={0.7} depth={0.7} scrollY={scrollY} />
        <Cloud x={400} y={totalH * 0.64} scale={0.9} depth={1.1} scrollY={scrollY} />
        <Cloud x={55} y={totalH * 0.86} scale={0.55} depth={0.6} scrollY={scrollY} />

        {/* 藤条：生长动画 */}
        <motion.path d={pathD} fill="none" stroke="url(#vineHalo)" strokeWidth="30" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, ease: 'easeOut' }} />
        <motion.path d={pathD} fill="none" stroke="url(#vineBody)" strokeWidth="22" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.1, ease: 'easeOut' }} />
        <path d={pathD} fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="6" strokeLinecap="round" transform="translate(-5, 0)" />
        <path d={pathD} fill="none" stroke="rgba(20,83,45,0.35)" strokeWidth="4" strokeLinecap="round" transform="translate(6, 0)" />

        {leaves.map((l, i) => <Leaf key={i} {...l} />)}

        {/* 花粉粒子 */}
        <Pollen x={90} y={totalH * 0.3} delay={0} />
        <Pollen x={380} y={totalH * 0.5} delay={2} />
        <Pollen x={120} y={totalH * 0.7} delay={4} />
        <Pollen x={360} y={totalH * 0.2} delay={1.2} />

        {nodes.map((nd, i) => (
          <FruitNode
            key={nd.concept.id}
            x={nd.x}
            y={nd.y}
            concept={nd.concept}
            status={marks[nd.concept.id]}
            isActive={activeId === nd.concept.id}
            onClick={() => onNodeClick(nd.concept.id)}
            index={i}
          />
        ))}

        {concepts.length === 0 && (
          <text x={CX} y={totalH / 2} textAnchor="middle" fill="#166534" fontSize="14">还没有知识，点右上「记录知识」让藤蔓生长</text>
        )}

        {/* 根部草甸 */}
        <ellipse cx={CX} cy={totalH - 30} rx="150" ry="28" fill="#86efac" opacity="0.65" />
        <ellipse cx={CX} cy={totalH - 34} rx="100" ry="19" fill="#4ade80" opacity="0.55" />
        {[...Array(9)].map((_, i) => (
          <path key={i} d={`M${CX - 120 + i * 30} ${totalH - 30} q3 -14 6 0`} fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" />
        ))}
      </svg>
    </div>
  )
}

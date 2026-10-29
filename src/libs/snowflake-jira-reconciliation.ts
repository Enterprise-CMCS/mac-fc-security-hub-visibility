import {isDeepStrictEqual} from 'util'
import type {Issue, NewIssueData} from './jira-lib'

export const SNOWFLAKE_STATE_KEY = 'macfc.snowflake-sync.v1'
export const DESCRIPTION_START = '[Snowflake managed finding: begin]'
export const DESCRIPTION_END = '[Snowflake managed finding: end]'

export interface SnowflakeSyncState {
  version: 1
  identity: string
  ownedLabels: string[]
  dueDateAnchor: string
  dueDates: Record<string, string>
}

export interface SnowflakeIssue extends Issue {
  properties?: Record<string, unknown>
}

export interface SnowflakePatch {
  fields: Record<string, unknown>
  update?: {labels: Array<{add: string} | {remove: string}>}
  properties: Array<{key: string; value: SnowflakeSyncState}>
}

export function syncState(
  issue: SnowflakeIssue
): SnowflakeSyncState | undefined {
  const state = issue.properties?.[SNOWFLAKE_STATE_KEY] as
    | SnowflakeSyncState
    | undefined
  if (state === undefined) return undefined
  if (
    state?.version !== 1 ||
    typeof state.identity !== 'string' ||
    !Array.isArray(state.ownedLabels) ||
    !state.ownedLabels.every(value => typeof value === 'string') ||
    typeof state.dueDateAnchor !== 'string' ||
    !Number.isFinite(Date.parse(state.dueDateAnchor)) ||
    !state.dueDates ||
    typeof state.dueDates !== 'object' ||
    Array.isArray(state.dueDates) ||
    !Object.values(state.dueDates).every(value => typeof value === 'string')
  )
    throw new Error(`Invalid Snowflake reconciliation state on ${issue.key}`)
  return state
}

export function assertIdentity(issue: Issue, identity: string): void {
  const identities = [
    ...new Set(
      (issue.fields.labels ?? []).filter(label =>
        label?.startsWith('global-finding-')
      )
    )
  ]
  if (identities.length !== 1 || identities[0] !== identity) {
    throw new Error(
      `Refusing to update ${issue.key}: conflicting or missing finding identity`
    )
  }
}

export function dueDateAnchor(
  issue?: SnowflakeIssue,
  sourceCreatedAt?: Date
): string {
  const state = issue && syncState(issue)
  if (state) return state.dueDateAnchor
  // Once adopted, persist this anchor so later source timestamp changes cannot move it.
  for (const candidate of [
    sourceCreatedAt?.toISOString(),
    issue?.fields.created
  ]) {
    if (
      typeof candidate === 'string' &&
      Number.isFinite(Date.parse(candidate))
    ) {
      return new Date(candidate).toISOString()
    }
  }
  return new Date().toISOString()
}

type DocNode = {
  type?: string
  text?: string
  content?: DocNode[]
  [key: string]: unknown
}
function nodeText(node: DocNode): string {
  return node.text ?? (node.content ?? []).map(nodeText).join('')
}

// Preserve native ADF nodes outside the managed section (including tables and marks).
export function mergeDescription(current: unknown, desired: unknown): unknown {
  if (!current) return desired
  if (typeof current === 'string' && typeof desired === 'string') {
    const start = current.indexOf(DESCRIPTION_START)
    const end = current.indexOf(DESCRIPTION_END)
    if (start < 0 && end < 0) return `${current}\n\n${desired}`
    if (
      start < 0 ||
      end < start ||
      current.indexOf(DESCRIPTION_START, start + 1) >= 0 ||
      current.indexOf(DESCRIPTION_END, end + 1) >= 0
    ) {
      throw new Error(
        'Ambiguous Snowflake description markers; preserve the description and repair the markers'
      )
    }
    return (
      current.slice(0, start) +
      desired +
      current.slice(end + DESCRIPTION_END.length)
    )
  }
  const doc = current as DocNode
  const next = desired as DocNode
  if (
    doc.type !== 'doc' ||
    next.type !== 'doc' ||
    !Array.isArray(doc.content) ||
    !Array.isArray(next.content)
  ) {
    throw new Error(
      'Unsupported description format; refusing to overwrite existing notes'
    )
  }
  const starts = doc.content.flatMap((node, index) =>
    nodeText(node) === DESCRIPTION_START ? [index] : []
  )
  const ends = doc.content.flatMap((node, index) =>
    nodeText(node) === DESCRIPTION_END ? [index] : []
  )
  if (!starts.length && !ends.length)
    return {...doc, content: [...doc.content, ...next.content]}
  if (starts.length !== 1 || ends.length !== 1 || starts[0] >= ends[0]) {
    throw new Error(
      'Ambiguous Snowflake description markers; preserve the description and repair the markers'
    )
  }
  return {
    ...doc,
    content: [
      ...doc.content.slice(0, starts[0]),
      ...next.content,
      ...doc.content.slice(ends[0] + 1)
    ]
  }
}

const SEVERITY_LABEL =
  /^(?:severity-(?:critical|high|medium|moderate|low|info|informational|unknown)|CRITICAL|HIGH|MEDIUM|MODERATE|LOW|INFO|INFORMATIONAL|UNKNOWN)$/

function configuredValueMatches(existing: unknown, desired: unknown): boolean {
  if (Array.isArray(desired)) {
    if (!Array.isArray(existing) || desired.length !== existing.length)
      return false
    // Jira may return multi-select values in a different order and enrich them
    // with self URLs/IDs. Match each configured value exactly once.
    const remaining = [...existing]
    return desired.every(value => {
      const index = remaining.findIndex(candidate =>
        configuredValueMatches(candidate, value)
      )
      if (index < 0) return false
      remaining.splice(index, 1)
      return true
    })
  }
  if (desired && typeof desired === 'object') {
    if (!existing || typeof existing !== 'object') return false
    return Object.entries(desired).every(([key, value]) =>
      configuredValueMatches((existing as Record<string, unknown>)[key], value)
    )
  }
  return isDeepStrictEqual(existing, desired)
}

export function creationState(
  desired: NewIssueData,
  anchor: string,
  dueFields: string[]
): SnowflakeSyncState {
  const identity = desired.fields.labels?.find(label =>
    label?.startsWith('global-finding-')
  )
  if (!identity) throw new Error('Missing Snowflake identity')
  return {
    version: 1,
    identity,
    ownedLabels: [...new Set(desired.fields.labels as string[])].sort(),
    dueDateAnchor: anchor,
    dueDates: Object.fromEntries(
      dueFields
        .filter(key => typeof desired.fields[key] === 'string')
        .map(key => [key, desired.fields[key]])
    )
  }
}

export function reconcileFields(
  current: SnowflakeIssue,
  desired: NewIssueData,
  anchor: string,
  dueFields: string[]
): SnowflakePatch | undefined {
  const next = creationState(desired, anchor, dueFields)
  assertIdentity(current, next.identity)
  const previous = syncState(current)
  if (previous && previous.identity !== next.identity)
    throw new Error(`Stored identity conflicts on ${current.key}`)
  const present = new Set(
    current.fields.labels?.filter((label): label is string => Boolean(label))
  )
  const wanted = new Set(next.ownedLabels)
  const owned = new Set(
    previous?.ownedLabels ??
      [...present].filter(label => SEVERITY_LABEL.test(label))
  )
  const add = [...wanted].filter(label => !present.has(label))
  const remove = [...owned].filter(
    label =>
      !wanted.has(label) &&
      present.has(label) &&
      !label.startsWith('global-finding-')
  )
  // A pre-existing arbitrary label is not silently adopted as automation-owned.
  next.ownedLabels = [...wanted]
    .filter(
      label =>
        owned.has(label) ||
        add.includes(label) ||
        SEVERITY_LABEL.test(label) ||
        label === next.identity
    )
    .sort()
  next.dueDates = {...previous?.dueDates}
  const fields: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(desired.fields)) {
    if (['labels', 'project', 'issuetype'].includes(key)) continue
    const existing = current.fields[key]
    if (
      key.startsWith('customfield_') &&
      !dueFields.includes(key) &&
      configuredValueMatches(existing, value)
    )
      continue
    if (dueFields.includes(key)) {
      if (
        existing &&
        existing !== previous?.dueDates[key] &&
        existing !== value
      )
        continue
      next.dueDates[key] = String(value)
    }
    let merged = value
    if (key === 'description') merged = mergeDescription(existing, value)
    if (key === 'assignee') {
      const idKey = value.accountId ? 'accountId' : 'name'
      if (existing?.[idKey] === value[idKey]) continue
    }
    if (key === 'priority' && existing?.name === value.name) continue
    if (!isDeepStrictEqual(existing, merged)) fields[key] = merged
  }
  const labels = [
    ...add.map(label => ({add: label})),
    ...remove.map(label => ({remove: label}))
  ]
  if (
    !Object.keys(fields).length &&
    !labels.length &&
    isDeepStrictEqual(previous, next)
  )
    return undefined
  return {
    fields,
    ...(labels.length ? {update: {labels}} : {}),
    properties: [{key: SNOWFLAKE_STATE_KEY, value: next}]
  }
}

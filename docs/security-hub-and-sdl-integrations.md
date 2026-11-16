# Security Hub and SDL integrations
## 1. Purpose and scope

This application is a GitHub Action that turns security findings into Jira work and manages selected parts of the ticket lifecycle. It offers two mutually exclusive source modes per run:

- **Security Hub integration**: `finding-source: aws-security-hub` reads AWS Security Hub findings directly.
- **SDL integration**: `finding-source: snowflake` reads the Security Data Lake's consolidated findings view in Snowflake.

Here, **SDL means the Snowflake-to-Jira integration implemented in this repository**. The broader lake's scanner ingestion, SQL pipelines, dashboards, reporting, and data governance are upstream capabilities. This action consumes their results; it does not provision or operate those services. A Security Hub finding can also appear in an SDL view, but the two Jira modes do not share ticket identity or automatically merge their tickets.

This document describes source code, configuration, and repository tests. “No” in the comparison means absent from this integration's implemented behavior, not absent from the underlying vendor platform.

## 2. How the integrations fit together

```text
AWS findings -> AWS Security Hub -> direct Security Hub sync -> Jira

Scanner/source ingestion -> SDL Snowflake findings view -> SDL sync -> Jira
```

Both modes use the shared Jira client. The caller supplies the schedule, credentials, Jira project, and workflow configuration. A run selects one source; separate jobs or workflows are needed to run both modes.

Neither mode scans assets, fixes vulnerabilities, writes resolution back to its finding source, or deduplicates the same vulnerability across different source modes.

## 3. Security Hub integration

### 3.1 What it does

The direct AWS integration retrieves findings visible to the configured AWS credentials in the target region, finds associated Jira issues, closes or marks resolved issues whose findings are absent from the selected active set, and creates tasks for new findings.

The run obtains the caller account ID through STS and attempts to enrich findings with an IAM account alias. The Jira search normally uses the project, `security-hub`, caller account ID, and region labels. This is the implemented ownership boundary; the action does not orchestrate assuming roles across multiple accounts or looping over regions.

### 3.2 Which findings it selects

The Security Hub API query applies:

| Selection | Implemented behavior |
| --- | --- |
| Record state | `ACTIVE` |
| Workflow status | `NEW` or `NOTIFIED` |
| Severity | Configurable; defaults to `CRITICAL,HIGH,MEDIUM` |
| Age | Creation time at least `security-hub-new-issue-delay` milliseconds old; default 86,400,000 milliseconds (24 hours) |
| Product | Defaults to product `Security Hub`; `include-all-products` expands selection |
| Product exclusions | `skip-products`, with special handling for `Default` and Tenable |
| Pagination | Follows Security Hub next tokens, requesting 100 findings per page |

The severity allowlist accepts `INFORMATIONAL`, `LOW`, `MEDIUM`, `HIGH`, and `CRITICAL`. The age delay reduces tickets for short-lived findings. There is no equivalent FISMA filter in this direct mode.

Tenable findings reported as product `Default` with a Tenable company name are recognized and represented as Tenable. Product filters interact with this special handling; validate the returned set for the intended products before relying on absence to close tickets.

### 3.3 Matching and duplicate avoidance

Matching is based on finding titles and resource identifiers appearing in Jira description text. It is not based on the SDL stable hash.

- Same title with different resources can result in separate tickets.
- Changing identifying labels or description content can disrupt matching.
- Jira issues in `jira-ignore-statuses` are excluded from the normal search; defaults are `Done, Closed, Resolved`.
- There is no explicit returning-finding reopen policy in this mode. A closed issue excluded from search is not reused through the SDL reopen mechanism.

Optional `jira-consolidate-tickets: 'true'` groups new same-title findings within a run and combines their resources. It does not continually append all later findings to one permanent title-based ticket. A consolidated ticket remains open while a represented resource remains active according to matching logic.

### 3.4 Ticket content and creation features

New issues default to Jira type `Task`, with summary `SecurityHub Finding - <title>` capped at 255 characters. Description generation includes source finding details, resources and Security Hub links, and available product/remediation context.

Default labels include source ownership, severity, account alias, product, account ID, and region. `jira-labels-config` can customize the label set and `jira-add-labels` appends labels. Because matching and due dates depend on labels, custom configurations must retain the identifiers needed for searching and severity selection.

Creation supports severity-based priority, configured assignee, custom fields, watchers, due dates, and optional Jira links. These are primarily creation-time settings; this mode does not implement the SDL ownership-aware refresh of matched active tickets.

### 3.5 Resolution behavior

`auto-close` defaults to **true**. When a managed ticket is no longer represented in the selected active findings, the integration attempts Jira closure, adds a resolution comment, and optionally links the issue to another Jira issue.

With `auto-close: 'false'`, it leaves status unchanged, prefixes the summary with `Resolved`, and adds a resolution comment once while the summary already contains that marker. The current implementation changes the summary and adds a comment; it does not refresh the description for this case.

Absence is relative to the configured filters. A severity, product, account visibility, or status-selection change can remove a finding from that set without proving remediation. There is no source-completeness gate comparable to checking every producer's ingestion health.

### 3.6 Outputs and failure reporting

The AWS entry point sets `updates`, `total`, `created`, `closed`, `create-issue-errors`, `link-issue-errors-on-creation`, `link-issue-errors-on-closure`, and `jql` action outputs. `updates` contains created issue URLs; `jql` is a Jira search URL built from run updates.

Creation and creation-link errors are counted and cause the entry point to fail. Closure-link errors are counted and logged but are not included in that final creation-error failure condition. Consumers should inspect that output separately. Outputs summarize recorded work; they are not a transaction or rollback guarantee.

## 4. SDL / Snowflake integration

### 4.1 What it does

The SDL mode reads `OPEN` rows from a configured Snowflake view and reconciles Jira tasks within exactly one FISMA boundary. The default view is `BUS_CMCS.PRIVATE.VW_GLOBAL_SECURITY_FINDINGS`.

Its core benefit is a common Jira lifecycle across the tools represented in that view. Tool support comes from upstream rows satisfying the view contract; this action does not contain separate ingestion adapters for each scanner.

### 4.2 Query boundary and safety controls

Exactly one value must be supplied through either `snowflake-fisma-ids` or `snowflake-fisma-acronyms`, never both. These plural input names do not allow a multi-FISMA run. Values are trimmed and uppercased for comparison.

All tools and severities are selected by default. Optional `snowflake-tool` selects one tool and also narrows the Jira search to its canonical tool label. `aws-severities`, product filters, the AWS age delay, and AWS ticket consolidation do not control this mode.

The query:

1. Selects `UPPER(STATUS) = 'OPEN'` within the configured FISMA boundary and optional tool.
2. Uses bound parameters for FISMA and tool values and validates configured SQL object names as unquoted identifiers with at most three parts.
3. Deduplicates by tool, FISMA ID, resource ID, and finding ID, preferring the newest creation timestamp.
4. Orders by severity score descending, then creation time, tool, and finding ID.
5. Fetches `snowflake-max-rows + 1` rows; the default ceiling is 5,000. A result above the ceiling fails before Jira mutations rather than reconciling a truncated set.

The row ceiling applies after SQL deduplication. It does not certify producer freshness or completeness. A legitimately empty result can still close managed tickets if auto-close is enabled.

### 4.3 Required view contract

| Column | Use |
| --- | --- |
| `FISMA_ID` | System boundary and finding identity |
| `FISMA_ACRONYM` | Alternative boundary filter and Jira labels |
| `RESOURCE_ID` | Affected resource and identity |
| `FINDING_ID` | Source finding identifier and identity |
| `TOOL_NAME` | Source tool, identity, title prefix, and optional filter |
| `STATUS` | Only `OPEN` is selected |
| `SEVERITY` | Original source severity in the description |
| `NORMALIZED_SEVERITY` | Common severity used for Jira labels and priority |
| `SEVERITY_SCORE` | Query ordering |
| `CREATED_AT` | Description, row preference, and initial due-date anchor |
| `CLOSED_AT` | Selected and mapped; not the closure trigger for open-row reconciliation |
| `FINDING_AGE` | Description context |
| `RAW_FINDING` | JSON source details, title/description/remediation fallback, and configurable primitive labels |

Stable identity values and complete upstream data are prerequisites. The action does not independently validate every scanner's health or infer that two tools reporting the same CVE represent the same finding.

### 4.4 Stable identity and Jira ownership

The logical identity is:

```text
TOOL_NAME | FISMA_ID | RESOURCE_ID | FINDING_ID
```

A SHA-256 hash truncated to 24 hexadecimal characters becomes `global-finding-<hash>`. Created tickets receive `global-security-findings`, `snowflake-findings`, canonical FISMA labels, `tool-<tool>`, `severity-<severity>`, and plain normalized severity labels.

Jira searches require the project, both provenance labels, the selected FISMA label, and the tool label when filtering by tool. This keeps a tool-specific run from reconciling other tools' tickets. Human-created tickets and direct Security Hub tickets without SDL ownership labels are outside this search.

Repeated runs reuse the identity. Changing identity components represents a different finding; retaining stable upstream identifiers is essential. This mechanism does not automatically migrate AWS tickets into SDL tickets.

### 4.5 Ticket creation and refresh

New tasks use `[<TOOL_NAME>] <source title>`, capped at 255 characters. Title fallbacks inspect `TITLE`, `NAME`, `RULE_NAME`, `PROBLEM_TITLE`, and `MESSAGE`, then use the tool and finding ID.

Descriptions contain the view name, tool, finding and resource IDs, FISMA context, source and normalized severity, creation time, finding age, available description/remediation text, and acceptance criteria. They do not dump every raw JSON field.

Matched active or reopened tickets receive a comparison-based refresh:

| Field | Refresh rule |
| --- | --- |
| Summary and priority | Follow current finding data |
| Mandatory and configured labels | Merge desired labels; preserve human labels and identity; remove obsolete automation-owned labels and outdated canonical severity labels |
| Description | Replace only the marked managed section; preserve notes outside it |
| Legacy description | Preserve existing content and append a managed section once |
| Assignee | Apply configured assignee; preserve when unconfigured |
| Configured `customfield_<id>` fields | Authoritative configured values, including list values |
| Unconfigured fields | Preserve |
| Due dates | Update only within ownership rules; preserve unknown ownership and manual overrides |
| Watchers | Optionally add missing configured watchers; retain existing watchers |

The issue property `macfc.snowflake-sync.v1` records identity, owned labels, due-date anchor, and previously managed due dates. Unchanged desired fields do not cause repeated field writes. Conflicting identity labels, malformed ownership state, unsupported description formats, or reserved markers can fail reconciliation rather than overwrite uncertain content.

Human notes are protected outside `[Snowflake managed finding: begin]` and `[Snowflake managed finding: end]`. Edits inside this block are automation-owned and can be replaced. Summary, priority, configured assignee, and configured custom fields do not have the same manual-override protection as due dates.

### 4.6 Returning findings and reopening

SDL searches across all statuses, independently of `jira-ignore-statuses`. A ticket is treated as closed if its status category is `done` or its resolution is populated.

For a returning identity, an active ticket takes precedence. Otherwise the most recently updated matching closed ticket is selected. Duplicate matching tickets produce a warning; this is not a duplicate-ticket cleanup feature.

`jira-reopen-transition` must identify a transition available on that issue which leads to an active status. After transition, the client verifies that Jira reports an active, unresolved issue. If no valid transition exists or verification fails, the run fails without creating a replacement ticket. Workflow configuration must actually clear resolution; setting a transition name alone does not prove that it does.

### 4.7 Resolution and automatic closure

`auto-close` defaults to **false**. Missing identities are logged and skipped; this mode does not apply the AWS `Resolved` summary prefix when closure is disabled.

When enabled, active managed tickets absent from the selected `OPEN` identity set are closed, commented, and optionally linked. Closure is based on absence from the scoped view result, not an explicit scanner-resolution API call.

Before enabling it, establish that the selected view is authoritative and complete for every included tool. The row ceiling prevents one truncation failure mode but does not detect stale ingestion, missing producers, unexpected zero rows, or upstream filter changes. Jira mutations are sequential and can partially succeed before a later failure.

### 4.8 Authentication and observability

Key-pair authentication (`SNOWFLAKE_JWT`) is the default, with optional encrypted-key passphrase. Password authentication is available through `SNOWFLAKE`. Account, username, and warehouse are required; role is configurable. Database and schema default to `BUS_CMCS` and `PRIVATE`.

The connection uses application name `MACFC_GLOBAL_SECURITY_FINDINGS_JIRA_SYNC` and query tag `macfc-global-security-findings-jira-sync`. The action reads Snowflake; it does not write finding status back to the lake.

The SDL sync logs created, updated, reopened, and closed work as JSON. **It currently returns before the AWS action-output block and does not populate the declared count, URL, error-count, or JQL outputs.** Log-based visibility and GitHub Action outputs are therefore different capabilities.

## 5. Shared Jira features and important differences

Both paths support configurable Jira endpoint/project, API versions 2 and 3, custom fields, assignee, labels, watchers at creation, due dates, issue links, closure transition configuration, and dry run.

### Due dates and priorities

Default severity deadlines are Critical 15 days, High 30 days, Medium/fallback 90 days (`due-date-moderate`), and Low 365 days. These settings can be changed with the corresponding inputs. `jira-duedate-field` adds the calculated date to a custom target field as well as standard `duedate`.

Both modes can prefer a CISA Known Exploited Vulnerabilities due date when there is an exact standalone CVE label. This is label-driven: a CVE buried only in description/raw JSON, a prefixed label, or a `multi-cve` label does not itself qualify. Feed lookup failure falls back to severity deadlines. Do not describe this as comprehensive multi-CVE deadline analysis.

AWS severity deadlines start at issue creation time. SDL anchors first to source creation time, then Jira creation time, then first synchronization time, and persists that anchor. Consequently an old SDL finding can produce an already-overdue new ticket. Later runs do not move the deadline forward simply because time has passed.

Both map Critical/High/Medium/Low to corresponding priority names and informational severity to `Lowest`; SDL unknown severity also maps to `Lowest`. Those priority names must exist in the target Jira configuration.

### Jira API and identity compatibility

API v2 uses text/markup and v3 uses Atlassian Document Format. The action manifest defaults `jira-api-version` to `2`, whereas the application's unset-input/environment fallback is `3`. Atlassian Cloud hostnames are normalized to API v3. Set the API input explicitly for predictable Enterprise behavior.

The SDL path explicitly supports Cloud assignee `{accountId: ...}`. The direct AWS path retains `{name: ...}` assignment; accepting the same input name does not establish equal Cloud assignment compatibility.

### Watchers, retries, and dry run

SDL enables watcher recovery: watcher-only 404 failures retry after 1, 2, and 4 seconds; creation-time watcher failures report partial success with the created issue key. `jira-reconcile-watchers: 'true'` adds missing watchers on later SDL runs. The direct AWS path does not enable this SDL recovery policy.

The shared HTTP client never retries the issue-creation POST, avoiding blind retries when a response may have been lost. Other eligible network/idempotent requests use bounded retries; this is not universal retry support for every Jira mutation.

`dry-run-test-data: 'true'` logs intended Jira mutations. It still requires source access and Jira reads; it is not an offline mode. AWS additionally supports a JSON fixture through `test-findings-data`, but still performs AWS identity and Jira operations. SDL does not use this fixture input.

Closure supports available workflow transitions, optional semicolon-separated rules such as `To Do:Start Progress;In Progress:Done`, or a single wildcard rule such as `*:Done`. A wildcard must be the only rule. Without a map the client attempts workflow traversal; the desired closing path should be verified for the target workflow.

## 6. Feature comparison matrix

**Yes** = implemented; **No** = absent from this mode; **Conditional** = configuration/data dependent; **Different** = supported with materially different behavior. These statuses describe this action, not all AWS or SDL platform capabilities.

| Feature | Security Hub | SDL / Snowflake | Detail |
| --- | --- | --- | --- |
| Direct Security Hub API reads | Yes | No | SDL reads a view even if upstream rows originated in Security Hub |
| Snowflake consolidated-view reads | No | Yes | Configurable view |
| Multiple source tools through one common view | No | Yes | Depends on upstream view coverage |
| Multiple Security Hub products | Conditional | No | AWS `include-all-products` and exclusions |
| AWS region selection | Yes | No | One configured region per run |
| AWS account/region ticket scope | Yes | No | SDL uses FISMA and optional tool |
| Required single FISMA boundary | No | Yes | Exactly one ID or acronym |
| Optional single-tool filter | No | Yes | Also scopes Jira reconciliation |
| Severity allowlist input | Yes | No | SDL reads all severities |
| Minimum finding-age delay | Yes | No | AWS default 24 hours |
| Product exclusions | Yes | No | `skip-products` is AWS-only |
| Tenable Default-product recognition | Yes | No | SDL relies on upstream representation |
| Source query pagination | Yes | No | SDL uses bounded SQL result |
| Row-ceiling abort before Jira writes | No | Yes | SDL default 5,000 |
| SQL identifier validation and parameter binding | No | Yes | Specific to Snowflake query |
| Deduplicate source rows by stable identity | No | Yes | SQL newest-row selection |
| Create Jira tasks for new findings | Yes | Yes | Different descriptions and titles |
| Duplicate avoidance | Different | Different | AWS title/resources; SDL hash identity |
| Same-title resource consolidation | Yes | No | AWS opt-in, within run |
| Stable hashed identity label | No | Yes | `global-finding-*` |
| Source-specific ownership labels | Yes | Yes | Different source labels and boundaries |
| Additional static labels | Yes | Yes | Creation in both; refresh in SDL |
| Configurable source-derived labels | Yes | Yes | Supported fields differ |
| Single-CVE / multi-CVE label handling | Yes | Yes | Requires label configuration |
| Severity-based priority on creation | Yes | Yes | Jira priority names must exist |
| Refresh matched summary and priority | No | Yes | SDL comparison-based updates |
| Refresh configured labels/custom fields/assignee | No | Yes | SDL ownership and configuration rules |
| Preserve human labels during refresh | No | Yes | AWS has no equivalent active-ticket refresh |
| Preserve notes outside managed description | No | Yes | SDL marked section and legacy adoption |
| Suppress unchanged reconciliation writes | No | Yes | SDL desired-field comparison |
| Persist reconciliation ownership state | No | Yes | Jira issue property |
| Custom fields at creation | Yes | Yes | SDL restricts keys to `customfield_<id>` |
| Configured assignee at creation | Yes | Yes | Identity formats differ |
| Explicit Cloud accountId assignee handling | No | Yes | SDL-specific compatibility |
| Jira API v2/v3 descriptions and comments | Yes | Yes | Cloud forces v3 |
| Severity due dates | Yes | Yes | AWS creation time; SDL fixed anchor |
| CISA KEV deadline lookup | Conditional | Conditional | Exact standalone CVE label required |
| Configurable additional due-date field | Yes | Yes | Standard due date also set |
| Fixed persisted due-date anchor | No | Yes | SDL source/Jira/first-sync fallback |
| Manual due-date override protection on refresh | No | Yes | SDL ownership-aware comparison |
| Watchers at creation | Yes | Yes | Different failure handling |
| Watcher 404 recovery policy | No | Yes | SDL enables recovery |
| Repair missing watchers on later runs | No | Yes | Opt-in; retains existing watchers |
| Automatic closure of absent findings | Yes | Yes | Defaults AWS true, SDL false |
| Explicit upstream completeness/freshness gate | No | No | Row ceiling is not this gate |
| Resolution comment when auto-close enabled | Yes | Yes | After closing |
| Mark resolved without transitioning | Yes | No | AWS prefixes summary and comments; SDL skips |
| Closure workflow map / wildcard | Yes | Yes | Shared Jira client |
| Search all statuses for returning findings | No | Yes | SDL independent of ignored statuses |
| Explicit reopen with active/unresolved verification | No | Yes | Requires valid per-issue transition |
| Refuse replacement after failed reopen | No | Yes | SDL failure policy |
| Warn on duplicate stable-identity tickets | No | Yes | Does not merge/delete duplicates |
| Jira links on creation and closure | Yes | Yes | Configurable target/type/direction |
| Dry run of Jira mutations | Yes | Yes | Live reads still occur |
| JSON source fixture input | Yes | No | AWS `test-findings-data` |
| Disable blind issue-create POST retries | Yes | Yes | Shared client safeguard |
| Declared GitHub Action count/URL/JQL outputs populated | Yes | No | SDL logs updates instead |
| Snowflake query tag/application attribution | No | Yes | Connection metadata |
| Scheduled execution | Conditional | Conditional | Calling GitHub workflow supplies schedule |
| Scanner ingestion / lake provisioning | No | No | Upstream responsibilities |
| Built-in dashboard or email/Slack delivery | No | No | Requires external consumers/platform services |
| Write source resolution back from Jira | No | No | One-way source-to-Jira lifecycle |
| Cross-tool CVE correlation or cross-mode ticket merging | No | No | Shared CVE is not identity |
| All-or-nothing rollback of a run | No | No | Earlier mutations can survive a later error |

## 7. Configuration reference by integration

| Input group | Inputs | Applies to |
| --- | --- | --- |
| Source choice | `finding-source` | Both; defaults `aws-security-hub` |
| Required Jira access | `jira-username`, `jira-token`, `jira-project-key` | Both |
| Jira endpoint/format | `jira-base-uri`, `jira-api-version` | Both |
| Creation customization | `jira-assignee`, `jira-custom-fields`, `jira-add-labels`, `jira-labels-config`, `jira-watchers` | Both; SDL also refreshes applicable fields |
| Deadlines | `due-date-critical`, `due-date-high`, `due-date-moderate`, `due-date-low`, `jira-duedate-field` | Both |
| Lifecycle | `auto-close`, `jira-transition-map` | Both |
| Search status exclusions | `jira-ignore-statuses` | AWS; SDL returning-finding search includes all statuses |
| Reopening and watcher repair | `jira-reopen-transition`, `jira-reconcile-watchers` | SDL only |
| Links | `jira-link-id-on-creation`, `jira-link-type-on-creation`, `jira-link-direction-on-creation`, and corresponding `-on-closure` inputs | Both |
| Dry run | `dry-run-test-data` | Both |
| AWS selection | `aws-region`, `aws-severities`, `security-hub-new-issue-delay`, `include-all-products`, `skip-products` | AWS only |
| AWS grouping/fixtures | `jira-consolidate-tickets`, `test-findings-data` | AWS only |
| Snowflake connection | `snowflake-account`, `snowflake-username`, `snowflake-warehouse`, `snowflake-role`, `snowflake-authenticator` | SDL only |
| Snowflake secrets | `snowflake-private-key`, `snowflake-private-key-passphrase`, or `snowflake-password` for password auth | SDL only |
| Snowflake objects | `snowflake-database`, `snowflake-schema`, `snowflake-view` | SDL only |
| SDL selection/safety | `snowflake-fisma-ids` or `snowflake-fisma-acronyms`, `snowflake-tool`, `snowflake-max-rows` | SDL only |

For the supported YAML input names use [action.yml](../action.yml). Runtime defaults and environment aliases are in [src/index.ts](../src/index.ts); do not derive every alias mechanically because some differ from the YAML name.

## 8. Setup and operation

### Security Hub

1. Supply AWS credentials through the runner's AWS credential provider chain. The code calls Security Hub `GetFindings`, STS `GetCallerIdentity`, and IAM `ListAccountAliases`; validate access for the intended region/account.
2. Configure Jira access and select `finding-source: aws-security-hub` explicitly.
3. Set severity, age delay, and product filters deliberately. Preserve ownership labels in any custom label configuration.
4. Start with dry run and inspect selected findings, Jira search scope, proposed creations, and proposed closures.
5. Configure/verify closure transitions before enabling mutation. Account for the default `auto-close: true`.
6. Consume action outputs and logs; check closure-link errors separately.

### SDL

1. Confirm view access and required columns. Grant only the necessary warehouse/database/schema usage and view SELECT to the service role.
2. Store connection credentials and Jira token in secrets. Select `finding-source: snowflake`.
3. Provide exactly one FISMA ID or acronym. For example, `MACFin` is an acronym and belongs in `snowflake-fisma-acronyms` if that is the view's identifier.
4. Decide whether the run owns all tools in that boundary or one `snowflake-tool`. Inspect the corresponding Jira labels.
5. Start with dry run and `auto-close: 'false'`. Validate source coverage, identities, due dates, field ownership, and existing Jira search matches.
6. Configure a real `jira-reopen-transition`; verify on the target workflow that it clears resolution and produces an active issue.
7. Enable watcher repair if needed. Enable automatic closure only after establishing authoritative source completeness.
8. Use the inert [Snowflake workflow example](../examples/snowflake-view-sync.yml) as a starting point. Installing the action does not itself install a schedule.

For either mode, Jira credentials need permissions for the operations actually enabled: search/read, create/edit, transitions/comments, and optionally watchers and links. Run success must be checked against the intended project and source boundary. No live calls or mutations were performed to prepare this document.


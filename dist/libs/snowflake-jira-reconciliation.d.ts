import type { Issue, NewIssueData } from './jira-lib';
export declare const SNOWFLAKE_STATE_KEY = "macfc.snowflake-sync.v1";
export declare const DESCRIPTION_START = "[Snowflake managed finding: begin]";
export declare const DESCRIPTION_END = "[Snowflake managed finding: end]";
export interface SnowflakeSyncState {
    version: 1;
    identity: string;
    ownedLabels: string[];
    dueDateAnchor: string;
    dueDates: Record<string, string>;
}
export interface SnowflakeIssue extends Issue {
    properties?: Record<string, unknown>;
}
export interface SnowflakePatch {
    fields: Record<string, unknown>;
    update?: {
        labels: Array<{
            add: string;
        } | {
            remove: string;
        }>;
    };
    properties: Array<{
        key: string;
        value: SnowflakeSyncState;
    }>;
}
export declare function syncState(issue: SnowflakeIssue): SnowflakeSyncState | undefined;
export declare function assertIdentity(issue: Issue, identity: string): void;
export declare function dueDateAnchor(issue?: SnowflakeIssue, sourceCreatedAt?: Date): string;
export declare function mergeDescription(current: unknown, desired: unknown): unknown;
export declare function creationState(desired: NewIssueData, anchor: string, dueFields: string[]): SnowflakeSyncState;
export declare function reconcileFields(current: SnowflakeIssue, desired: NewIssueData, anchor: string, dueFields: string[]): SnowflakePatch | undefined;

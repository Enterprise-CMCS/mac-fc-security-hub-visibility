import { CustomFields, JiraConfig, LabelConfig } from './libs/jira-lib';
import { GlobalSecurityFinding, SnowflakeFindingsConfig } from './libs/snowflake-lib';
export interface GlobalFindingsJiraSyncConfig extends SnowflakeFindingsConfig {
    customJiraFields?: CustomFields;
}
export declare const SNOWFLAKE_FINDINGS_LABEL = "snowflake-findings";
export declare function configuredSnowflakeLabels(finding: GlobalSecurityFinding, config?: LabelConfig[]): string[];
export declare function findingIdentity(finding: GlobalSecurityFinding): string;
export declare function findingIdentityLabel(finding: GlobalSecurityFinding): string;
export declare function findingFismaLabels(finding: GlobalSecurityFinding): string[];
export declare function reconciliationFismaLabel(config: Pick<SnowflakeFindingsConfig, 'fismaIds' | 'fismaAcronyms'>): string;
export declare function reconciliationToolLabel(toolName?: string): string | undefined;
export declare function reconciliationLabels(config: Pick<SnowflakeFindingsConfig, 'fismaIds' | 'fismaAcronyms' | 'toolName'>): string[];
export declare function findingTitle(finding: GlobalSecurityFinding): string;
export declare class GlobalFindingsJiraSync {
    private readonly jira;
    private readonly snowflake;
    private readonly jiraBaseURI;
    private readonly autoClose;
    private readonly customJiraFields?;
    private readonly jiraAddLabels;
    private readonly jiraLabelsConfig;
    private readonly jiraLinkIdOnCreation?;
    private readonly jiraLinkTypeOnCreation?;
    private readonly jiraLinkDirectionOnCreation?;
    private readonly jiraLinkIdOnClosure?;
    private readonly jiraLinkTypeOnClosure?;
    private readonly jiraLinkDirectionOnClosure?;
    private readonly fismaLabel;
    private readonly reconciliationLabels;
    private readonly view;
    private readonly reconcileWatchers;
    private readonly reopenTransition?;
    private readonly dueFields;
    constructor(jiraConfig: JiraConfig, findingsConfig: GlobalFindingsJiraSyncConfig, autoClose: boolean);
    private summary;
    private issueBody;
    private managedIdentityLabel;
    private isClosedIssue;
    private preferredIssue;
    private closeResolvedIssues;
    private buildIssue;
    private createIssue;
    private reconcileIssue;
    sync(): Promise<void>;
}

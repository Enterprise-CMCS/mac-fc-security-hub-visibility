import { CustomFields, JiraConfig } from './libs/jira-lib';
import { GlobalSecurityFinding, SnowflakeFindingsConfig } from './libs/snowflake-lib';
export interface GlobalFindingsJiraSyncConfig extends SnowflakeFindingsConfig {
    customJiraFields?: CustomFields;
}
export declare const SNOWFLAKE_FINDINGS_LABEL = "snowflake-findings";
export declare function findingIdentity(finding: GlobalSecurityFinding): string;
export declare function findingIdentityLabel(finding: GlobalSecurityFinding): string;
export declare function findingFismaLabels(finding: GlobalSecurityFinding): string[];
export declare function reconciliationFismaLabel(config: Pick<SnowflakeFindingsConfig, 'fismaIds' | 'fismaAcronyms'>): string;
export declare function findingTitle(finding: GlobalSecurityFinding): string;
export declare class GlobalFindingsJiraSync {
    private readonly jira;
    private readonly snowflake;
    private readonly jiraBaseURI;
    private readonly autoClose;
    private readonly customJiraFields?;
    private readonly fismaLabel;
    private readonly view;
    constructor(jiraConfig: JiraConfig, findingsConfig: GlobalFindingsJiraSyncConfig, autoClose: boolean);
    private summary;
    private issueBody;
    private managedIdentityLabel;
    private closeResolvedIssues;
    private createIssue;
    sync(): Promise<void>;
}

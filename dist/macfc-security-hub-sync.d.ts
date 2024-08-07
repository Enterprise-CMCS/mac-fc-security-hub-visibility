import { SecurityHubFinding } from './libs';
import { Issue, CustomFields, JiraConfig } from './libs/jira-lib';
import { Resource } from '@aws-sdk/client-securityhub';
interface UpdateForReturn {
    action: string;
    webUrl: string;
    summary: string;
}
export interface LabelConfig {
    labelField: string;
    labelPrefix?: string;
    labelDelimiter?: string;
}
export interface SecurityHubJiraSyncConfig {
    region: string;
    severities: string[];
    customJiraFields?: CustomFields;
    newIssueDelay: string;
    skipProducts?: string;
    includeAllProducts: boolean;
}
export interface SecurityHubJiraSyncConfig {
    region: string;
    severities: string[];
    customJiraFields?: CustomFields;
    newIssueDelay: string;
}
export declare class SecurityHubJiraSync {
    private readonly jira;
    private readonly securityHub;
    private readonly customJiraFields;
    private readonly region;
    private readonly severities;
    private readonly autoClose;
    private readonly jiraBaseURI;
    private jiraLinkId?;
    private jiraLinkType?;
    private jiraLinkDirection?;
    private jiraLabelsConfig?;
    constructor(jiraConfig: JiraConfig, securityHubConfig: SecurityHubJiraSyncConfig, autoClose: boolean);
    sync(): Promise<void>;
    getAWSAccountID(): Promise<string>;
    closeIssuesForResolvedFindings(jiraIssues: Issue[], shFindings: SecurityHubFinding[]): Promise<UpdateForReturn[]>;
    makeResourceList(resources: Resource[] | undefined): string;
    createSecurityHubFindingUrlThroughFilters(findingId: string): string;
    createIssueBody(finding: SecurityHubFinding): string;
    createSecurityHubFindingUrl(standardsControlArn?: string): string;
    getSeverityMappingToJiraPriority: (severity: string) => "Lowest" | "Low" | "Medium" | "High" | "Critical";
    createLabels(finding: SecurityHubFinding, identifyingLabels: string[], config: LabelConfig[]): string[];
    createJiraIssueFromFinding(finding: SecurityHubFinding, identifyingLabels: string[]): Promise<{
        action: string;
        webUrl: string;
        summary: string;
    }>;
    createJiraIssuesForNewFindings(jiraIssues: Issue[], shFindings: SecurityHubFinding[], identifyingLabels: string[]): Promise<UpdateForReturn[]>;
}
export {};

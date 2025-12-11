import { SecurityHubFinding } from './libs';
import { Issue, CustomFields, JiraConfig } from './libs/jira-lib';
import { Resource } from './libs';
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
    consolidateTickets: boolean;
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
    readonly region: string;
    private readonly severities;
    private readonly autoClose;
    private readonly jiraBaseURI;
    private jiraLinkId?;
    private jiraLinkType?;
    private jiraLinkDirection?;
    jiraLabelsConfig?: LabelConfig[];
    private jiraAddLabels?;
    private createIssueErrors;
    private linkIssueErrors;
    private jiraConsolidateTickets?;
    private testFindings;
    private apiVersion;
    constructor(jiraConfig: JiraConfig, securityHubConfig: SecurityHubJiraSyncConfig, autoClose: boolean);
    consolidateTickets(arr: SecurityHubFinding[]): SecurityHubFinding[];
    areSameLists(A: Resource[], B: Resource[]): boolean;
    isAlreadyInNew(finding: SecurityHubFinding, List: SecurityHubFinding[]): boolean;
    isNewFinding(finding: SecurityHubFinding, issues: Issue[]): boolean;
    sync(): Promise<{
        updatesForReturn: UpdateForReturn[];
        createIssueErrors: number;
        linkIssueErrors: number;
    }>;
    getAWSAccountID(): Promise<string>;
    shouldCloseTicket(ticket: Issue, findings: SecurityHubFinding[]): boolean;
    closeIssuesForResolvedFindings(jiraIssues: Issue[], shFindings: SecurityHubFinding[]): Promise<UpdateForReturn[]>;
    makeResourceList(resources: Resource[] | undefined): string;
    makeProductFieldSection(finding: SecurityHubFinding): string;
    createSecurityHubFindingUrlThroughFilters(findingId: string): string;
    createFindingUrlSection(Ids: string[]): string;
    createIssueBody(finding: SecurityHubFinding): string | {
        type: string;
        version: number;
        content: ({
            type: string;
            content?: undefined;
            attrs?: undefined;
        } | {
            type: string;
            content: {
                type: string;
                text: string;
                marks: {
                    type: string;
                }[];
            }[];
            attrs?: undefined;
        } | {
            type: string;
            content: {
                type: string;
                text: string;
            }[];
            attrs?: undefined;
        } | {
            type: string;
            attrs: {
                level: number;
            };
            content: {
                type: string;
                text: string;
            }[];
        } | {
            type: string;
            content: {
                type: string;
                content: {
                    type: string;
                    content: {
                        type: string;
                        text: string;
                    }[];
                }[];
            }[];
            attrs?: undefined;
        })[];
    };
    createSecurityHubFindingUrl(standardsControlArn?: string): string;
    getSeverityMappingToJiraPriority: (severity: string) => "Lowest" | "Low" | "Medium" | "High" | "Critical";
    createLabels(finding: SecurityHubFinding, identifyingLabels: string[], config: LabelConfig[]): string[];
    createJiraIssueFromFinding(finding: SecurityHubFinding, identifyingLabels: string[]): Promise<{
        action: string;
        webUrl: string;
        summary: string;
    }>;
    shouldCreateIssue(finding: SecurityHubFinding, jiraIssues: Issue[]): boolean;
    createJiraIssuesForNewFindings(jiraIssues: Issue[], shFindings: SecurityHubFinding[], identifyingLabels: string[]): Promise<UpdateForReturn[]>;
}
export {};

import { SecurityHubFinding } from "./libs";
import { Issue } from "./libs/jira-lib";
interface SecurityHubJiraSyncOptions {
    region?: string;
    severities?: string[];
    customJiraFields?: {
        [id: string]: any;
    };
    epicKey?: string;
}
interface UpdateForReturn {
    action: string;
    webUrl: string;
    summary: string;
}
export declare class SecurityHubJiraSync {
    private readonly jira;
    private readonly securityHub;
    private readonly customJiraFields;
    private readonly region;
    private readonly severities;
    private readonly epicKey;
    constructor(options?: SecurityHubJiraSyncOptions);
    sync(): Promise<void>;
    getAWSAccountID(): Promise<string>;
    closeIssuesForResolvedFindings(jiraIssues: Issue[], shFindings: SecurityHubFinding[]): Promise<UpdateForReturn[]>;
    createIssueBody(finding: SecurityHubFinding): string;
    createSecurityHubFindingUrl(standardsControlArn?: string): string;
    getSeverityMapping: (severity: string) => "3" | "5" | "4" | "2" | "1";
    getPriorityId: (severity: string, priorities: any[]) => any;
    getPriorityNumber: (severity: string, isEnterprise?: boolean) => string;
    createJiraIssueFromFinding(finding: SecurityHubFinding, identifyingLabels: string[]): Promise<{
        action: string;
        webUrl: any;
        summary: any;
    }>;
    createJiraIssuesForNewFindings(jiraIssues: Issue[], shFindings: SecurityHubFinding[], identifyingLabels: string[]): Promise<UpdateForReturn[]>;
}
export {};

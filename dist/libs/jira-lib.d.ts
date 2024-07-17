export interface JiraConfig {
    jiraBaseURI: string;
    jiraUsername: string;
    jiraToken: string;
    jiraProjectKey: string;
    jiraIgnoreStatuses: string;
    jiraAssignee?: string;
    transitionMap: Array<{
        status: string;
        transition: string;
    }>;
    dryRun: boolean;
    jiraLinkId?: string;
    jiraLinkType?: string;
    jiraLinkDirection?: string;
    includeAllProducts: boolean;
    skipProducts?: string;
    jiraLabelsConfig?: string;
}
export type CustomFields = {
    [key: string]: string;
};
interface IssueType {
    name: string;
}
interface PriorityField {
    name?: string;
    id?: string;
}
interface IssueFields {
    summary: string;
    description?: string;
    issuetype?: IssueType;
    labels?: (string | undefined)[];
    priority?: PriorityField;
    project?: {
        key: string;
    };
    assignee?: {
        name: string;
    };
}
export interface NewIssueData {
    fields: IssueFields;
}
export interface Issue {
    id: string;
    key: string;
    fields: IssueFields;
    webUrl: string;
}
interface Transition {
    id: string;
    name: string;
}
export declare class Jira {
    private jiraBaseURI;
    private jiraProject;
    private axiosInstance;
    private transitionMap;
    private jiraAssignee?;
    private jiraIgnoreStatusesList;
    private isDryRun;
    private dryRunIssueCounter;
    private jiraLinkId?;
    private jiraLinkType?;
    private jiraLinkDirection?;
    constructor(jiraConfig: JiraConfig);
    getCurrentUser(): Promise<any>;
    getIssue(issueId: string): Promise<any>;
    getCurrentStatus(issueId: string): Promise<any>;
    getIssueTransitions(issueId: string): Promise<Transition[]>;
    transitionIssueByName(issueId: string, transitionName: string): Promise<void>;
    removeCurrentUserAsWatcher(issueId: string): Promise<void>;
    private static formatLabelQuery;
    getAllSecurityHubIssuesInJiraProject(identifyingLabels: string[]): Promise<Issue[]>;
    createNewIssue(issue: NewIssueData): Promise<Issue>;
    linkIssues(newIssueKey: string, issueID: string, linkType?: string, linkDirection?: string): Promise<void>;
    updateIssueTitleById(issueId: string, updatedIssue: Partial<Issue>): Promise<void>;
    addCommentToIssueById(issueId: string, comment: string): Promise<void>;
    getNextTransition(currentStatus: string): string | undefined;
    applyWildcardTransition(issueId: string): Promise<boolean>;
    closeIssue(issueId: string): Promise<void>;
}
export {};

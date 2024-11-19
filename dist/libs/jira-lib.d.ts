import { LabelConfig } from 'macfc-security-hub-sync';
export interface JiraConfig {
    jiraBaseURI: string;
    jiraUsername: string;
    jiraToken: string;
    jiraProjectKey: string;
    jiraIgnoreStatuses: string;
    jiraAssignee?: string;
    jiraWatchers?: string;
    jiraAddLabels?: string;
    testFindingsData?: string;
    transitionMap: Array<{
        status: string;
        transition: string;
    }>;
    dryRunTestData: boolean;
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
    private jiraLabelsConfig?;
    private jiraWatchers?;
    constructor(jiraConfig: JiraConfig);
    getCurrentUser(): Promise<any>;
    getIssue(issueId: string): Promise<any>;
    getCurrentStatus(issueId: string): Promise<any>;
    getIssueTransitions(issueId: string): Promise<Transition[]>;
    transitionIssueByName(issueId: string, transitionName: string): Promise<void>;
    transitionIssueById(issueId: string, transitionId: string, transitionName: string): Promise<void>;
    addUserAsWatcher(issueId: string, watcher: string, isEnterprise?: boolean): Promise<void>;
    removeCurrentUserAsWatcher(issueId: string): Promise<void>;
    private static formatLabelQuery;
    createSearchLabels(identifyingLabels: string[], config: LabelConfig[]): string[];
    getAllSecurityHubIssuesInJiraProject(identifyingLabels: string[]): Promise<Issue[]>;
    createNewIssue(issue: NewIssueData): Promise<Issue>;
    linkIssues(newIssueKey: string, issueID: string, linkType?: string, linkDirection?: string): Promise<void>;
    updateIssueTitleById(issueId: string, updatedIssue: Partial<Issue>): Promise<void>;
    addCommentToIssueById(issueId: string, comment: string): Promise<void>;
    getNextTransition(currentStatus: string): string | undefined;
    applyWildcardTransition(issueId: string): Promise<boolean>;
    closeIssueUsingTransitionMap(issueId: string): Promise<void>;
    completeWorkflow(issueKey: string): Promise<void>;
    closeIssue(issueKey: string): Promise<void>;
}
export {};

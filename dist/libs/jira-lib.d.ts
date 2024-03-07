export interface Issue {
    [name: string]: any;
}
export declare class Jira {
    private isDryRun;
    private dryRunIssueCounter;
    private axiosInstance;
    jiraClosedStatuses: string[];
    constructor();
    getCurrentUser(): Promise<any>;
    getIssueTransitions(issueId: string): Promise<any>;
    transitionIssue(issueId: string, transitionData: any): Promise<void>;
    getPriorities(): Promise<any>;
    removeCurrentUserAsWatcher(issueId: string): Promise<void>;
    private static checkEnvVars;
    private static formatLabelQuery;
    getAllSecurityHubIssuesInJiraProject(identifyingLabels: string[]): Promise<Issue[]>;
    getPriorityIdsInDescendingOrder(): Promise<string[]>;
    createNewIssue(issue: Issue): Promise<Issue>;
    updateIssueTitleById(issueId: string, updatedIssue: Partial<Issue>): Promise<void>;
    addCommentToIssueById(issueId: string, comment: string): Promise<void>;
    findPathToClosure(transitions: any, currentStatus: string): Promise<any[]>;
    completeWorkflow(issueId: string): Promise<void>;
    closeIssue(issueId: string): Promise<void>;
}

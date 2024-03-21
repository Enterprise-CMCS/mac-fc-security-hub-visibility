import { Remediation, AwsSecurityFinding } from "@aws-sdk/client-securityhub";
import { SecurityHubJiraSyncConfig } from "../macfc-security-hub-sync";
export interface SecurityHubFinding {
    title?: string;
    region?: string;
    accountAlias?: string;
    awsAccountId?: string;
    severity?: string;
    description?: string;
    standardsControlArn?: string;
    remediation?: Remediation;
}
export declare class SecurityHub {
    private readonly region;
    private readonly severityLabels;
    private readonly newIssueDelay;
    private accountAlias;
    constructor(securityHubJiraSyncConfig: SecurityHubJiraSyncConfig);
    private getAccountAlias;
    getAllActiveFindings(): Promise<{
        title?: string | undefined;
        region?: string | undefined;
        accountAlias: string;
        awsAccountId?: string | undefined;
        severity?: string | undefined;
        description?: string | undefined;
        standardsControlArn?: string | undefined;
        remediation?: Remediation | undefined;
    }[]>;
    awsSecurityFindingToSecurityHubFinding(finding: AwsSecurityFinding): SecurityHubFinding;
}

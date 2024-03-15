import { Remediation, AwsSecurityFinding } from "@aws-sdk/client-securityhub";
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
    private accountAlias;
    constructor({ region, severities, }?: {
        region?: string | undefined;
        severities?: string[] | undefined;
    });
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

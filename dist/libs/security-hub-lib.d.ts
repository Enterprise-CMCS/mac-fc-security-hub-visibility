import { Remediation, AwsSecurityFinding, Resource } from "@aws-sdk/client-securityhub";
import { SecurityHubJiraSyncConfig } from "../macfc-security-hub-sync";
export interface SecurityHubFinding {
    id?: string;
    title?: string;
    region?: string;
    accountAlias?: string;
    awsAccountId?: string;
    severity?: string;
    description?: string;
    standardsControlArn?: string;
    remediation?: Remediation;
    ProductName?: string;
    Resources?: Resource[];
    [key: string]: string | unknown;
}
export declare class SecurityHub {
    private readonly region;
    private readonly severityLabels;
    private readonly newIssueDelay;
    private accountAlias;
    private includeAllProducts?;
    private skipProducts?;
    constructor(securityHubJiraSyncConfig: SecurityHubJiraSyncConfig);
    private getAccountAlias;
    getAllActiveFindings(): Promise<{
        id?: string | undefined;
        title?: string | undefined;
        region?: string | undefined;
        accountAlias: string;
        awsAccountId?: string | undefined;
        severity?: string | undefined;
        description?: string | undefined;
        standardsControlArn?: string | undefined;
        remediation?: Remediation | undefined;
        ProductName?: string | undefined;
        Resources?: Resource[] | undefined;
    }[]>;
    awsSecurityFindingToSecurityHubFinding(finding: AwsSecurityFinding): SecurityHubFinding;
}

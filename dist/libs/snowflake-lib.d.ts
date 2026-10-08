export type SnowflakeAuthenticator = 'SNOWFLAKE' | 'SNOWFLAKE_JWT';
export interface SnowflakeFindingsConfig {
    account: string;
    username: string;
    password?: string;
    privateKey?: string;
    privateKeyPassphrase?: string;
    authenticator: SnowflakeAuthenticator;
    warehouse: string;
    role?: string;
    database: string;
    schema: string;
    view: string;
    fismaIds: string[];
    fismaAcronyms: string[];
    toolName?: string;
    maxRows: number;
}
export interface GlobalSecurityFinding {
    fismaId: string;
    fismaAcronym: string;
    resourceId: string;
    findingId: string;
    toolName: string;
    status: string;
    severity: string;
    normalizedSeverity: string;
    severityScore: number;
    createdAt?: Date;
    closedAt?: Date;
    findingAge: number;
    rawFinding: Record<string, unknown>;
}
export declare function validateSnowflakeObjectName(value: string, inputName: string): string;
export declare function describeSnowflakeError(error: unknown): string;
export declare class SnowflakeFindings {
    private readonly config;
    constructor(config: SnowflakeFindingsConfig);
    private buildQuery;
    getOpenFindings(): Promise<GlobalSecurityFinding[]>;
}

type SMTPConfig = {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    to: string;
}

type FTPConfig = {
    host: string;
    port: number;
    username: string;
    password: string;
    remotePath?: string; // optional, but required for SFTP One
    uploadPath?: string; // optional, but required for SFTP Two
}

type Snowflake = {
    account: string
    username: string,
    password: string,
    warehouse: string,
    database: string,
    schema: string,
    role: string,
}

type CronitorConfig = {
    apiKey: string;
}

type MsSQLConfig = {
    server: string,
    database: string,
    username: string,
    password: string,
    options: {
        trustServerCertificate: boolean,
        encrypt: boolean,
    },
}

type StoreSchema = {
    smtp: SMTPConfig;
    sftpOne: FTPConfig;
    sftpTwo: FTPConfig;
    sftpThree: FTPConfig;
    snowflake: Snowflake;
    cronitor: CronitorConfig;
    mssql: MsSQLConfig;
}

type ScheduledTask = {
    task: () => void;
    schedule?: string; // optional, default to 1:00 AM
};

type Enquiry = {
    source_booking_id: string | null;
    departure_date: string | null;
    create_date: string | null;
    STATUS: string | null;
    is_quote_only: number;
    destination_name: string | null;
    destination_country: string | null;
    airport: string | null;
    source_type: string | null;
};

type TripDetails = {
    hotel: string | null;
    nights: number | null;
    golfers: number | null;
    non_golfers: number | null;
    rounds: number | null;
    adults: number | null;
    children: number | null;
    holiday_plans: string | null;
    budget_from: number | null;
    budget_to: number | null;
    airport: string | null;
};

type CustomerData = {
    given_name: string | null,
    surname: string | null,
    email: string | null,
    phone_number: string | null,
    newsletter_opt_in: number | null,
}

type Passenger = {
    given_name: string | null;
    surname: string | null;
}

type Marketing = {
    campaign_code: string | null,
    source: string | null,
    medium: string | null,
    ad_id: string | null,
}

type UnifiedFileInfo = SftpFileInfo | FtpFileInfo;

type CronitorPingInput = {
    state?: 'run' | 'start' | 'complete' | 'fail' | 'warn';
    message?: string;
};

type CronitorMonitor = {
    ping: (input: CronitorPingInput) => void;
};

type CronitorModule = {
    Monitor: new (name: string) => CronitorMonitor;
};

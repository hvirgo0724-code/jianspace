BEGIN;

CREATE TABLE alembic_version (
    version_num VARCHAR(32) NOT NULL, 
    CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
);

-- Running upgrade  -> b2bab41d6ad8

CREATE TABLE app_users (
    email VARCHAR(254) NOT NULL, 
    display_name VARCHAR(80) NOT NULL, 
    password_hash TEXT NOT NULL, 
    status VARCHAR(20) NOT NULL, 
    system_role VARCHAR(20) NOT NULL, 
    is_demo BOOLEAN NOT NULL, 
    id VARCHAR(36) NOT NULL, 
    created_at VARCHAR(40) NOT NULL, 
    PRIMARY KEY (id), 
    UNIQUE (email)
);

CREATE TABLE auth_challenges (
    user_id VARCHAR(36) NOT NULL, 
    purpose VARCHAR(30) NOT NULL, 
    token_hash VARCHAR(64) NOT NULL, 
    expires_epoch FLOAT NOT NULL, 
    consumed BOOLEAN NOT NULL, 
    id VARCHAR(36) NOT NULL, 
    created_at VARCHAR(40) NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(user_id) REFERENCES app_users (id), 
    UNIQUE (token_hash)
);

CREATE TABLE credit_accounts (
    user_id VARCHAR(36) NOT NULL, 
    available INTEGER NOT NULL, 
    reserved INTEGER NOT NULL, 
    PRIMARY KEY (user_id), 
    CHECK (available >= 0), 
    CHECK (reserved >= 0), 
    FOREIGN KEY(user_id) REFERENCES app_users (id)
);

CREATE TABLE idempotency_records (
    user_id VARCHAR(36) NOT NULL, 
    route VARCHAR(180) NOT NULL, 
    key VARCHAR(128) NOT NULL, 
    request_hash VARCHAR(64) NOT NULL, 
    response_json JSONB NOT NULL, 
    PRIMARY KEY (user_id, route, key), 
    FOREIGN KEY(user_id) REFERENCES app_users (id)
);

CREATE TABLE projects (
    owner_id VARCHAR(36) NOT NULL, 
    name VARCHAR(120) NOT NULL, 
    description TEXT NOT NULL, 
    revision INTEGER NOT NULL, 
    current_geometry_id VARCHAR(36), 
    current_design_id VARCHAR(36), 
    updated_at VARCHAR(40) NOT NULL, 
    archived BOOLEAN NOT NULL, 
    deleted BOOLEAN NOT NULL, 
    id VARCHAR(36) NOT NULL, 
    created_at VARCHAR(40) NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(owner_id) REFERENCES app_users (id)
);

CREATE INDEX ix_projects_owner_id ON projects (owner_id);

CREATE TABLE user_sessions (
    user_id VARCHAR(36) NOT NULL, 
    token_hash VARCHAR(64) NOT NULL, 
    csrf_hash VARCHAR(64) NOT NULL, 
    expires_epoch FLOAT NOT NULL, 
    id VARCHAR(36) NOT NULL, 
    created_at VARCHAR(40) NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(user_id) REFERENCES app_users (id), 
    UNIQUE (token_hash)
);

CREATE INDEX ix_user_sessions_user_id ON user_sessions (user_id);

CREATE TABLE audit_events (
    actor_id VARCHAR(36), 
    project_id VARCHAR(36), 
    action VARCHAR(80) NOT NULL, 
    detail_json JSONB NOT NULL, 
    id VARCHAR(36) NOT NULL, 
    created_at VARCHAR(40) NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(actor_id) REFERENCES app_users (id), 
    FOREIGN KEY(project_id) REFERENCES projects (id)
);

CREATE TABLE generation_jobs (
    project_id VARCHAR(36) NOT NULL, 
    user_id VARCHAR(36) NOT NULL, 
    type VARCHAR(30) NOT NULL, 
    status VARCHAR(30) NOT NULL, 
    stage VARCHAR(60) NOT NULL, 
    input_json JSONB NOT NULL, 
    input_hash VARCHAR(64) NOT NULL, 
    progress INTEGER NOT NULL, 
    lease_until FLOAT, 
    attempts INTEGER NOT NULL, 
    reserved_credits INTEGER NOT NULL, 
    charged_credits INTEGER NOT NULL, 
    error_code VARCHAR(60), 
    error_message TEXT, 
    output_json JSONB NOT NULL, 
    provider_task_id VARCHAR(100), 
    finished_at VARCHAR(40), 
    id VARCHAR(36) NOT NULL, 
    created_at VARCHAR(40) NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(project_id) REFERENCES projects (id), 
    FOREIGN KEY(user_id) REFERENCES app_users (id)
);

CREATE INDEX ix_generation_jobs_project_id ON generation_jobs (project_id);

CREATE INDEX ix_generation_jobs_status ON generation_jobs (status);

CREATE TABLE geometry_versions (
    project_id VARCHAR(36) NOT NULL, 
    version_no INTEGER NOT NULL, 
    scene_json JSONB NOT NULL, 
    structure_hash VARCHAR(64) NOT NULL, 
    status VARCHAR(20) NOT NULL, 
    validation_json JSONB NOT NULL, 
    confirmed_by VARCHAR(36), 
    confirmed_at VARCHAR(40), 
    id VARCHAR(36) NOT NULL, 
    created_at VARCHAR(40) NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(confirmed_by) REFERENCES app_users (id), 
    FOREIGN KEY(project_id) REFERENCES projects (id), 
    UNIQUE (project_id, version_no)
);

CREATE INDEX ix_geometry_versions_project_id ON geometry_versions (project_id);

CREATE TABLE measurement_batches (
    project_id VARCHAR(36) NOT NULL, 
    user_id VARCHAR(36) NOT NULL, 
    records_json JSONB NOT NULL, 
    source_asset_ids JSONB NOT NULL, 
    id VARCHAR(36) NOT NULL, 
    created_at VARCHAR(40) NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(project_id) REFERENCES projects (id), 
    FOREIGN KEY(user_id) REFERENCES app_users (id)
);

CREATE INDEX ix_measurement_batches_project_id ON measurement_batches (project_id);

CREATE TABLE project_assets (
    project_id VARCHAR(36) NOT NULL, 
    uploader_id VARCHAR(36) NOT NULL, 
    name VARCHAR(255) NOT NULL, 
    object_key VARCHAR(255) NOT NULL, 
    kind VARCHAR(30) NOT NULL, 
    media_type VARCHAR(100) NOT NULL, 
    bytes BIGINT NOT NULL, 
    sha256 VARCHAR(64) NOT NULL, 
    state VARCHAR(20) NOT NULL, 
    room_id VARCHAR(100), 
    metadata_json JSONB NOT NULL, 
    id VARCHAR(36) NOT NULL, 
    created_at VARCHAR(40) NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(project_id) REFERENCES projects (id), 
    FOREIGN KEY(uploader_id) REFERENCES app_users (id), 
    UNIQUE (object_key)
);

CREATE INDEX ix_project_assets_project_id ON project_assets (project_id);

CREATE TABLE project_members (
    project_id VARCHAR(36) NOT NULL, 
    user_id VARCHAR(36) NOT NULL, 
    role VARCHAR(16) NOT NULL, 
    PRIMARY KEY (project_id, user_id), 
    FOREIGN KEY(project_id) REFERENCES projects (id), 
    FOREIGN KEY(user_id) REFERENCES app_users (id)
);

CREATE TABLE project_working_copies (
    project_id VARCHAR(36) NOT NULL, 
    user_id VARCHAR(36) NOT NULL, 
    scene_json JSONB NOT NULL, 
    revision INTEGER NOT NULL, 
    base_design_id VARCHAR(36), 
    updated_at VARCHAR(40) NOT NULL, 
    PRIMARY KEY (project_id, user_id), 
    FOREIGN KEY(project_id) REFERENCES projects (id), 
    FOREIGN KEY(user_id) REFERENCES app_users (id)
);

CREATE TABLE support_reports (
    project_id VARCHAR(36) NOT NULL, 
    user_id VARCHAR(36) NOT NULL, 
    category VARCHAR(60) NOT NULL, 
    description TEXT NOT NULL, 
    id VARCHAR(36) NOT NULL, 
    created_at VARCHAR(40) NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(project_id) REFERENCES projects (id), 
    FOREIGN KEY(user_id) REFERENCES app_users (id)
);

CREATE TABLE credit_ledger (
    user_id VARCHAR(36) NOT NULL, 
    job_id VARCHAR(36), 
    event_key VARCHAR(160) NOT NULL, 
    event_type VARCHAR(30) NOT NULL, 
    delta_available INTEGER NOT NULL, 
    delta_reserved INTEGER NOT NULL, 
    id VARCHAR(36) NOT NULL, 
    created_at VARCHAR(40) NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(job_id) REFERENCES generation_jobs (id), 
    FOREIGN KEY(user_id) REFERENCES app_users (id), 
    UNIQUE (event_key)
);

CREATE INDEX ix_credit_ledger_user_id ON credit_ledger (user_id);

CREATE TABLE design_versions (
    project_id VARCHAR(36) NOT NULL, 
    geometry_version_id VARCHAR(36) NOT NULL, 
    parent_id VARCHAR(36), 
    title VARCHAR(120) NOT NULL, 
    scene_json JSONB NOT NULL, 
    scene_hash VARCHAR(64) NOT NULL, 
    creator_id VARCHAR(36) NOT NULL, 
    id VARCHAR(36) NOT NULL, 
    created_at VARCHAR(40) NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(creator_id) REFERENCES app_users (id), 
    FOREIGN KEY(geometry_version_id) REFERENCES geometry_versions (id), 
    FOREIGN KEY(parent_id) REFERENCES design_versions (id), 
    FOREIGN KEY(project_id) REFERENCES projects (id)
);

CREATE INDEX ix_design_versions_project_id ON design_versions (project_id);

CREATE TABLE outbox_events (
    job_id VARCHAR(36) NOT NULL, 
    published BOOLEAN NOT NULL, 
    id VARCHAR(36) NOT NULL, 
    created_at VARCHAR(40) NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(job_id) REFERENCES generation_jobs (id), 
    UNIQUE (job_id)
);

CREATE TABLE budget_snapshots (
    project_id VARCHAR(36) NOT NULL, 
    design_id VARCHAR(36) NOT NULL, 
    currency VARCHAR(3) NOT NULL, 
    lines_json JSONB NOT NULL, 
    subtotal_minor BIGINT NOT NULL, 
    assumptions_json JSONB NOT NULL, 
    id VARCHAR(36) NOT NULL, 
    created_at VARCHAR(40) NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(design_id) REFERENCES design_versions (id), 
    FOREIGN KEY(project_id) REFERENCES projects (id)
);

CREATE TABLE design_approvals (
    project_id VARCHAR(36) NOT NULL, 
    design_id VARCHAR(36) NOT NULL, 
    user_id VARCHAR(36) NOT NULL, 
    decision VARCHAR(30) NOT NULL, 
    note TEXT NOT NULL, 
    id VARCHAR(36) NOT NULL, 
    created_at VARCHAR(40) NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(design_id) REFERENCES design_versions (id), 
    FOREIGN KEY(project_id) REFERENCES projects (id), 
    FOREIGN KEY(user_id) REFERENCES app_users (id), 
    UNIQUE (design_id, user_id)
);

CREATE TABLE design_comments (
    project_id VARCHAR(36) NOT NULL, 
    design_id VARCHAR(36) NOT NULL, 
    author_id VARCHAR(36) NOT NULL, 
    body TEXT NOT NULL, 
    room_id VARCHAR(100), 
    object_id VARCHAR(100), 
    deleted BOOLEAN NOT NULL, 
    id VARCHAR(36) NOT NULL, 
    created_at VARCHAR(40) NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(author_id) REFERENCES app_users (id), 
    FOREIGN KEY(design_id) REFERENCES design_versions (id), 
    FOREIGN KEY(project_id) REFERENCES projects (id)
);

CREATE TABLE share_links (
    project_id VARCHAR(36) NOT NULL, 
    design_id VARCHAR(36) NOT NULL, 
    token_hash VARCHAR(64) NOT NULL, 
    expires_epoch FLOAT NOT NULL, 
    revoked BOOLEAN NOT NULL, 
    include_budget BOOLEAN NOT NULL, 
    id VARCHAR(36) NOT NULL, 
    created_at VARCHAR(40) NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(design_id) REFERENCES design_versions (id), 
    FOREIGN KEY(project_id) REFERENCES projects (id), 
    UNIQUE (token_hash)
);

INSERT INTO alembic_version (version_num) VALUES ('b2bab41d6ad8') RETURNING alembic_version.version_num;

COMMIT;


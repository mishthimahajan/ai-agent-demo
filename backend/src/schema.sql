CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY,
    issue_number INTEGER,
    issue_title TEXT NOT NULL,
    issue_body TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'queued'
       CHECK (
        status IN (
            'queued',
            'planning',
            'implementing',
            'testing',
            'awaiting_approval',
'approval_in_progress',
'pr_created',
'approval_failed',
'completed',
'failed'
        )
       ),
    plan JSONB,
    proposal JSONB,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_events (
    id BIGSERIAL PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    message TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at
    ON tasks (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_status
    ON tasks (status);
CREATE INDEX IF NOT EXISTS idx_task_events_task_id
    ON task_events (task_id,created_at);
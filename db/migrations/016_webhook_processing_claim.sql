ALTER TABLE webhook_events
  ADD COLUMN processing_started_at timestamptz;

CREATE INDEX idx_webhooks_processing_started
  ON webhook_events (processing_started_at)
  WHERE processed_at IS NULL
    AND processing_started_at IS NOT NULL;
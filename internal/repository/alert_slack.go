package repository

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

type SlackAlertClient struct {
	webhookURL string
	httpClient *http.Client
}

func NewSlackAlertClient(webhookURL string, httpClient *http.Client) *SlackAlertClient {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	return &SlackAlertClient{webhookURL: webhookURL, httpClient: httpClient}
}

func (c *SlackAlertClient) SendError(ctx context.Context, alert Alert) error {
	if c.webhookURL == "" {
		return fmt.Errorf("slack webhook URL is required")
	}
	body := map[string]string{
		"text": fmt.Sprintf(
			"obsflow error tick_run_id=%s failures=%s",
			alert.TickRunID,
			alert.Summary(),
		),
	}
	data, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("encode slack alert: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.webhookURL, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("create slack request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send slack alert: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("send slack alert: status %d", resp.StatusCode)
	}
	return nil
}

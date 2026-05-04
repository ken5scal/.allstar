package repository

import (
	"context"
	"sync"
)

type MockAlertClient struct {
	mu       sync.Mutex
	Messages []Alert
	Events   []AlertFailure
	Err      error
}

func NewMockAlertClient() *MockAlertClient {
	return &MockAlertClient{}
}

func (c *MockAlertClient) SendError(ctx context.Context, msg Alert) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.Messages = append(c.Messages, msg)
	c.Events = append(c.Events, msg.Failures...)
	return c.Err
}

func (c *MockAlertClient) SentMessages() []Alert {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]Alert(nil), c.Messages...)
}

func (c *MockAlertClient) SentEvents() []AlertFailure {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]AlertFailure(nil), c.Events...)
}

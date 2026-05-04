package repository

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"

	"github.com/ken5scal/obsflow/internal/model"
)

type XURLCommandRunner interface {
	Run(ctx context.Context, bin string, args ...string) ([]byte, error)
}

type XURLCommand func(ctx context.Context, bin string, args ...string) ([]byte, error)

func (fn XURLCommand) Run(ctx context.Context, bin string, args ...string) ([]byte, error) {
	return fn(ctx, bin, args...)
}

type ExecXURLCommandRunner struct{}

func (ExecXURLCommandRunner) Run(ctx context.Context, bin string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, bin, args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg != "" {
			return nil, fmt.Errorf("xurl command failed: %w: %s", err, msg)
		}
		return nil, fmt.Errorf("xurl command failed: %w", err)
	}
	return out, nil
}

type XURLClient struct {
	bin    string
	runner XURLCommandRunner
}

func NewXURLClient(bin string, runner XURLCommandRunner) *XURLClient {
	if bin == "" {
		bin = "xurl"
	}
	if runner == nil {
		runner = ExecXURLCommandRunner{}
	}
	return &XURLClient{bin: bin, runner: runner}
}

func (c *XURLClient) Search(ctx context.Context, sourceID string, query string) ([]model.SourceItem, error) {
	if query == "" {
		return nil, fmt.Errorf("xurl search query is required")
	}
	out, err := c.runner.Run(ctx, c.bin, "GET", "/2/tweets/search/recent", "-d", "query="+query)
	if err != nil {
		return nil, err
	}
	return parseXFixture(sourceID, "x-search", out)
}

func (c *XURLClient) Lists(ctx context.Context, sourceID string, listID string) ([]model.SourceItem, error) {
	if listID == "" {
		return nil, fmt.Errorf("xurl list_id is required")
	}
	out, err := c.runner.Run(ctx, c.bin, "GET", "/2/lists/"+listID+"/tweets")
	if err != nil {
		return nil, err
	}
	return parseXFixture(sourceID, "x-list", out)
}

func (c *XURLClient) Bookmarks(ctx context.Context, sourceID string) ([]model.SourceItem, error) {
	out, err := c.runner.Run(ctx, c.bin, "GET", "/2/users/me/bookmarks")
	if err != nil {
		return nil, err
	}
	return parseXFixture(sourceID, "x-bookmarks", out)
}

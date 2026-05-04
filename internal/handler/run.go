package handler

import (
	"fmt"
	"log/slog"
	"strings"
	"uuid"

	"github.com/spf13/cobra"

	"github.com/ken5scal/obsflow/internal/apperror"
	"github.com/ken5scal/obsflow/internal/config"
	"github.com/ken5scal/obsflow/internal/logging"
)

func newRunCommand(opts *rootOptions) *cobra.Command {
	var targetsCSV string

	cmd := &cobra.Command{
		Use:   "run",
		Short: "Run explicit obsflow targets",
		RunE: func(cmd *cobra.Command, args []string) error {
			targets := splitCSV(targetsCSV)
			if len(targets) == 0 {
				return apperror.New(apperror.CodeConfig, fmt.Errorf("run requires --targets"))
			}

			runID := uuid.New().String()
			logger := logging.WithRunID(logging.NewJSONLogger(cmd.ErrOrStderr(), slog.LevelInfo), runID)
			ctx := cmd.Context()

			cfg, err := config.LoadFile(ctx, opts.configPath)
			if err != nil {
				logger.ErrorContext(ctx, "failed to load config", slog.String("error", err.Error()))
				return apperror.New(apperror.CodeConfig, err)
			}

			logger.InfoContext(
				ctx,
				"manual run accepted",
				slog.String("command", "run"),
				slog.String("targets", strings.Join(targets, ",")),
				slog.String("timezone", cfg.Timezone),
			)
			return nil
		},
	}
	cmd.Flags().StringVar(&targetsCSV, "targets", "", "comma-separated targets to run")
	return cmd
}

func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

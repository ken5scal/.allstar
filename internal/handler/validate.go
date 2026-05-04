package handler

import (
	"fmt"
	"log/slog"
	"uuid"

	"github.com/spf13/cobra"

	"github.com/ken5scal/obsflow/internal/apperror"
	"github.com/ken5scal/obsflow/internal/config"
	"github.com/ken5scal/obsflow/internal/logging"
)

func newValidateCommand(opts *rootOptions) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "validate",
		Short: "Validate the obsflow configuration",
		RunE: func(cmd *cobra.Command, args []string) error {
			runID := uuid.New().String()
			logger := logging.WithRunID(logging.NewJSONLogger(cmd.ErrOrStderr(), slog.LevelInfo), runID)

			cfg, err := config.LoadFile(cmd.Context(), opts.configPath)
			if err != nil {
				logger.ErrorContext(cmd.Context(), "configuration validation failed", slog.String("error", err.Error()))
				return apperror.New(apperror.CodeConfig, err)
			}

			logger.InfoContext(cmd.Context(), "configuration valid", slog.String("config_path", opts.configPath), slog.Int("version", cfg.Version))
			_, _ = fmt.Fprintln(cmd.OutOrStdout(), "config ok")
			return nil
		},
	}
	return cmd
}

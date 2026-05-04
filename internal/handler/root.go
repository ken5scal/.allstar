package handler

import (
	"context"
	"fmt"
	"io"

	"github.com/spf13/cobra"

	"github.com/ken5scal/obsflow/internal/apperror"
)

func NewRootCommand(out, errOut io.Writer) *cobra.Command {
	opts := &rootOptions{}

	cmd := &cobra.Command{
		Use:           "obsflow",
		Short:         "Collect sources into an Obsidian vault and maintain AI summaries",
		SilenceUsage:  true,
		SilenceErrors: true,
	}

	cmd.SetOut(out)
	cmd.SetErr(errOut)
	cmd.PersistentFlags().StringVar(&opts.configPath, "config", "", "path to YAML config file")

	cmd.AddCommand(newTickCommand(opts))
	cmd.AddCommand(newRunCommand(opts))
	cmd.AddCommand(newValidateCommand(opts))

	return cmd
}

func Execute(ctx context.Context, out, errOut io.Writer, args []string) int {
	cmd := NewRootCommand(out, errOut)
	cmd.SetContext(ctx)
	cmd.SetArgs(args)

	if err := cmd.Execute(); err != nil {
		_, _ = fmt.Fprintln(errOut, err.Error())
		return int(apperror.FromError(err))
	}

	return 0
}

type rootOptions struct {
	configPath string
}

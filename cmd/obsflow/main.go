package main

import (
	"context"
	"os"

	"github.com/ken5scal/obsflow/internal/handler"
)

func main() {
	os.Exit(handler.Execute(context.Background(), os.Stdout, os.Stderr, os.Args[1:]))
}

package config

import (
	"context"
	"errors"
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

var ErrPathRequired = errors.New("config path is required")

func LoadFile(ctx context.Context, path string) (*Config, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if path == "" {
		return nil, ErrPathRequired
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse config yaml: %w", err)
	}
	cfg.applyDefaults()
	return &cfg, nil
}

func Load(path string) (*Config, error) {
	return LoadFile(context.Background(), path)
}

func (cfg *Config) applyDefaults() {
	if cfg.Sources.X.Provider == "" {
		cfg.Sources.X.Provider = XProviderMock
	}
	if cfg.Defaults.Alert.Provider == "" {
		cfg.Defaults.Alert.Provider = AlertProviderMock
	}
	if cfg.Sources.X.XURL.Bin == "" {
		cfg.Sources.X.XURL.Bin = "xurl"
	}
}

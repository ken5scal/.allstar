package config

import (
	"fmt"
	"os"
)

var validDigestCadences = map[string]struct{}{
	"daily":      {},
	"weekly":     {},
	"monthly":    {},
	"quarterly":  {},
	"semiannual": {},
	"annually":   {},
}

// Validate checks structural config requirements that can be evaluated before
// any external provider is created.
func Validate(cfg *Config) error {
	if cfg == nil {
		return fmt.Errorf("config is required")
	}
	if cfg.Version != 1 {
		return fmt.Errorf("version must be 1")
	}
	if cfg.Timezone == "" {
		return fmt.Errorf("timezone is required")
	}
	if cfg.Defaults.VaultPath == "" {
		return fmt.Errorf("defaults.vault_path is required")
	}
	if cfg.Defaults.State.Driver == "" {
		return fmt.Errorf("defaults.state.driver is required")
	}
	if cfg.Defaults.State.DSN == "" {
		return fmt.Errorf("defaults.state.dsn is required")
	}
	if cfg.Sources.X.Provider == "" {
		cfg.Sources.X.Provider = XProviderMock
	}
	if cfg.Sources.X.Provider != XProviderMock && cfg.Sources.X.Provider != XProviderXURL {
		return fmt.Errorf("sources.x.provider must be %q or %q", XProviderMock, XProviderXURL)
	}

	sourceIDs := map[string]struct{}{}
	for _, src := range cfg.Sources.RSS {
		if err := validateRSSSource(src, sourceIDs); err != nil {
			return err
		}
	}
	for _, src := range cfg.Sources.X.Search {
		if err := validateXSearchSource(src, sourceIDs); err != nil {
			return err
		}
	}
	for _, src := range cfg.Sources.X.Lists {
		if err := validateXListSource(src, sourceIDs); err != nil {
			return err
		}
	}
	for _, src := range cfg.Sources.X.Bookmarks {
		if err := validateXBookmarksSource(src, sourceIDs); err != nil {
			return err
		}
	}

	jobIDs := map[string]struct{}{}
	for _, job := range cfg.Jobs {
		if err := validateJob(job, jobIDs); err != nil {
			return err
		}
	}
	return nil
}

// ValidateEnv verifies configured environment-variable references. It does not
// call 1Password; launchd or the operator is expected to inject env values.
func ValidateEnv(cfg *Config) error {
	if cfg == nil {
		return fmt.Errorf("config is required")
	}
	if err := requireEnvRef("defaults.auth.x_bearer_token_env", cfg.Defaults.Auth.XBearerTokenEnv); err != nil {
		return err
	}
	if err := requireEnvRef("defaults.auth.ai_api_key_env", cfg.Defaults.Auth.AIAPIKeyEnv); err != nil {
		return err
	}
	if err := requireEnvRef("defaults.alert.slack_webhook_env", cfg.Defaults.Alert.SlackWebhookEnv); err != nil {
		return err
	}
	return nil
}

func validateRSSSource(src RSSSource, seen map[string]struct{}) error {
	if err := validateScheduledID("sources.rss", src.ID, src.Schedule, seen); err != nil {
		return err
	}
	if src.Enabled && src.URL == "" {
		return fmt.Errorf("sources.rss[%s].url is required when enabled", src.ID)
	}
	return nil
}

func validateXSearchSource(src XSearch, seen map[string]struct{}) error {
	if err := validateScheduledID("sources.x.search", src.ID, src.Schedule, seen); err != nil {
		return err
	}
	if src.Enabled && src.Query == "" {
		return fmt.Errorf("sources.x.search[%s].query is required when enabled", src.ID)
	}
	return nil
}

func validateXListSource(src XList, seen map[string]struct{}) error {
	if err := validateScheduledID("sources.x.lists", src.ID, src.Schedule, seen); err != nil {
		return err
	}
	if src.Enabled && src.ListID == "" {
		return fmt.Errorf("sources.x.lists[%s].list_id is required when enabled", src.ID)
	}
	return nil
}

func validateXBookmarksSource(src XBookmark, seen map[string]struct{}) error {
	return validateScheduledID("sources.x.bookmarks", src.ID, src.Schedule, seen)
}

func validateJob(job JobSpec, seen map[string]struct{}) error {
	if err := validateScheduledID("jobs", job.ID, job.Schedule, seen); err != nil {
		return err
	}
	if !job.Enabled {
		return nil
	}
	switch job.Type {
	case "summarize":
		if job.Cadence != "" {
			return fmt.Errorf("jobs[%s].cadence is only valid for digest jobs", job.ID)
		}
	case "digest":
		if _, ok := validDigestCadences[job.Cadence]; !ok {
			return fmt.Errorf("jobs[%s].cadence must be a supported digest cadence", job.ID)
		}
	default:
		return fmt.Errorf("jobs[%s].type must be %q or %q", job.ID, "summarize", "digest")
	}
	return nil
}

func validateScheduledID(scope, id, schedule string, seen map[string]struct{}) error {
	if id == "" {
		return fmt.Errorf("%s.id is required", scope)
	}
	if _, ok := seen[id]; ok {
		return fmt.Errorf("%s[%s] duplicates an existing id", scope, id)
	}
	seen[id] = struct{}{}
	if schedule == "" {
		return fmt.Errorf("%s[%s].schedule is required", scope, id)
	}
	return nil
}

func requireEnvRef(path, name string) error {
	if name == "" {
		return fmt.Errorf("%s is required", path)
	}
	if os.Getenv(name) == "" {
		return fmt.Errorf("environment variable %q referenced by %s is not set", name, path)
	}
	return nil
}

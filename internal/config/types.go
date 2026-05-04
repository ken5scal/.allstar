package config

type Config struct {
	Version  int       `yaml:"version"`
	Timezone string    `yaml:"timezone"`
	Defaults Defaults  `yaml:"defaults"`
	Sources  Sources   `yaml:"sources"`
	Jobs     []JobSpec `yaml:"jobs"`
}

const (
	XProviderMock = "mock"
	XProviderXURL = "xurl"

	JobTypeSummarize = "summarize"
	JobTypeDigest    = "digest"
)

type Defaults struct {
	VaultPath string      `yaml:"vault_path"`
	State     StateConfig `yaml:"state"`
	Auth      AuthConfig  `yaml:"auth"`
	Alert     AlertConfig `yaml:"alert"`
}

type StateConfig struct {
	Driver string `yaml:"driver"`
	DSN    string `yaml:"dsn"`
}

type AuthConfig struct {
	XBearerTokenEnv string `yaml:"x_bearer_token_env"`
	AIAPIKeyEnv     string `yaml:"ai_api_key_env"`
}

type AlertConfig struct {
	Provider        string `yaml:"provider"`
	SlackWebhookEnv string `yaml:"slack_webhook_env"`
}

type Sources struct {
	RSS []RSSSource `yaml:"rss"`
	X   XSources    `yaml:"x"`
}

type RSSSource struct {
	ID       string `yaml:"id"`
	Enabled  bool   `yaml:"enabled"`
	URL      string `yaml:"url"`
	Schedule string `yaml:"schedule"`
}

type XSources struct {
	Provider  string      `yaml:"provider"`
	XURL      XURLConfig  `yaml:"xurl"`
	Search    []XSearch   `yaml:"search"`
	Lists     []XList     `yaml:"lists"`
	Bookmarks []XBookmark `yaml:"bookmarks"`
}

type XURLConfig struct {
	Bin      string `yaml:"bin"`
	AuthMode string `yaml:"auth_mode"`
}

type XSearch struct {
	ID       string `yaml:"id"`
	Enabled  bool   `yaml:"enabled"`
	Query    string `yaml:"query"`
	Schedule string `yaml:"schedule"`
}

type XList struct {
	ID       string `yaml:"id"`
	Enabled  bool   `yaml:"enabled"`
	ListID   string `yaml:"list_id"`
	Schedule string `yaml:"schedule"`
}

type XBookmark struct {
	ID       string `yaml:"id"`
	Enabled  bool   `yaml:"enabled"`
	Schedule string `yaml:"schedule"`
}

type JobSpec struct {
	ID       string `yaml:"id"`
	Type     string `yaml:"type"`
	Cadence  string `yaml:"cadence"`
	Enabled  bool   `yaml:"enabled"`
	Schedule string `yaml:"schedule"`
}

module github.com/ken5scal/obsflow

go 1.25

replace uuid => ./internal/stdcompat/uuid

require (
	github.com/spf13/cobra v1.10.2
	gopkg.in/yaml.v3 v3.0.1
	uuid v0.0.0
)

require (
	github.com/inconshreveable/mousetrap v1.1.0 // indirect
	github.com/spf13/pflag v1.0.9 // indirect
)

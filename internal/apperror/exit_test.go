package apperror

import "testing"

func TestExitCodePriority(t *testing.T) {
	tests := []struct {
		name string
		in   []Code
		want Code
	}{
		{name: "ok", in: nil, want: CodeOK},
		{name: "processing only", in: []Code{CodeProcessingFailure}, want: CodeProcessingFailure},
		{name: "external beats processing", in: []Code{CodeProcessingFailure, CodeExternalDependency}, want: CodeExternalDependency},
		{name: "config beats all", in: []Code{CodeProcessingFailure, CodeExternalDependency, CodeConfig}, want: CodeConfig},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := HighestPriority(tt.in...)
			if got != tt.want {
				t.Fatalf("HighestPriority = %d, want %d", got, tt.want)
			}
		})
	}
}

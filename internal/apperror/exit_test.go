package apperror

import "testing"

func TestExitCodePriority(t *testing.T) {
	tests := []struct {
		name string
		in   []int
		want int
	}{
		{name: "ok", in: nil, want: ExitOK},
		{name: "processing only", in: []int{ExitProcessingFailure}, want: ExitProcessingFailure},
		{name: "external beats processing", in: []int{ExitProcessingFailure, ExitExternalDependency}, want: ExitExternalDependency},
		{name: "config beats all", in: []int{ExitProcessingFailure, ExitExternalDependency, ExitConfigInputError}, want: ExitConfigInputError},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ExitOK
			for _, code := range tt.in {
				got = HigherPriority(got, code)
			}
			if got != tt.want {
				t.Fatalf("HigherPriority aggregate = %d, want %d", got, tt.want)
			}
		})
	}
}

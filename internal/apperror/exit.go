package apperror

import "errors"

type Code int

const (
	CodeOK                 Code = 0
	CodeConfig             Code = 1
	CodeExternalDependency Code = 2
	CodeProcessingFailure  Code = 3
)

type ExitError struct {
	code Code
	err  error
}

func New(code Code, err error) error {
	if err == nil {
		return nil
	}
	return ExitError{code: code, err: err}
}

func NewText(code Code, message string) error {
	return New(code, errors.New(message))
}

func (e ExitError) Error() string {
	return e.err.Error()
}

func (e ExitError) Unwrap() error {
	return e.err
}

func (e ExitError) Code() Code {
	return e.code
}

func FromError(err error) Code {
	if err == nil {
		return CodeOK
	}
	var exitErr ExitError
	if errors.As(err, &exitErr) {
		return exitErr.Code()
	}
	return CodeProcessingFailure
}

func HighestPriority(codes ...Code) Code {
	result := CodeOK
	for _, code := range codes {
		if code == CodeOK {
			continue
		}
		if result == CodeOK || code < result {
			result = code
		}
	}
	return result
}

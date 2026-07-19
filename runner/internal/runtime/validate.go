package runtime

import (
	"errors"
	"fmt"
	"path"
	"regexp"
	"strings"
	"unicode/utf8"
)

var idPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

var runtimeIDs = map[string]struct{}{
	"go": {}, "javascript": {}, "python": {}, "rust": {}, "typescript": {},
}

func Validate(request Request) error {
	if !idPattern.MatchString(request.RequestID) {
		return errors.New("invalid requestId")
	}
	if _, ok := runtimeIDs[request.RuntimeID]; !ok {
		return errors.New("invalid runtimeId")
	}
	if len(request.Files) == 0 || len(request.Files) > 1_000 {
		return errors.New("files must contain between 1 and 1000 entries")
	}
	if len(request.Stdin) > 1_000_000 {
		return errors.New("stdin exceeds 1 MB")
	}

	paths := make(map[string]struct{}, len(request.Files))
	total := 0
	for _, file := range request.Files {
		if err := ValidatePath(file.Path); err != nil {
			return fmt.Errorf("invalid file path %q: %w", file.Path, err)
		}
		if file.Path == ".common-ground-stdin" {
			return errors.New("reserved file path")
		}
		if _, duplicate := paths[file.Path]; duplicate {
			return fmt.Errorf("duplicate file path: %s", file.Path)
		}
		paths[file.Path] = struct{}{}
		total += len(file.Content)
		if total > MaxSourceBytes {
			return errors.New("submitted source exceeds 10 MB")
		}
	}
	if err := ValidatePath(request.Entrypoint); err != nil {
		return fmt.Errorf("invalid entrypoint: %w", err)
	}
	if _, ok := paths[request.Entrypoint]; !ok {
		return errors.New("entrypoint must be one of the submitted files")
	}
	return nil
}

func ValidatePath(value string) error {
	if value == "" || len(value) > 512 || !utf8.ValidString(value) {
		return errors.New("path length or UTF-8 is invalid")
	}
	if strings.ContainsAny(value, "\\\x00") || strings.HasPrefix(value, "/") {
		return errors.New("path must be relative POSIX syntax")
	}
	if len(value) >= 2 && ((value[0] >= 'A' && value[0] <= 'Z') || (value[0] >= 'a' && value[0] <= 'z')) && value[1] == ':' {
		return errors.New("Windows volume paths are not allowed")
	}
	if path.Clean(value) != value || strings.Contains(value, "//") {
		return errors.New("dot, traversal, and empty segments are not allowed")
	}
	return nil
}

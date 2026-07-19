package runtime

import (
	"strings"
	"testing"
)

func validRequest() Request {
	return Request{
		RequestID: "request-1", RuntimeID: "typescript", Entrypoint: "src/index.ts",
		Files: []File{{Path: "src/index.ts", Content: "console.log('ok')"}},
	}
}

func TestValidateAcceptsClosedRequestSurface(t *testing.T) {
	if err := Validate(validRequest()); err != nil {
		t.Fatal(err)
	}
}

func TestValidateRejectsUnsafeInputs(t *testing.T) {
	tests := map[string]func(*Request){
		"runtime":       func(request *Request) { request.RuntimeID = "docker" },
		"traversal":     func(request *Request) { request.Files[0].Path = "../host" },
		"absolute":      func(request *Request) { request.Files[0].Path = "/host" },
		"backslash":     func(request *Request) { request.Files[0].Path = `src\host` },
		"missing entry": func(request *Request) { request.Entrypoint = "src/missing.ts" },
		"duplicate":     func(request *Request) { request.Files = append(request.Files, request.Files[0]) },
		"reserved":      func(request *Request) { request.Files[0].Path = ".common-ground-stdin" },
		"source limit":  func(request *Request) { request.Files[0].Content = strings.Repeat("x", MaxSourceBytes+1) },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			request := validRequest()
			mutate(&request)
			if err := Validate(request); err == nil {
				t.Fatal("expected request to be rejected")
			}
		})
	}
}

package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	cgruntime "github.com/jayden77/common-ground/runner/internal/runtime"
)

const testOrigin = "https://app.example.test"

type fakeExecutor struct {
	run func(context.Context, cgruntime.Request) <-chan cgruntime.Event
}

func (executor fakeExecutor) Run(ctx context.Context, request cgruntime.Request) <-chan cgruntime.Event {
	return executor.run(ctx, request)
}

func immediateExecutor() fakeExecutor {
	return fakeExecutor{run: func(_ context.Context, request cgruntime.Request) <-chan cgruntime.Event {
		events := make(chan cgruntime.Event, 3)
		events <- cgruntime.Status(request.RequestID, "running")
		events <- cgruntime.Output(request.RequestID, "stdout", "secret-output\n")
		code := 0
		events <- cgruntime.Exit(request.RequestID, &code, "completed")
		close(events)
		return events
	}}
}

func newTestServer(t *testing.T, executor cgruntime.Executor, logs io.Writer) *Server {
	t.Helper()
	server, err := New(executor, []string{testOrigin}, "123456", time.Minute, log.New(logs, "", 0))
	if err != nil {
		t.Fatal(err)
	}
	return server
}

func TestOriginAndPrivateNetworkCORS(t *testing.T) {
	server := newTestServer(t, immediateExecutor(), io.Discard)
	request := httptest.NewRequest(http.MethodGet, "/v1/health", nil)
	request.Header.Set("Origin", "https://evil.example")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || response.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("evil origin was not rejected: %d %#v", response.Code, response.Header())
	}

	request = httptest.NewRequest(http.MethodOptions, "/v1/runs", nil)
	request.Header.Set("Origin", testOrigin)
	request.Header.Set("Access-Control-Request-Private-Network", "true")
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusNoContent || response.Header().Get("Access-Control-Allow-Origin") != testOrigin || response.Header().Get("Access-Control-Allow-Private-Network") != "true" {
		t.Fatalf("private network preflight failed: %d %#v", response.Code, response.Header())
	}
}

func TestPairingIsOneTimeAndRunRequiresBearer(t *testing.T) {
	server := newTestServer(t, immediateExecutor(), io.Discard)
	if status := pairRequest(server, "000000").Code; status != http.StatusUnauthorized {
		t.Fatalf("wrong code status = %d", status)
	}
	paired := pairRequest(server, "123456")
	if paired.Code != http.StatusOK {
		t.Fatalf("pair status = %d: %s", paired.Code, paired.Body.String())
	}
	var token struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(paired.Body.Bytes(), &token); err != nil || len(token.Token) < 32 {
		t.Fatalf("invalid token: %v %#v", err, token)
	}
	if status := pairRequest(server, "123456").Code; status != http.StatusConflict {
		t.Fatalf("reused pairing code status = %d", status)
	}

	request := validRunRequest("")
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated run status = %d", response.Code)
	}

	request = validRunRequest(token.Token)
	response = httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"type":"stdout"`) || !strings.Contains(response.Body.String(), `"exitCode":0`) {
		t.Fatalf("run response = %d %s", response.Code, response.Body.String())
	}
}

func TestInvalidRequestsAreRejectedBeforeExecutor(t *testing.T) {
	called := false
	executor := fakeExecutor{run: func(_ context.Context, _ cgruntime.Request) <-chan cgruntime.Event {
		called = true
		return make(chan cgruntime.Event)
	}}
	server := newTestServer(t, executor, io.Discard)
	paired := pairRequest(server, "123456")
	var token struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(paired.Body.Bytes(), &token)
	body := `{"requestId":"bad","runtimeId":"shell","files":[{"path":"../host","content":"x"}],"entrypoint":"../host"}`
	request := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(body))
	request.Header.Set("Origin", testOrigin)
	request.Header.Set("Authorization", "Bearer "+token.Token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest || called {
		t.Fatalf("invalid request reached executor: status=%d called=%v", response.Code, called)
	}
}

func TestCancellationTargetsTheExactRun(t *testing.T) {
	started := make(chan string, 1)
	executor := fakeExecutor{run: func(ctx context.Context, request cgruntime.Request) <-chan cgruntime.Event {
		events := make(chan cgruntime.Event, 2)
		go func() {
			defer close(events)
			started <- request.RequestID
			events <- cgruntime.Status(request.RequestID, "running")
			<-ctx.Done()
			events <- cgruntime.Exit(request.RequestID, nil, "cancelled")
		}()
		return events
	}}
	server := newTestServer(t, executor, io.Discard)
	httpServer := httptest.NewServer(server.Handler())
	defer httpServer.Close()
	token := pairOverHTTP(t, httpServer.URL)

	runDone := make(chan string, 1)
	go func() {
		request := validRunRequest(token)
		request.URL, _ = request.URL.Parse(httpServer.URL + "/v1/runs")
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			runDone <- err.Error()
			return
		}
		body, _ := io.ReadAll(response.Body)
		_ = response.Body.Close()
		runDone <- string(body)
	}()
	if requestID := <-started; requestID != "request-1" {
		t.Fatalf("unexpected request started: %s", requestID)
	}
	cancelRequest, _ := http.NewRequest(http.MethodDelete, httpServer.URL+"/v1/runs/request-1", nil)
	cancelRequest.Header.Set("Origin", testOrigin)
	cancelRequest.Header.Set("Authorization", "Bearer "+token)
	response, err := http.DefaultClient.Do(cancelRequest)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusAccepted {
		t.Fatalf("cancel status = %d", response.StatusCode)
	}
	if body := <-runDone; !strings.Contains(body, `"reason":"cancelled"`) {
		t.Fatalf("run did not cancel: %s", body)
	}
}

func TestLogsContainMetadataOnly(t *testing.T) {
	var logs bytes.Buffer
	server := newTestServer(t, immediateExecutor(), &logs)
	paired := pairRequest(server, "123456")
	var token struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(paired.Body.Bytes(), &token)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, validRunRequest(token.Token))
	if strings.Contains(logs.String(), "secret-output") || strings.Contains(logs.String(), "console.log") {
		t.Fatalf("logs contained run data: %s", logs.String())
	}
	for _, field := range []string{"run_id=request-1", "runtime=javascript", "duration_ms=", "result=completed"} {
		if !strings.Contains(logs.String(), field) {
			t.Errorf("missing metadata field %q: %s", field, logs.String())
		}
	}
}

func pairRequest(server *Server, code string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPost, "/v1/pair", strings.NewReader(`{"code":"`+code+`"}`))
	request.Header.Set("Origin", testOrigin)
	response := httptest.NewRecorder()
	server.Handler().ServeHTTP(response, request)
	return response
}

func validRunRequest(token string) *http.Request {
	body := `{"requestId":"request-1","runtimeId":"javascript","files":[{"path":"src/index.js","content":"console.log('secret-source')"}],"entrypoint":"src/index.js"}`
	request := httptest.NewRequest(http.MethodPost, "/v1/runs", strings.NewReader(body))
	request.Header.Set("Origin", testOrigin)
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	return request
}

func pairOverHTTP(t *testing.T, baseURL string) string {
	t.Helper()
	request, _ := http.NewRequest(http.MethodPost, baseURL+"/v1/pair", strings.NewReader(`{"code":"123456"}`))
	request.Header.Set("Origin", testOrigin)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var token struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(response.Body).Decode(&token); err != nil {
		t.Fatal(err)
	}
	return token.Token
}

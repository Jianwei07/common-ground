package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	cgruntime "github.com/jayden77/common-ground/runner/internal/runtime"
)

const maxConcurrentRuns = 2

type Server struct {
	executor    cgruntime.Executor
	idleTimeout time.Duration
	logger      *log.Logger
	origins     map[string]struct{}
	pairCode    string

	mu           sync.Mutex
	activeRuns   map[string]context.CancelFunc
	lastActivity time.Time
	pairAttempts int
	paired       bool
	tokenHash    [sha256.Size]byte
}

func New(executor cgruntime.Executor, origins []string, pairCode string, idleTimeout time.Duration, logger *log.Logger) (*Server, error) {
	if executor == nil || logger == nil || len(origins) == 0 || len(pairCode) != 6 {
		return nil, errors.New("executor, logger, origin, and six-digit pairing code are required")
	}
	allowed := make(map[string]struct{}, len(origins))
	for _, origin := range origins {
		if !strings.HasPrefix(origin, "http://") && !strings.HasPrefix(origin, "https://") {
			return nil, fmt.Errorf("invalid allowed origin: %s", origin)
		}
		allowed[strings.TrimSuffix(origin, "/")] = struct{}{}
	}
	return &Server{
		executor: executor, idleTimeout: idleTimeout, logger: logger, origins: allowed, pairCode: pairCode,
		activeRuns: make(map[string]context.CancelFunc), lastActivity: time.Now(),
	}, nil
}

func NewPairCode() (string, error) {
	value, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", value.Int64()), nil
}

func (server *Server) Handler() http.Handler {
	return http.HandlerFunc(server.serveHTTP)
}

func (server *Server) IdleExpired(now time.Time) bool {
	server.mu.Lock()
	defer server.mu.Unlock()
	return len(server.activeRuns) == 0 && now.Sub(server.lastActivity) >= server.idleTimeout
}

func (server *Server) serveHTTP(writer http.ResponseWriter, request *http.Request) {
	origin := strings.TrimSuffix(request.Header.Get("Origin"), "/")
	if _, allowed := server.origins[origin]; !allowed {
		writeError(writer, http.StatusForbidden, "origin is not allowed")
		return
	}
	writer.Header().Set("Access-Control-Allow-Origin", origin)
	writer.Header().Set("Vary", "Origin")
	writer.Header().Set("Cache-Control", "no-store")
	writer.Header().Set("X-Content-Type-Options", "nosniff")
	if request.Method == http.MethodOptions {
		writer.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		writer.Header().Set("Access-Control-Max-Age", "600")
		if request.Header.Get("Access-Control-Request-Private-Network") == "true" {
			writer.Header().Set("Access-Control-Allow-Private-Network", "true")
		}
		writer.WriteHeader(http.StatusNoContent)
		return
	}

	switch {
	case request.URL.Path == "/v1/health" && request.Method == http.MethodGet:
		server.health(writer)
	case request.URL.Path == "/v1/pair" && request.Method == http.MethodPost:
		server.pair(writer, request)
	case request.URL.Path == "/v1/runs" && request.Method == http.MethodPost:
		server.run(writer, request)
	case strings.HasPrefix(request.URL.Path, "/v1/runs/") && request.Method == http.MethodDelete:
		server.cancel(writer, request)
	default:
		writeError(writer, http.StatusNotFound, "endpoint not found")
	}
}

func (server *Server) health(writer http.ResponseWriter) {
	server.mu.Lock()
	paired := server.paired
	server.mu.Unlock()
	writeJSON(writer, http.StatusOK, map[string]any{"status": "ready", "version": "0.1.0", "paired": paired})
}

func (server *Server) pair(writer http.ResponseWriter, request *http.Request) {
	var payload struct {
		Code string `json:"code"`
	}
	if err := decodeJSON(writer, request, 1_024, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid pairing request")
		return
	}
	server.mu.Lock()
	defer server.mu.Unlock()
	if server.paired {
		writeError(writer, http.StatusConflict, "pairing code has already been used")
		return
	}
	server.pairAttempts++
	if server.pairAttempts > 5 {
		writeError(writer, http.StatusTooManyRequests, "pairing attempt limit reached; restart the helper")
		return
	}
	if subtle.ConstantTimeCompare([]byte(payload.Code), []byte(server.pairCode)) != 1 {
		writeError(writer, http.StatusUnauthorized, "pairing code is invalid")
		return
	}
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		writeError(writer, http.StatusInternalServerError, "pairing token could not be created")
		return
	}
	token := base64.RawURLEncoding.EncodeToString(tokenBytes)
	server.tokenHash = sha256.Sum256([]byte(token))
	server.paired = true
	server.pairCode = ""
	server.lastActivity = time.Now()
	writeJSON(writer, http.StatusOK, map[string]string{"token": token})
}

func (server *Server) run(writer http.ResponseWriter, request *http.Request) {
	if !server.authenticate(request) {
		writeError(writer, http.StatusUnauthorized, "valid bearer token required")
		return
	}
	var payload cgruntime.Request
	if err := decodeJSON(writer, request, cgruntime.MaxSourceBytes+1_500_000, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, "invalid run request")
		return
	}
	if err := cgruntime.Validate(payload); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	runContext, cancel := context.WithCancel(request.Context())
	server.mu.Lock()
	if len(server.activeRuns) >= maxConcurrentRuns {
		server.mu.Unlock()
		cancel()
		writeError(writer, http.StatusTooManyRequests, "runner is at its two-run limit")
		return
	}
	if _, duplicate := server.activeRuns[payload.RequestID]; duplicate {
		server.mu.Unlock()
		cancel()
		writeError(writer, http.StatusConflict, "requestId is already running")
		return
	}
	server.activeRuns[payload.RequestID] = cancel
	server.mu.Unlock()
	defer func() {
		cancel()
		server.mu.Lock()
		delete(server.activeRuns, payload.RequestID)
		server.lastActivity = time.Now()
		server.mu.Unlock()
	}()

	writer.Header().Set("Content-Type", "application/x-ndjson")
	writer.WriteHeader(http.StatusOK)
	encoder := json.NewEncoder(writer)
	flusher, _ := writer.(http.Flusher)
	started := time.Now()
	_ = encoder.Encode(cgruntime.Status(payload.RequestID, "queued"))
	flusher.Flush()
	result := "cancelled"
	for event := range server.executor.Run(runContext, payload) {
		if err := encoder.Encode(event); err != nil {
			cancel()
			break
		}
		flusher.Flush()
		if event.Type == "exit" {
			result = event.Reason
		}
	}
	server.logger.Printf("run_id=%s runtime=%s duration_ms=%d result=%s", payload.RequestID, payload.RuntimeID, time.Since(started).Milliseconds(), result)
}

func (server *Server) cancel(writer http.ResponseWriter, request *http.Request) {
	if !server.authenticate(request) {
		writeError(writer, http.StatusUnauthorized, "valid bearer token required")
		return
	}
	requestID := strings.TrimPrefix(request.URL.Path, "/v1/runs/")
	if strings.Contains(requestID, "/") || requestID == "" {
		writeError(writer, http.StatusBadRequest, "invalid requestId")
		return
	}
	server.mu.Lock()
	cancel := server.activeRuns[requestID]
	server.mu.Unlock()
	if cancel == nil {
		writeError(writer, http.StatusNotFound, "run not found")
		return
	}
	cancel()
	writeJSON(writer, http.StatusAccepted, map[string]string{"status": "cancelling"})
}

func (server *Server) authenticate(request *http.Request) bool {
	value := request.Header.Get("Authorization")
	if !strings.HasPrefix(value, "Bearer ") {
		return false
	}
	hash := sha256.Sum256([]byte(strings.TrimPrefix(value, "Bearer ")))
	server.mu.Lock()
	defer server.mu.Unlock()
	if !server.paired || subtle.ConstantTimeCompare(hash[:], server.tokenHash[:]) != 1 {
		return false
	}
	server.lastActivity = time.Now()
	return true
}

func decodeJSON(writer http.ResponseWriter, request *http.Request, limit int, target any) error {
	request.Body = http.MaxBytesReader(writer, request.Body, int64(limit))
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("request body must contain one JSON value")
	}
	return nil
}

func writeError(writer http.ResponseWriter, status int, message string) {
	writeJSON(writer, status, map[string]string{"error": message})
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}

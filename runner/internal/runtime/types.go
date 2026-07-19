package runtime

import (
	"context"
	"encoding/json"
)

const (
	MaxOutputBytes = 1_000_000
	MaxSourceBytes = 10_000_000
	MaxWallTime    = 15
)

type File struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type Request struct {
	RequestID  string `json:"requestId"`
	RuntimeID  string `json:"runtimeId"`
	Files      []File `json:"files"`
	Entrypoint string `json:"entrypoint"`
	Stdin      string `json:"stdin,omitempty"`
}

type Event struct {
	RequestID string
	Type      string
	Chunk     string
	Status    string
	ExitCode  *int
	Reason    string
}

func Status(requestID, status string) Event {
	return Event{RequestID: requestID, Type: "status", Status: status}
}

func Output(requestID, stream, chunk string) Event {
	return Event{RequestID: requestID, Type: stream, Chunk: chunk}
}

func Exit(requestID string, exitCode *int, reason string) Event {
	return Event{RequestID: requestID, Type: "exit", ExitCode: exitCode, Reason: reason}
}

func (event Event) MarshalJSON() ([]byte, error) {
	switch event.Type {
	case "stdout", "stderr":
		return json.Marshal(struct {
			RequestID string `json:"requestId"`
			Type      string `json:"type"`
			Chunk     string `json:"chunk"`
		}{event.RequestID, event.Type, event.Chunk})
	case "status":
		return json.Marshal(struct {
			RequestID string `json:"requestId"`
			Type      string `json:"type"`
			Status    string `json:"status"`
		}{event.RequestID, event.Type, event.Status})
	default:
		return json.Marshal(struct {
			RequestID string `json:"requestId"`
			Type      string `json:"type"`
			ExitCode  *int   `json:"exitCode"`
			Reason    string `json:"reason"`
		}{event.RequestID, "exit", event.ExitCode, event.Reason})
	}
}

type Executor interface {
	Run(context.Context, Request) <-chan Event
}

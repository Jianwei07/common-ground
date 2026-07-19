package docker

import (
	"archive/tar"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"path"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	cgruntime "github.com/jayden77/common-ground/runner/internal/runtime"
)

const runnerLabel = "com.common-ground.runner=1"

type definition struct {
	image   string
	command []string
	env     []string
}

var definitions = map[string]definition{
	"javascript": {
		image:   "node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd",
		command: []string{"/bin/sh", "-eu", "-c", `tar -xf - -C /workspace && exec node -- "$1" < /workspace/.common-ground-stdin`, "common-ground"},
	},
	"typescript": {
		image:   "node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd",
		command: []string{"/bin/sh", "-eu", "-c", `tar -xf - -C /workspace && exec node -- "$1" < /workspace/.common-ground-stdin`, "common-ground"},
	},
	"python": {
		image:   "python:3.14-alpine@sha256:26730869004e2b9c4b9ad09cab8625e81d256d1ce97e72df5520e806b1709f92",
		command: []string{"/bin/sh", "-eu", "-c", `tar -xf - -C /workspace && exec python "$1" < /workspace/.common-ground-stdin`, "common-ground"},
	},
	"go": {
		image:   "golang:1.26-alpine@sha256:0178a641fbb4858c5f1b48e34bdaabe0350a330a1b1149aabd498d0699ff5fb2",
		command: []string{"/bin/sh", "-eu", "-c", `tar -xf - -C /workspace && mkdir -p .cache .home .modules .tmp && exec go run "$1" < /workspace/.common-ground-stdin`, "common-ground"},
		env:     []string{"CGO_ENABLED=0", "GOCACHE=/workspace/.cache", "GOMODCACHE=/workspace/.modules", "GOPROXY=off", "GOTOOLCHAIN=local", "HOME=/workspace/.home", "TMPDIR=/workspace/.tmp"},
	},
	"rust": {
		image:   "rust:1.94-alpine@sha256:77237dd363a0b127bb5ef532c2d64c0deb380b738e43a9c4bdac73398d6d0a08",
		command: []string{"/bin/sh", "-eu", "-c", `tar -xf - -C /workspace && mkdir -p .home .tmp && rustc "$1" -o .common-ground-bin && exec ./.common-ground-bin < /workspace/.common-ground-stdin`, "common-ground"},
		env:     []string{"HOME=/workspace/.home", "TMPDIR=/workspace/.tmp"},
	},
}

type Executor struct{}

func New() *Executor {
	return &Executor{}
}

func (executor *Executor) Run(parent context.Context, request cgruntime.Request) <-chan cgruntime.Event {
	events := make(chan cgruntime.Event, 16)
	go func() {
		defer close(events)
		executor.run(parent, request, events)
	}()
	return events
}

func (executor *Executor) run(parent context.Context, request cgruntime.Request, events chan<- cgruntime.Event) {
	definition, ok := definitions[request.RuntimeID]
	if !ok {
		events <- cgruntime.Exit(request.RequestID, nil, "limit")
		return
	}
	archive, err := workspaceArchive(request)
	if err != nil {
		events <- cgruntime.Output(request.RequestID, "stderr", "Workspace could not be prepared.\n")
		events <- cgruntime.Exit(request.RequestID, nil, "limit")
		return
	}

	runContext, cancel := context.WithTimeout(parent, cgruntime.MaxWallTime*time.Second)
	defer cancel()
	name := containerName(request.RequestID)
	create := exec.CommandContext(runContext, "docker", createArgs(definition, request, name)...)
	var createError bytes.Buffer
	create.Stderr = &createError
	containerOutput, err := create.Output()
	if err != nil {
		events <- cgruntime.Output(request.RequestID, "stderr", "Docker could not create the sandbox. Check that Docker is running and runtime images are available.\n")
		reason := reasonFor(runContext, parent, false)
		if reason == "completed" {
			reason = "limit"
		}
		events <- cgruntime.Exit(request.RequestID, nil, reason)
		return
	}
	containerID := strings.TrimSpace(string(containerOutput))
	if !isContainerID(containerID) {
		events <- cgruntime.Output(request.RequestID, "stderr", "Docker returned an invalid container identifier.\n")
		events <- cgruntime.Exit(request.RequestID, nil, "limit")
		return
	}

	start := exec.Command("docker", "start", "--attach", "--interactive", containerID)
	start.Stdin = bytes.NewReader(archive)
	stdout, stdoutErr := start.StdoutPipe()
	stderr, stderrErr := start.StderrPipe()
	if stdoutErr != nil || stderrErr != nil || start.Start() != nil {
		removeContainer(containerID)
		events <- cgruntime.Output(request.RequestID, "stderr", "Docker could not start the sandbox.\n")
		events <- cgruntime.Exit(request.RequestID, nil, "limit")
		return
	}
	events <- cgruntime.Status(request.RequestID, "running")

	var outputBytes atomic.Int64
	var outputLimited atomic.Bool
	var readers sync.WaitGroup
	readers.Add(2)
	read := func(stream string, source io.Reader) {
		defer readers.Done()
		buffer := make([]byte, 4_096)
		for {
			count, readErr := source.Read(buffer)
			if count > 0 {
				remaining := int64(cgruntime.MaxOutputBytes) - outputBytes.Load()
				if remaining <= 0 {
					outputLimited.Store(true)
					cancel()
					return
				}
				if int64(count) > remaining {
					count = int(remaining)
					outputLimited.Store(true)
				}
				outputBytes.Add(int64(count))
				events <- cgruntime.Output(request.RequestID, stream, string(buffer[:count]))
				if outputLimited.Load() {
					cancel()
					return
				}
			}
			if readErr != nil {
				return
			}
		}
	}
	go read("stdout", stdout)
	go read("stderr", stderr)

	cleanupDone := make(chan struct{})
	go func() {
		select {
		case <-runContext.Done():
			removeContainer(containerID)
		case <-cleanupDone:
		}
	}()
	waitErr := start.Wait()
	close(cleanupDone)
	readers.Wait()

	reason := reasonFor(runContext, parent, outputLimited.Load())
	if reason != "completed" {
		events <- cgruntime.Exit(request.RequestID, nil, reason)
		return
	}
	exitCode := 0
	var exitError *exec.ExitError
	if errors.As(waitErr, &exitError) {
		exitCode = exitError.ExitCode()
	} else if waitErr != nil {
		events <- cgruntime.Exit(request.RequestID, nil, "limit")
		return
	}
	events <- cgruntime.Exit(request.RequestID, &exitCode, "completed")
}

func createArgs(definition definition, request cgruntime.Request, name string) []string {
	args := []string{
		"create", "--rm", "--interactive", "--name", name,
		"--label", runnerLabel,
		"--label", "com.common-ground.run=" + request.RequestID,
		"--network", "none",
		"--read-only",
		"--tmpfs", "/workspace:rw,nosuid,nodev,size=64m,mode=1777",
		"--user", "65534:65534",
		"--cap-drop", "ALL",
		"--security-opt", "no-new-privileges",
		"--cpus", "1",
		"--memory", "512m",
		"--memory-swap", "512m",
		"--pids-limit", "64",
		"--ulimit", "nofile=256:256",
		"--ulimit", "core=0:0",
		"--workdir", "/workspace",
	}
	for _, value := range definition.env {
		args = append(args, "--env", value)
	}
	args = append(args, definition.image)
	args = append(args, definition.command...)
	args = append(args, request.Entrypoint)
	return args
}

func workspaceArchive(request cgruntime.Request) ([]byte, error) {
	var output bytes.Buffer
	writer := tar.NewWriter(&output)
	directories := map[string]struct{}{}
	for _, file := range request.Files {
		for directory := path.Dir(file.Path); directory != "."; directory = path.Dir(directory) {
			directories[directory] = struct{}{}
			if directory == path.Dir(directory) {
				break
			}
		}
	}
	directoryNames := make([]string, 0, len(directories))
	for directory := range directories {
		directoryNames = append(directoryNames, directory)
	}
	sort.Strings(directoryNames)
	for _, directory := range directoryNames {
		if err := writer.WriteHeader(&tar.Header{Name: directory, Mode: 0o755, Typeflag: tar.TypeDir}); err != nil {
			return nil, err
		}
	}
	for _, file := range request.Files {
		if err := writeTarFile(writer, file.Path, []byte(file.Content)); err != nil {
			return nil, err
		}
	}
	if err := writeTarFile(writer, ".common-ground-stdin", []byte(request.Stdin)); err != nil {
		return nil, err
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}

func writeTarFile(writer *tar.Writer, name string, contents []byte) error {
	if err := writer.WriteHeader(&tar.Header{Name: name, Mode: 0o644, Size: int64(len(contents)), Typeflag: tar.TypeReg}); err != nil {
		return err
	}
	_, err := writer.Write(contents)
	return err
}

func containerName(requestID string) string {
	return fmt.Sprintf("common-ground-%s-%d", requestID, time.Now().UnixNano())
}

func reasonFor(runContext, parent context.Context, outputLimited bool) string {
	if outputLimited {
		return "limit"
	}
	if parent.Err() != nil {
		return "cancelled"
	}
	if errors.Is(runContext.Err(), context.DeadlineExceeded) {
		return "timeout"
	}
	return "completed"
}

func isContainerID(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, character := range value {
		if !strings.ContainsRune("0123456789abcdef", character) {
			return false
		}
	}
	return true
}

func removeContainer(containerID string) {
	if !isContainerID(containerID) {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = exec.CommandContext(ctx, "docker", "rm", "--force", containerID).Run()
}

func CleanupOrphans(ctx context.Context) error {
	output, err := exec.CommandContext(ctx, "docker", "ps", "--all", "--quiet", "--filter", "label="+runnerLabel).Output()
	if err != nil {
		return err
	}
	for _, containerID := range strings.Fields(string(output)) {
		if isContainerID(containerID) {
			removeContainer(containerID)
		}
	}
	return nil
}

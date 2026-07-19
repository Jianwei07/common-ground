package docker

import (
	"archive/tar"
	"bytes"
	"context"
	"io"
	"os"
	"strings"
	"testing"
	"time"

	cgruntime "github.com/jayden77/common-ground/runner/internal/runtime"
)

func dockerRequest(runtimeID string) cgruntime.Request {
	extension := map[string]string{"javascript": "js", "typescript": "ts", "python": "py", "go": "go", "rust": "rs"}[runtimeID]
	return cgruntime.Request{
		RequestID: "request-1", RuntimeID: runtimeID, Entrypoint: "src/main." + extension,
		Files: []cgruntime.File{{Path: "src/main." + extension, Content: "content"}}, Stdin: "input",
	}
}

func TestCreateArgsEnforceSandboxForEveryRuntime(t *testing.T) {
	required := []string{
		"--network none", "--read-only", "--cap-drop ALL", "--security-opt no-new-privileges",
		"--cpus 1", "--memory 512m", "--memory-swap 512m", "--pids-limit 64",
		"--user 65534:65534", "--tmpfs /workspace:rw,nosuid,nodev,size=64m,mode=1777",
	}
	for runtimeID, definition := range definitions {
		t.Run(runtimeID, func(t *testing.T) {
			if !strings.Contains(definition.image, "@sha256:") {
				t.Fatalf("image is not digest pinned: %s", definition.image)
			}
			arguments := createArgs(definition, dockerRequest(runtimeID), "common-ground-test")
			joined := strings.Join(arguments, " ")
			for _, flag := range required {
				if !strings.Contains(joined, flag) {
					t.Errorf("missing sandbox flag %q", flag)
				}
			}
			if strings.Contains(joined, "--mount") || strings.Contains(joined, "--volume") || strings.Contains(joined, "/var/run/docker.sock") {
				t.Fatal("host mounts reached the Docker command")
			}
			if arguments[len(arguments)-1] != dockerRequest(runtimeID).Entrypoint {
				t.Fatal("entrypoint must be a quoted positional argument")
			}
		})
	}
}

func TestWorkspaceArchiveContainsOnlySubmittedFilesAndStdin(t *testing.T) {
	request := dockerRequest("javascript")
	archive, err := workspaceArchive(request)
	if err != nil {
		t.Fatal(err)
	}
	reader := tar.NewReader(bytes.NewReader(archive))
	contents := map[string]string{}
	for {
		header, err := reader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		if header.Typeflag == tar.TypeReg {
			value, readErr := io.ReadAll(reader)
			if readErr != nil {
				t.Fatal(readErr)
			}
			contents[header.Name] = string(value)
		}
	}
	if contents[request.Entrypoint] != "content" || contents[".common-ground-stdin"] != "input" || len(contents) != 2 {
		t.Fatalf("unexpected archive: %#v", contents)
	}
}

func TestDockerJavaScriptIsolation(t *testing.T) {
	if os.Getenv("CG_DOCKER_TEST") != "1" {
		t.Skip("set CG_DOCKER_TEST=1 after pulling the pinned Node image")
	}
	request := dockerRequest("javascript")
	request.Files[0].Content = `const fs = require("node:fs");
const net = require("node:net");
console.log(fs.existsSync("/var/run/docker.sock") ? "socket-visible" : "socket-blocked");
const socket = net.connect({ host: "1.1.1.1", port: 53 });
socket.on("error", () => { console.log("network-blocked"); process.exit(0); });
setTimeout(() => process.exit(2), 1000);`
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	var output strings.Builder
	var exit cgruntime.Event
	for event := range New().Run(ctx, request) {
		if event.Type == "stdout" || event.Type == "stderr" {
			output.WriteString(event.Chunk)
		}
		if event.Type == "exit" {
			exit = event
		}
	}
	if !strings.Contains(output.String(), "socket-blocked") || !strings.Contains(output.String(), "network-blocked") {
		t.Fatalf("sandbox assertions failed: %s", output.String())
	}
	if exit.ExitCode == nil || *exit.ExitCode != 0 || exit.Reason != "completed" {
		t.Fatalf("unexpected exit: %#v", exit)
	}
}

package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/jayden77/common-ground/runner/internal/api"
	"github.com/jayden77/common-ground/runner/internal/docker"
)

type originsFlag []string

func (origins *originsFlag) String() string { return strings.Join(*origins, ",") }
func (origins *originsFlag) Set(value string) error {
	*origins = append(*origins, strings.TrimSuffix(value, "/"))
	return nil
}

func main() {
	address := flag.String("address", "127.0.0.1:43117", "loopback listen address")
	origins := originsFlag{"http://localhost:3000", "http://127.0.0.1:3000"}
	flag.Var(&origins, "origin", "exact browser origin to allow (repeatable)")
	flag.Parse()
	if !strings.HasPrefix(*address, "127.0.0.1:") && !strings.HasPrefix(*address, "[::1]:") && !strings.HasPrefix(*address, "localhost:") {
		log.Fatal("address must be loopback")
	}

	pairCode, err := api.NewPairCode()
	if err != nil {
		log.Fatal("pairing code generation failed")
	}
	logger := log.New(os.Stderr, "common-ground-runner ", log.LstdFlags)
	executor := docker.New()
	cleanupContext, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
	if err := docker.CleanupOrphans(cleanupContext); err != nil {
		logger.Printf("orphan_cleanup=unavailable error_code=docker_unavailable")
	}
	cleanupCancel()
	apiServer, err := api.New(executor, origins, pairCode, 15*time.Minute, logger)
	if err != nil {
		log.Fatal(err)
	}

	server := &http.Server{
		Addr:              *address,
		Handler:           apiServer.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       30 * time.Second,
		MaxHeaderBytes:    16 * 1024,
	}
	stopContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stopContext.Done():
				return
			case now := <-ticker.C:
				if apiServer.IdleExpired(now) {
					logger.Printf("shutdown=idle")
					stop()
					return
				}
			}
		}
	}()
	go func() {
		<-stopContext.Done()
		shutdownContext, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownContext)
	}()

	fmt.Printf("Common Ground runner\nListening: http://%s\nPairing code: %s\nAllowed origins: %s\n", *address, pairCode, strings.Join(origins, ", "))
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Fatal(err)
	}
}

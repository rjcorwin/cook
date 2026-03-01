package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type CookConfig struct {
	Network struct {
		Mode         string   `json:"mode"`
		AllowedHosts []string `json:"allowedHosts"`
	} `json:"network"`
	Env []string `json:"env"`
}

func loadConfig(projectRoot string) CookConfig {
	var cfg CookConfig
	data, err := os.ReadFile(filepath.Join(projectRoot, ".cook.config.json"))
	if err != nil {
		return cfg
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		logWarn("Malformed .cook.config.json: %v", err)
		fmt.Fprintf(os.Stderr, "  Using default configuration\n")
	}
	return cfg
}

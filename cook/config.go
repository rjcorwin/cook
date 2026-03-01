package main

import (
	"encoding/json"
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
	json.Unmarshal(data, &cfg)
	return cfg
}

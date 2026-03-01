package main

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strings"

	"github.com/docker/docker/api/types"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/client"
	"github.com/docker/docker/pkg/stdcopy"
)

const baseImageName = "cook-sandbox"

const baseDockerfile = `FROM node:22-slim
RUN npm install -g @anthropic-ai/claude-code
RUN apt-get update && apt-get install -y git iptables && rm -rf /var/lib/apt/lists/*
`

type Sandbox struct {
	client      *client.Client
	containerID string
	projectRoot string
	userSpec    string // "uid:gid"
}

func ensureBaseImage(cli *client.Client) error {
	ctx := context.Background()
	_, _, err := cli.ImageInspectWithRaw(ctx, baseImageName)
	if err == nil {
		return nil // image exists
	}

	logStep("Building sandbox image (first run)...")
	return buildImage(cli, baseImageName, baseDockerfile)
}

func buildImage(cli *client.Client, imageName, dockerfile string) error {
	ctx := context.Background()

	// Create tar archive with Dockerfile
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)
	if err := tw.WriteHeader(&tar.Header{
		Name: "Dockerfile",
		Size: int64(len(dockerfile)),
		Mode: 0644,
	}); err != nil {
		return fmt.Errorf("writing tar header: %w", err)
	}
	if _, err := tw.Write([]byte(dockerfile)); err != nil {
		return fmt.Errorf("writing tar data: %w", err)
	}
	if err := tw.Close(); err != nil {
		return fmt.Errorf("closing tar: %w", err)
	}

	resp, err := cli.ImageBuild(ctx, &buf, types.ImageBuildOptions{
		Tags:       []string{imageName},
		Remove:     true,
		Dockerfile: "Dockerfile",
	})
	if err != nil {
		return fmt.Errorf("building image %s: %w", imageName, err)
	}
	defer resp.Body.Close()
	// Drain build output
	io.Copy(io.Discard, resp.Body)
	logOK("Image %s built", imageName)
	return nil
}

func startSandbox(projectRoot string, cfg CookConfig) (*Sandbox, error) {
	ctx := context.Background()

	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, fmt.Errorf("connecting to Docker: %w", err)
	}

	// Clean up stale containers from this project before starting
	cleanupStaleContainers(cli, projectRoot)

	if err := ensureBaseImage(cli); err != nil {
		return nil, err
	}

	// Determine image (project-specific or base)
	imageName := baseImageName
	projectDockerfile := filepath.Join(projectRoot, ".cook.Dockerfile")
	if data, err := os.ReadFile(projectDockerfile); err == nil {
		hash := fmt.Sprintf("%x", sha256.Sum256(data))[:12]
		projImage := fmt.Sprintf("cook-project-%s:%s", filepath.Base(projectRoot), hash)
		_, _, inspectErr := cli.ImageInspectWithRaw(ctx, projImage)
		if inspectErr != nil {
			logStep("Building project-specific sandbox image...")
			if err := buildImage(cli, projImage, string(data)); err != nil {
				return nil, err
			}
		}
		imageName = projImage
	}

	// Git identity
	gitName := gitConfig("user.name", "cook")
	gitEmail := gitConfig("user.email", "cook@localhost")

	// Host UID/GID
	u, err := user.Current()
	if err != nil {
		return nil, fmt.Errorf("getting current user: %w", err)
	}
	uid := u.Uid
	gid := u.Gid
	userSpec := uid + ":" + gid

	// Environment
	env := []string{
		"GIT_AUTHOR_NAME=" + gitName,
		"GIT_AUTHOR_EMAIL=" + gitEmail,
		"GIT_COMMITTER_NAME=" + gitName,
		"GIT_COMMITTER_EMAIL=" + gitEmail,
	}
	for _, varName := range cfg.Env {
		if val, ok := os.LookupEnv(varName); ok {
			env = append(env, varName+"="+val)
		}
	}

	// Capabilities for network restriction
	var capAdd []string
	if cfg.Network.Mode == "restricted" {
		capAdd = append(capAdd, "NET_ADMIN")
	}

	// Create container
	containerName := fmt.Sprintf("cook-%d", os.Getpid())
	resp, err := cli.ContainerCreate(ctx,
		&container.Config{
			Image: imageName,
			Cmd:   []string{"sleep", "infinity"},
			Env:   env,
			Labels: map[string]string{
				"cook.project": projectRoot,
			},
		},
		&container.HostConfig{
			Binds:  []string{projectRoot + ":" + projectRoot},
			CapAdd: capAdd,
		},
		nil, nil, containerName,
	)
	if err != nil {
		return nil, fmt.Errorf("creating container: %w", err)
	}

	if err := cli.ContainerStart(ctx, resp.ID, container.StartOptions{}); err != nil {
		cli.ContainerRemove(ctx, resp.ID, container.RemoveOptions{Force: true})
		return nil, fmt.Errorf("starting container: %w", err)
	}

	sb := &Sandbox{
		client:      cli,
		containerID: resp.ID,
		projectRoot: projectRoot,
		userSpec:    userSpec,
	}

	logOK("Sandbox started (container: %s)", containerName)

	// Create non-root user matching host UID/GID
	setupCmd := fmt.Sprintf(
		"groupadd -g %s -o cookgroup 2>/dev/null || true; "+
			"useradd -m -s /bin/bash -u %s -g %s -o cook 2>/dev/null || true",
		gid, uid, gid,
	)
	sb.containerExec("root", []string{"bash", "-c", setupCmd})

	// Copy auth files
	sb.containerExec("root", []string{"mkdir", "-p", "/home/cook/.claude"})
	home, _ := os.UserHomeDir()
	sb.copyFileToContainer(filepath.Join(home, ".claude.json"), "/home/cook/.claude.json")
	sb.copyFileToContainer(filepath.Join(home, ".claude", ".credentials.json"), "/home/cook/.claude/.credentials.json")
	sb.containerExec("root", []string{"chown", "-R", userSpec, "/home/cook"})

	// Network restriction
	if cfg.Network.Mode == "restricted" {
		logStep("Applying network restrictions...")
		script := generateIptablesScript(cfg.Network.AllowedHosts)
		sb.containerExec("root", []string{"sh", "-c", script})
		logOK("Network restricted to: api.anthropic.com %s", strings.Join(cfg.Network.AllowedHosts, " "))
	}

	return sb, nil
}

func (sb *Sandbox) stopSandbox() {
	if sb.containerID == "" {
		return
	}
	ctx := context.Background()
	sb.client.ContainerRemove(ctx, sb.containerID, container.RemoveOptions{Force: true})
	logOK("Sandbox stopped")
}

func (sb *Sandbox) containerExec(userSpec string, cmd []string) (string, error) {
	return sb.containerExecWithEnv(userSpec, nil, cmd)
}

func (sb *Sandbox) runClaude(model, prompt string) (string, error) {
	logStep("Running Claude...")
	env := []string{"HOME=/home/cook"}
	output, err := sb.containerExecWithEnv(sb.userSpec, env, []string{
		"claude",
		"--model", model,
		"--dangerously-skip-permissions",
		"--print",
		prompt,
	})
	if err != nil {
		return output, fmt.Errorf("claude: %w", err)
	}
	return output, nil
}

func (sb *Sandbox) containerExecWithEnv(userSpec string, env, cmd []string) (string, error) {
	ctx := context.Background()

	execCfg := container.ExecOptions{
		User:         userSpec,
		Cmd:          cmd,
		Env:          env,
		AttachStdout: true,
		AttachStderr: true,
		WorkingDir:   sb.projectRoot,
	}

	execResp, err := sb.client.ContainerExecCreate(ctx, sb.containerID, execCfg)
	if err != nil {
		return "", fmt.Errorf("exec create: %w", err)
	}

	attach, err := sb.client.ContainerExecAttach(ctx, execResp.ID, container.ExecAttachOptions{})
	if err != nil {
		return "", fmt.Errorf("exec attach: %w", err)
	}
	defer attach.Close()

	var stdout, stderr bytes.Buffer
	stdcopy.StdCopy(&stdout, &stderr, attach.Reader)

	inspect, err := sb.client.ContainerExecInspect(ctx, execResp.ID)
	if err != nil {
		return stdout.String(), fmt.Errorf("exec inspect: %w", err)
	}
	if inspect.ExitCode != 0 {
		return stdout.String(), fmt.Errorf("command exited %d: %s", inspect.ExitCode, stderr.String())
	}

	return stdout.String(), nil
}

func (sb *Sandbox) copyFileToContainer(hostPath, containerPath string) error {
	data, err := os.ReadFile(hostPath)
	if err != nil {
		return nil // file doesn't exist, skip silently
	}

	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)
	if err := tw.WriteHeader(&tar.Header{
		Name: filepath.Base(containerPath),
		Size: int64(len(data)),
		Mode: 0644,
	}); err != nil {
		return fmt.Errorf("writing tar header: %w", err)
	}
	if _, err := tw.Write(data); err != nil {
		return fmt.Errorf("writing tar data: %w", err)
	}
	if err := tw.Close(); err != nil {
		return fmt.Errorf("closing tar: %w", err)
	}

	ctx := context.Background()
	return sb.client.CopyToContainer(ctx, sb.containerID, filepath.Dir(containerPath), &buf, container.CopyToContainerOptions{})
}

func generateIptablesScript(allowedHosts []string) string {
	hosts := make([]string, 0, len(allowedHosts)+1)
	hosts = append(hosts, "api.anthropic.com")
	hosts = append(hosts, allowedHosts...)
	hostList := strings.Join(hosts, " ")

	return fmt.Sprintf(`set -e
ALLOWED_IPS=""
for host in %s; do
    ips=$(getent hosts "$host" 2>/dev/null | awk '{print $1}' || true)
    ALLOWED_IPS="$ALLOWED_IPS $ips"
done
iptables -P OUTPUT DROP
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -p udp -d 127.0.0.11 --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp -d 127.0.0.11 --dport 53 -j ACCEPT
for ip in $ALLOWED_IPS; do
    iptables -A OUTPUT -p tcp -d "$ip" --dport 443 -j ACCEPT
done`, hostList)
}

func gitConfig(key, fallback string) string {
	out, err := exec.Command("git", "config", key).Output()
	if err != nil || strings.TrimSpace(string(out)) == "" {
		return fallback
	}
	return strings.TrimSpace(string(out))
}

func cleanupStaleContainers(cli *client.Client, projectRoot string) {
	ctx := context.Background()
	containers, err := cli.ContainerList(ctx, container.ListOptions{All: true})
	if err != nil {
		return
	}
	for _, c := range containers {
		if c.Labels["cook.project"] != projectRoot {
			continue
		}
		for _, name := range c.Names {
			if strings.HasPrefix(name, "/cook-") {
				cli.ContainerRemove(ctx, c.ID, container.RemoveOptions{Force: true})
			}
		}
	}
}

func rebuildBaseImage() error {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return fmt.Errorf("connecting to Docker: %w", err)
	}
	defer cli.Close()

	ctx := context.Background()

	// Remove existing image
	_, _, err = cli.ImageInspectWithRaw(ctx, baseImageName)
	if err == nil {
		logStep("Removing existing %s image...", baseImageName)
		cli.ImageRemove(ctx, baseImageName, image.RemoveOptions{Force: true})
	}

	logStep("Building %s image...", baseImageName)
	return buildImage(cli, baseImageName, baseDockerfile)
}

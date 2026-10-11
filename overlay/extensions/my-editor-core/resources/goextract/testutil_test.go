package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
)

var (
	listMu    sync.Mutex
	listCache = map[string]string{}
)

func TestMain(m *testing.M) {
	code := m.Run()
	for _, file := range listCache {
		os.RemoveAll(filepath.Dir(file))
	}
	os.Exit(code)
}

// goEnv is how every go command in the tests runs: the installed toolchain only, no proxy, none of the user's GOFLAGS.
func goEnv() []string {
	return append(os.Environ(), "GOTOOLCHAIN=local", "GOFLAGS=", "GOPROXY=off")
}

// casesDir is the absolute path of testdata/cases.
func casesDir(t *testing.T) string {
	t.Helper()
	dir, err := filepath.Abs(filepath.Join("testdata", "cases"))
	if err != nil {
		t.Fatal(err)
	}
	return dir
}

// caseFile is the absolute path of a case's a.go.
func caseFile(t *testing.T, name string) string {
	return filepath.Join(casesDir(t), name, "a.go")
}

// listCase runs `go list -export -deps -json ./<name>` once per case; it returns the list file and the import path.
func listCase(t *testing.T, name string) (string, string) {
	t.Helper()
	listMu.Lock()
	defer listMu.Unlock()
	if file, ok := listCache[name]; ok {
		return file, "cases/" + name
	}
	cmd := exec.Command("go", "list", "-export", "-deps", "-json", "./"+name)
	cmd.Dir = casesDir(t)
	cmd.Env = goEnv()
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("go list %s: %v", name, err)
	}
	dir, err := os.MkdirTemp("", "goextract-list-")
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, name+".json")
	if err := os.WriteFile(file, out, 0o644); err != nil {
		t.Fatal(err)
	}
	listCache[name] = file
	return file, "cases/" + name
}

// loadCase type-checks a case package, with a.go replaced by aGo when it is not nil.
func loadCase(t *testing.T, name string, aGo []byte) *Loaded {
	t.Helper()
	list, pkg := listCase(t, name)
	var overlay map[string][]byte
	if aGo != nil {
		overlay = map[string][]byte{caseFile(t, name): aGo}
	}
	l, err := Load(list, pkg, overlay)
	if err != nil {
		t.Fatalf("load %s: %v", name, err)
	}
	return l
}

// readCase is a case's a.go.
func readCase(t *testing.T, name string) []byte {
	t.Helper()
	src, err := os.ReadFile(caseFile(t, name))
	if err != nil {
		t.Fatal(err)
	}
	return src
}

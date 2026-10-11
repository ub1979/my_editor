package main

import (
	"bytes"
	"encoding/json"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// runCLI runs the command line and returns its exit code, stdout and stderr.
func runCLI(args ...string) (int, string, string) {
	var out, errOut bytes.Buffer
	code := run(args, &out, &errOut)
	return code, out.String(), errOut.String()
}

// caseFlags are the flags naming a case's function.
func caseFlags(t *testing.T, name, fn string) []string {
	list, pkg := listCase(t, name)
	return []string{"-list", list, "-pkg", pkg, "-file", caseFile(t, name), "-func", fn}
}

func TestCLIUsage(t *testing.T) {
	for _, args := range [][]string{nil, {"frob"}, append([]string{"build"}, caseFlags(t, "basic", "Report")...)} {
		code, out, errOut := runCLI(args...)
		if code != 2 || out != "" || !strings.Contains(errOut, "usage: goextract") {
			t.Fatalf("%v: %d %q %q", args, code, out, errOut)
		}
	}
}

func TestCLIOutline(t *testing.T) {
	code, out, errOut := runCLI(append([]string{"outline"}, caseFlags(t, "onboarding", "Plan")...)...)
	var o Outline
	if code != 0 || errOut != "" || json.Unmarshal([]byte(out), &o) != nil {
		t.Fatalf("%d %q %q", code, out, errOut)
	}
	if f := o.Function; f.Name != "Plan" || f.StartLine != 31 || f.EndLine != 59 || f.Lines != 29 || len(o.Blocks[0].Statements) != 10 {
		t.Fatalf("%+v", o)
	}
	if s := o.Blocks[0].Statements[5]; s.From != 50 || s.Refused != "defer" {
		t.Fatalf("%+v", s)
	}
	_, out, _ = runCLI(append([]string{"outline"}, caseFlags(t, "generic", "Sum")...)...)
	if !strings.Contains(out, `"refused":"Sum is generic."`) || !strings.Contains(out, `"blocks":[]`) {
		t.Fatal(out)
	}
	_, out, _ = runCLI("outline", "-list", "/nonexistent.json", "-pkg", "x", "-file", "/x/a.go", "-func", "F")
	if !strings.Contains(out, `"refused":"open /nonexistent.json`) {
		t.Fatal(out)
	}
}

func TestCLIBuildAndCheck(t *testing.T) {
	dir := t.TempDir()
	plan, out, build := filepath.Join(dir, "plan.json"), filepath.Join(dir, "out.go"), filepath.Join(dir, "build.json")
	if err := os.WriteFile(plan, []byte(`[{"name":"queryRows","from":38,"to":46}]`), 0o644); err != nil {
		t.Fatal(err)
	}
	code, stdout, errOut := runCLI(append(append([]string{"build"}, caseFlags(t, "onboarding", "Plan")...), "-plan", plan, "-out", out)...)
	if code != 0 || errOut != "" {
		t.Fatalf("%d %q %q", code, stdout, errOut)
	}
	got, err := os.ReadFile(out)
	want, _ := os.ReadFile(filepath.Join("testdata", "want", "onboarding.go.txt"))
	if err != nil || string(got) != string(want) {
		t.Fatalf("%v\n%s", err, got)
	}
	if err := os.WriteFile(build, []byte(stdout), 0o644); err != nil {
		t.Fatal(err)
	}
	args := append(append([]string{"check"}, caseFlags(t, "onboarding", "Plan")...), "-before", caseFile(t, "onboarding"), "-build", build, "-after", out)
	if code, stdout, errOut = runCLI(args...); code != 0 || strings.TrimSpace(stdout) != `{"problems":[]}` {
		t.Fatalf("%d %q %q", code, stdout, errOut)
	}
	os.Remove(out)
	if err := os.WriteFile(plan, []byte(`[{"name":"queryRows","from":38,"to":47}]`), 0o644); err != nil {
		t.Fatal(err)
	}
	code, stdout, _ = runCLI(append(append([]string{"build"}, caseFlags(t, "onboarding", "Plan")...), "-plan", plan, "-out", out)...)
	if _, err := os.Stat(out); code != 0 || !strings.Contains(stdout, `"problems":["queryRows: Lines 38–47`) || err == nil {
		t.Fatalf("%d %q %v", code, stdout, err)
	}
	_, stdout, _ = runCLI(append(append([]string{"build"}, caseFlags(t, "generic", "Sum")...), "-plan", plan, "-out", out)...)
	if !strings.Contains(stdout, `"problems":["Sum is generic."]`) {
		t.Fatal(stdout)
	}
}

// copyTree copies a directory tree.
func copyTree(t *testing.T, from, to string) {
	t.Helper()
	err := filepath.WalkDir(from, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(from, path)
		if d.IsDir() {
			return os.MkdirAll(filepath.Join(to, rel), 0o755)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(filepath.Join(to, rel), data, 0o644)
	})
	if err != nil {
		t.Fatal(err)
	}
}

// goIn runs a go command in a folder, failing the test on an error.
func goIn(t *testing.T, dir string, args ...string) []byte {
	t.Helper()
	cmd := exec.Command("go", args...)
	cmd.Dir, cmd.Env = dir, goEnv()
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("go %v: %v\n%s", args, err, out)
	}
	return out
}

func TestEndToEndPins(t *testing.T) {
	names := []string{"deferrecover", "buildercopy", "valuepath", "multireturn", "tail", "tailvoid", "breakswitch", "ptrselector",
		"rangearrayptr", "addrderef", "loopout", "names"}
	dir := t.TempDir()
	copyTree(t, casesDir(t), dir)
	var pkgs []string
	for _, name := range names {
		g := goldenRow(t, name)
		file, list := filepath.Join(dir, name, "a.go"), filepath.Join(dir, name+".json")
		var listOut bytes.Buffer
		cmd := exec.Command("go", "list", "-export", "-deps", "-json", "./"+name)
		cmd.Dir, cmd.Env, cmd.Stdout = dir, goEnv(), &listOut
		if err := cmd.Run(); err != nil {
			t.Fatal(err)
		}
		plan, out, build := filepath.Join(dir, name+".plan"), filepath.Join(dir, name+".out"), filepath.Join(dir, name+".build")
		os.WriteFile(list, listOut.Bytes(), 0o644)
		planJSON, _ := json.Marshal([]PlanChunk{{g.helper, g.from, g.to}})
		os.WriteFile(plan, planJSON, 0o644)
		flags := []string{"-list", list, "-pkg", "cases/" + name, "-file", file, "-func", g.fn}
		code, stdout, errOut := runCLI(append(append([]string{"build"}, flags...), "-plan", plan, "-out", out)...)
		built, err := os.ReadFile(out)
		if code != 0 || err != nil {
			t.Fatalf("%s: %d %q %q %v", name, code, stdout, errOut, err)
		}
		os.WriteFile(build, []byte(stdout), 0o644)
		if err := os.WriteFile(file, built, 0o644); err != nil {
			t.Fatal(err)
		}
		args := append(append([]string{"check"}, flags...), "-before", caseFile(t, name), "-build", build)
		if code, stdout, errOut = runCLI(args...); code != 0 || strings.TrimSpace(stdout) != `{"problems":[]}` {
			t.Fatalf("%s: %d %q %q", name, code, stdout, errOut)
		}
		pkgs = append(pkgs, "./"+name)
	}
	goIn(t, dir, append([]string{"vet"}, pkgs...)...)
	goIn(t, dir, append([]string{"test", "-count=1"}, pkgs...)...)
}

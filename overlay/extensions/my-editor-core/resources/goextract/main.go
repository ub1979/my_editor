//go:debug gotypesalias=1

// Command goextract outlines, extracts and checks helpers of one long Go function for my_editor's AI-ready refactors.
// It uses only the standard library, reads the package's types from `go list -export -deps -json` output, and never
// writes the files it reads.
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

const usage = `usage: goextract outline -list L -pkg P -file F -func NAME [-recv TYPE]
       goextract build   -list L -pkg P -file F -func NAME [-recv TYPE] -plan PLAN.json -out OUT.go
       goextract check   -list L -pkg P -file F -func NAME [-recv TYPE] -before BEFORE.go -build BUILD.json [-after AFTER.go]`

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

// errUsage marks a usage error; any other error from a subcommand is an I/O error.
var errUsage = errors.New("usage")

// funcFlags names the function every subcommand works on.
type funcFlags struct {
	list, pkg, file, fn, recv string
}

// run is the command line: JSON on stdout and 0 whenever JSON was printed; usage or I/O errors on stderr and 2.
func run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprintln(stderr, usage)
		return 2
	}
	var out any
	var err error
	switch args[0] {
	case "outline":
		out, err = outlineCmd(args[1:])
	case "build":
		out, err = buildCmd(args[1:])
	case "check":
		out, err = checkCmd(args[1:])
	default:
		err = errUsage
	}
	if err != nil {
		if errors.Is(err, errUsage) {
			fmt.Fprintln(stderr, usage)
		} else {
			fmt.Fprintln(stderr, "goextract:", err)
		}
		return 2
	}
	data, err := json.Marshal(out)
	if err != nil {
		fmt.Fprintln(stderr, "goextract:", err)
		return 2
	}
	fmt.Fprintln(stdout, string(data))
	return 0
}

// flags parses the common flags and a subcommand's own; every flag in required must be set.
func flags(args []string, own map[string]*string, required ...string) (funcFlags, error) {
	var tg funcFlags
	fs := flag.NewFlagSet("goextract", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	fs.StringVar(&tg.list, "list", "", "")
	fs.StringVar(&tg.pkg, "pkg", "", "")
	fs.StringVar(&tg.file, "file", "", "")
	fs.StringVar(&tg.fn, "func", "", "")
	fs.StringVar(&tg.recv, "recv", "", "")
	for name, p := range own {
		fs.StringVar(p, name, "", "")
	}
	if err := fs.Parse(args); err != nil || fs.NArg() > 0 || tg.list == "" || tg.pkg == "" || tg.file == "" || tg.fn == "" {
		return tg, errUsage
	}
	for _, name := range required {
		if *own[name] == "" {
			return tg, errUsage
		}
	}
	abs, err := filepath.Abs(tg.file)
	if err != nil {
		return tg, err
	}
	// go list reports folders with symlinks resolved (/private/var for /var on macOS).
	if real, err := filepath.EvalSymlinks(abs); err == nil {
		abs = real
	}
	tg.file = abs
	return tg, nil
}

// find loads the package and finds the function, or says why it is out of reach or out of scope.
func (tg funcFlags) find() (*Target, string) {
	l, err := Load(tg.list, tg.pkg, nil)
	if err != nil {
		return nil, err.Error()
	}
	t, err := FindFunc(l, tg.file, tg.fn, tg.recv)
	if err != nil {
		return nil, err.Error()
	}
	return t, ScopeProblem(t)
}

func outlineCmd(args []string) (any, error) {
	tg, err := flags(args, nil)
	if err != nil {
		return nil, err
	}
	t, refused := tg.find()
	if t == nil {
		return Outline{Refused: refused, Blocks: []BlockFacts{}}, nil
	}
	return MakeOutline(t), nil
}

func buildCmd(args []string) (any, error) {
	var planFile, outFile string
	tg, err := flags(args, map[string]*string{"plan": &planFile, "out": &outFile}, "plan", "out")
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(planFile)
	if err != nil {
		return nil, err
	}
	var plan []PlanChunk
	if err := json.Unmarshal(data, &plan); err != nil {
		return nil, fmt.Errorf("reading the plan: %v", err)
	}
	t, refused := tg.find()
	if refused != "" {
		return BuildResult{Problems: []string{refused}}, nil
	}
	res, src := Build(t, plan)
	if len(res.Problems) == 0 {
		if err := os.WriteFile(outFile, src, 0o644); err != nil {
			return nil, err
		}
	}
	return res, nil
}

// checkResult is what `check` prints.
type checkResult struct {
	Problems []string `json:"problems"`
}

func checkCmd(args []string) (any, error) {
	var beforeFile, buildFile, afterFile string
	tg, err := flags(args, map[string]*string{"before": &beforeFile, "build": &buildFile, "after": &afterFile}, "before", "build")
	if err != nil {
		return nil, err
	}
	if afterFile == "" {
		afterFile = tg.file
	}
	var files [3][]byte
	for i, name := range []string{beforeFile, buildFile, afterFile} {
		if files[i], err = os.ReadFile(name); err != nil {
			return nil, err
		}
	}
	var built BuildResult
	if err := json.Unmarshal(files[1], &built); err != nil {
		return nil, fmt.Errorf("reading the build result: %v", err)
	}
	problems := Check(tg.list, tg.pkg, tg.file, tg.fn, tg.recv, files[0], files[2], built)
	if problems == nil {
		problems = []string{}
	}
	return checkResult{problems}, nil
}

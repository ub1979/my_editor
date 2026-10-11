package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadListPicksTarget(t *testing.T) {
	stream := `{"ImportPath":"fmt","Export":"/x/fmt.a"}
{"ImportPath":"example.com/p","Dir":"/w/p","Name":"p","GoFiles":["a.go"],"ImportMap":{"q":"vendor/q"}}`
	target, exports, err := ReadList(strings.NewReader(stream), "example.com/p")
	if err != nil || target.Dir != "/w/p" || exports["fmt"] != "/x/fmt.a" || target.ImportMap["q"] != "vendor/q" {
		t.Fatalf("%+v %v %v", target, exports, err)
	}
	if _, _, err := ReadList(strings.NewReader(stream), "example.com/missing"); err == nil || !strings.Contains(err.Error(), "not in the list") {
		t.Fatal(err)
	}
}

func TestLoadRefusesCgoAndListErrors(t *testing.T) {
	file := filepath.Join(t.TempDir(), "list.json")
	write := func(text string) string {
		if err := os.WriteFile(file, []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
		return file
	}
	if _, err := Load(write(`{"ImportPath":"p","Dir":"/w","GoFiles":["a.go"],"CgoFiles":["c.go"]}`), "p", nil); err == nil ||
		!strings.Contains(err.Error(), "uses cgo") {
		t.Fatal(err)
	}
	if _, err := Load(write(`{"ImportPath":"p","Dir":"/w","Error":{"Err":"no Go files in /w"}}`), "p", nil); err == nil ||
		!strings.Contains(err.Error(), "no Go files") {
		t.Fatal(err)
	}
}

func TestLoadTypeChecksFromExportData(t *testing.T) {
	l := loadCase(t, "basic", nil)
	found := false
	for id, obj := range l.Info.Uses {
		if id.Name == "Join" && obj.Pkg() != nil && obj.Pkg().Path() == "strings" {
			found = true
		}
	}
	if l.Pkg.Name() != "basic" || !found || l.File(caseFile(t, "basic")) == nil {
		t.Fatalf("package %s, strings.Join resolved: %v", l.Pkg.Name(), found)
	}
}

func TestLoadOverlayAndTypeErrors(t *testing.T) {
	src := readCase(t, "basic")
	l := loadCase(t, "basic", append(append([]byte{}, src...), "\nvar Extra = 1\n"...))
	if l.Pkg.Scope().Lookup("Extra") == nil {
		t.Fatal("the overlay was not used")
	}
	list, pkg := listCase(t, "basic")
	bad := append(append([]byte{}, src...), "\nvar bad int = \"s\"\n"...)
	if _, err := Load(list, pkg, map[string][]byte{caseFile(t, "basic"): bad}); err == nil || !strings.Contains(err.Error(), "does not type-check") {
		t.Fatal(err)
	}
}

func TestLoadTestNames(t *testing.T) {
	l := loadCase(t, "names", nil)
	if !l.TestNames["takenInTests"] || !l.TestNames["TestPin"] || l.TestNames["F"] {
		t.Fatal(l.TestNames)
	}
}

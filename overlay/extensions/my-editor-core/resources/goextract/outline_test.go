package main

import (
	"fmt"
	"strings"
	"testing"
)

// stmtsText writes a block's statements as `from–to kind [declares]`, with ` refused R` when refused.
func stmtsText(b BlockFacts) []string {
	var out []string
	for _, s := range b.Statements {
		text := fmt.Sprintf("%d–%d %s %v", s.From, s.To, s.Kind, s.Declares)
		if s.Refused != "" {
			text += " refused " + s.Refused
		}
		out = append(out, text)
	}
	return out
}

// blockAt is the outline block at a line.
func blockAt(t *testing.T, o Outline, line int) BlockFacts {
	t.Helper()
	for _, b := range o.Blocks {
		if b.Line == line {
			return b
		}
	}
	t.Fatalf("no block at line %d in %+v", line, o.Blocks)
	return BlockFacts{}
}

func TestOutlineFunction(t *testing.T) {
	o := MakeOutline(target(t, "onboarding", "Plan", ""))
	if f := o.Function; f.Name != "Plan" || f.Receiver != "" || f.StartLine != 31 || f.EndLine != 59 || f.Lines != 29 || o.Refused != "" {
		t.Fatalf("%+v %q", f, o.Refused)
	}
	o = MakeOutline(target(t, "methodset", "Run", "S"))
	if f := o.Function; f.Name != "Run" || f.Receiver != "*S" {
		t.Fatalf("%+v", f)
	}
}

func TestOutlineBody(t *testing.T) {
	o := MakeOutline(target(t, "basic", "Report", ""))
	b := o.Blocks[0]
	got := strings.Join(stmtsText(b), "; ")
	want := "11–11 var [out]; 12–14 range []; 15–15 define [text]; 16–18 if []; 19–19 return []"
	if b.Line != 10 || b.Depth != 1 || got != want {
		t.Fatalf("line %d depth %d\ngot  %s\nwant %s", b.Line, b.Depth, got, want)
	}
	if live := fmt.Sprint(b.Live); live != "[[items upper] [items out upper] [out upper] [text upper] [text] []]" {
		t.Fatal(live)
	}
	if inner := blockAt(t, o, 12); inner.Depth != 2 || fmt.Sprint(inner.Live) != "[[it items out upper] [it items out upper]]" {
		t.Fatalf("%+v", inner)
	}
}

func TestOutlineRefusalNotes(t *testing.T) {
	o := MakeOutline(target(t, "onboarding", "Plan", ""))
	if got := strings.Join(stmtsText(o.Blocks[0]), "; "); !strings.Contains(got, "50–50 defer [] refused defer") {
		t.Fatal(got)
	}
	o = MakeOutline(target(t, "gotoover", "F", ""))
	if got := strings.Join(stmtsText(blockAt(t, o, 7)), "; "); got != "8–8 branch [] refused goto" {
		t.Fatal(got)
	}
	body := strings.Join(stmtsText(o.Blocks[0]), "; ")
	if !strings.Contains(body, "7–9 if [] refused goto") || !strings.Contains(body, "12–13 label [] refused label done") {
		t.Fatal(body)
	}
}

func TestOutlineRefusesFunction(t *testing.T) {
	o := MakeOutline(target(t, "generic", "Sum", ""))
	if o.Refused != "Sum is generic." || o.Blocks == nil || len(o.Blocks) != 0 {
		t.Fatalf("%+v", o)
	}
	src := strings.Replace(string(readCase(t, "basic")), "// Report joins and prints.\n", "// Report joins and prints.\n//\n//go:noinline\n", 1)
	tg, err := FindFunc(loadCase(t, "basic", []byte(src)), caseFile(t, "basic"), "Report", "")
	if err != nil {
		t.Fatal(err)
	}
	if o = MakeOutline(tg); o.Refused != "Report has a //go:noinline line." {
		t.Fatalf("%q", o.Refused)
	}
}

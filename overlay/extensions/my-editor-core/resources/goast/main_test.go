package main

import (
	"os"
	"reflect"
	"strings"
	"testing"
)

func inspectFixture(t *testing.T, name string) (*File, string) {
	t.Helper()
	src, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	out, err := Inspect(name, src)
	if err != nil {
		t.Fatal(err)
	}
	return out, string(src)
}

func declNamed(t *testing.T, f *File, name string) Decl {
	t.Helper()
	for _, d := range f.Decls {
		for _, n := range d.Names {
			if n == name {
				return d
			}
		}
	}
	t.Fatalf("no declaration named %s", name)
	return Decl{}
}

func TestDeclarationsKindsAndNames(t *testing.T) {
	f, _ := inspectFixture(t, "basic.go")
	if f.Package != "shop" || len(f.Decls) != 10 {
		t.Fatalf("package %q with %d declarations", f.Package, len(f.Decls))
	}
	for i, d := range f.Decls {
		if d.ID != i {
			t.Fatalf("declaration %d has ID %d", i, d.ID)
		}
	}
	group := declNamed(t, f, "KindA")
	if group.Kind != "const" || !group.Grouped || !reflect.DeepEqual(group.Names, []string{"KindA", "KindB"}) {
		t.Fatalf("iota group: %+v", group)
	}
	blanks := f.Decls[2]
	if blanks.Kind != "var" || !reflect.DeepEqual(blanks.Names, []string{"_", "_"}) || !blanks.HasInit {
		t.Fatalf("repeated _ names: %+v", blanks)
	}
	if !declNamed(t, f, "counter").HasInit || declNamed(t, f, "cache").HasInit {
		t.Fatal("initializer facts are wrong")
	}
	if !declNamed(t, f, "init").IsInit {
		t.Fatal("init not flagged")
	}
	add := declNamed(t, f, "Add")
	if add.Kind != "method" || add.Receiver != "Cart" || add.Doc != "Add appends an item." {
		t.Fatalf("method: %+v", add)
	}
}

func TestSpansCarryDocAndTrailingComment(t *testing.T) {
	f, src := inspectFixture(t, "basic.go")
	encode := declNamed(t, f, "Encode")
	text := src[encode.Start:encode.End]
	if text != "// Encode writes v as YAML.\nfunc Encode(v any) ([]byte, error) { return yaml.Marshal(v) } // nolint" {
		t.Fatalf("span: %q", text)
	}
	if encode.Lines != 2 || !encode.Own || encode.DocText != "// Encode writes v as YAML." {
		t.Fatalf("encode: %+v", encode)
	}
	if strings.Contains(src[encode.Start:encode.End], "Detached") {
		t.Fatal("a detached comment must not join the span")
	}
	if src[f.PackageSpan[0]:f.PackageSpan[1]] != "package shop" {
		t.Fatalf("package span: %q", src[f.PackageSpan[0]:f.PackageSpan[1]])
	}
}

func TestImportsAndQualifiers(t *testing.T) {
	f, src := inspectFixture(t, "basic.go")
	if len(f.Imports) != 4 || f.Imports[2].Name != "yaml" || f.Imports[3].Path != "gopkg.in/yaml.v3/extra" {
		t.Fatalf("imports: %+v", f.Imports)
	}
	if f.Imports[0].Run != 0 || f.Imports[1].Run != 0 || f.Imports[2].Run != 1 || !f.Imports[0].Own {
		t.Fatalf("runs: %+v", f.Imports)
	}
	if src[f.Imports[3].Start:f.Imports[3].End] != "\t\"gopkg.in/yaml.v3/extra\"" {
		t.Fatalf("import span: %q", src[f.Imports[3].Start:f.Imports[3].End])
	}
	if !reflect.DeepEqual(declNamed(t, f, "Encode").Qualifiers, []string{"yaml"}) {
		t.Fatalf("Encode qualifiers: %v", declNamed(t, f, "Encode").Qualifiers)
	}
	// A local variable named fmt resolves, so only the unresolved extra counts.
	if !reflect.DeepEqual(declNamed(t, f, "shadow").Qualifiers, []string{"extra"}) {
		t.Fatalf("shadow qualifiers: %v", declNamed(t, f, "shadow").Qualifiers)
	}
}

func TestEmbedAndGenerate(t *testing.T) {
	f, _ := inspectFixture(t, "embed.go")
	if !f.Imports[0].Blank || f.Imports[0].Own {
		t.Fatalf("blank import: %+v", f.Imports[0])
	}
	if !declNamed(t, f, "hello").Embed {
		t.Fatal("an embed var separated by a blank line must still be flagged")
	}
	if !declNamed(t, f, "Colour").Generate || declNamed(t, f, "Colour").Embed {
		t.Fatalf("generate: %+v", declNamed(t, f, "Colour"))
	}
	if declNamed(t, f, "plain").Embed {
		t.Fatal("plain var flagged as embed")
	}
	if len(f.Directives) != 2 {
		t.Fatalf("directives: %+v", f.Directives)
	}
}

func TestSeparatedDirectiveAndSharedLines(t *testing.T) {
	f, _ := inspectFixture(t, "directive.go")
	if len(f.Directives) != 1 || f.Directives[0].Text != "//go:noinline" || f.Directives[0].Line != 3 {
		t.Fatalf("directives: %+v", f.Directives)
	}
	if declNamed(t, f, "slow").DocText != "" {
		t.Fatal("a directive after a blank line is not doc")
	}
	if declNamed(t, f, "a").Own || declNamed(t, f, "c").Own {
		t.Fatal("declarations sharing a line must not be own")
	}
}

func TestFileFlags(t *testing.T) {
	f, _ := inspectFixture(t, "flags_linux.go")
	if !f.BuildConstraint || !f.Cgo {
		t.Fatalf("flags: %+v", f)
	}
	g, _ := inspectFixture(t, "generated.go")
	if !g.Generated || g.BuildConstraint {
		t.Fatalf("generated: %+v", g)
	}
	crlf, err := Inspect("crlf.go", []byte("package shop\r\n\r\nfunc a() {}\r\n"))
	if err != nil || !crlf.CRLF || crlf.BOM {
		t.Fatalf("crlf: %+v %v", crlf, err)
	}
	bom, err := Inspect("bom.go", []byte("\xEF\xBB\xBFpackage shop\n"))
	if err != nil || !bom.BOM {
		t.Fatalf("bom: %+v %v", bom, err)
	}
}

func TestLongDirectiveIsNotTruncated(t *testing.T) {
	long := "//go:generate tool " + strings.Repeat("-x ", 80) + "-in $GOFILE"
	f, err := Inspect("gen.go", []byte("package shop\n\n"+long+"\n\nfunc g() {}\n"))
	if err != nil || len(f.Directives) != 1 || f.Directives[0].Text != long {
		t.Fatalf("directives: %+v %v", f.Directives, err)
	}
}

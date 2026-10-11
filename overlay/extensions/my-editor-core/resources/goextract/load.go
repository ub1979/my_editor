package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"go/ast"
	"go/build"
	"go/importer"
	"go/parser"
	"go/token"
	"go/types"
	"io"
	"os"
	"path/filepath"
)

// Listed is one package object of `go list -export -deps -json`.
type Listed struct {
	ImportPath, Dir, Name, Export  string
	GoFiles, CgoFiles, TestGoFiles []string
	ImportMap                      map[string]string
	Error                          *struct{ Err string }
}

// Loaded is the target package parsed from source and type-checked against its dependencies' export data.
type Loaded struct {
	Fset       *token.FileSet
	Files      []*ast.File
	Paths      []string
	Src        map[string][]byte
	Pkg        *types.Package
	Info       *types.Info
	Listed     Listed
	ListFile   string          // the `go list` output it was loaded from
	TestNames  map[string]bool // top-level names the package's _test.go files declare
	TestIdents map[string]bool // every identifier those files use
}

// File is the parsed file at an absolute path, or nil.
func (l *Loaded) File(path string) *ast.File {
	path = filepath.Clean(path)
	for i, p := range l.Paths {
		if p == path {
			return l.Files[i]
		}
	}
	return nil
}

// ReadList reads a `go list -json` stream: the package named pkg and every listed package's export file.
func ReadList(r io.Reader, pkg string) (Listed, map[string]string, error) {
	dec := json.NewDecoder(r)
	exports := map[string]string{}
	var target Listed
	found := false
	for {
		var p Listed
		if err := dec.Decode(&p); errors.Is(err, io.EOF) {
			break
		} else if err != nil {
			return Listed{}, nil, fmt.Errorf("reading the package list: %v", err)
		}
		if p.Export != "" {
			exports[p.ImportPath] = p.Export
		}
		if p.ImportPath == pkg {
			target, found = p, true
		}
	}
	if !found {
		return Listed{}, nil, fmt.Errorf("package %s is not in the list", pkg)
	}
	return target, exports, nil
}

// Load type-checks pkg from the list file, reading a file's bytes from overlay when it holds that absolute path.
func Load(listFile, pkg string, overlay map[string][]byte) (*Loaded, error) {
	f, err := os.Open(listFile)
	if err != nil {
		return nil, err
	}
	target, exports, err := ReadList(f, pkg)
	f.Close()
	if err != nil {
		return nil, err
	}
	if target.Error != nil {
		return nil, errors.New(target.Error.Err)
	}
	if len(target.CgoFiles) > 0 {
		return nil, errors.New("the package uses cgo, which this check cannot type-check")
	}
	l := &Loaded{Fset: token.NewFileSet(), Src: map[string][]byte{}, Listed: target, ListFile: listFile}
	for _, name := range target.GoFiles {
		path := filepath.Clean(filepath.Join(target.Dir, name))
		src, ok := overlay[path]
		if !ok {
			if src, err = os.ReadFile(path); err != nil {
				return nil, err
			}
		}
		file, err := parser.ParseFile(l.Fset, path, src, parser.ParseComments|parser.SkipObjectResolution)
		if err != nil {
			return nil, err
		}
		l.Files, l.Paths, l.Src[path] = append(l.Files, file), append(l.Paths, path), src
	}
	if err := l.check(target, exports); err != nil {
		return nil, err
	}
	if l.TestNames, l.TestIdents, err = testNames(target); err != nil {
		return nil, err
	}
	return l, nil
}

// check type-checks the parsed files, importing every dependency from its export data.
func (l *Loaded) check(target Listed, exports map[string]string) error {
	lookup := func(path string) (io.ReadCloser, error) {
		file, ok := exports[path]
		if !ok {
			return nil, fmt.Errorf("no export data for %s", path)
		}
		return os.Open(file)
	}
	var first error
	conf := types.Config{
		Importer: mappedImporter{importer.ForCompiler(l.Fset, "gc", lookup), target.ImportMap},
		Sizes:    types.SizesFor("gc", build.Default.GOARCH),
		Error: func(err error) {
			if first == nil {
				first = err
			}
		},
	}
	l.Info = &types.Info{
		Types:      map[ast.Expr]types.TypeAndValue{},
		Defs:       map[*ast.Ident]types.Object{},
		Uses:       map[*ast.Ident]types.Object{},
		Implicits:  map[ast.Node]types.Object{},
		Selections: map[*ast.SelectorExpr]*types.Selection{},
		Scopes:     map[ast.Node]*types.Scope{},
	}
	l.Pkg, _ = conf.Check(target.ImportPath, l.Fset, l.Files, l.Info)
	if first != nil {
		return fmt.Errorf("the package does not type-check: %v", first)
	}
	return nil
}

// mappedImporter resolves an import path as the package's ImportMap says (vendored packages) before importing it.
type mappedImporter struct {
	base types.Importer
	m    map[string]string
}

func (i mappedImporter) Import(path string) (*types.Package, error) {
	if mapped, ok := i.m[path]; ok {
		path = mapped
	}
	return i.base.Import(path)
}

// testNames collects the top-level names the package's own _test.go files declare (methods excluded), and every
// identifier they use.
func testNames(target Listed) (map[string]bool, map[string]bool, error) {
	names, idents := map[string]bool{}, map[string]bool{}
	fset := token.NewFileSet()
	for _, name := range target.TestGoFiles {
		file, err := parser.ParseFile(fset, filepath.Join(target.Dir, name), nil, parser.SkipObjectResolution)
		if err != nil {
			return nil, nil, err
		}
		ast.Inspect(file, func(n ast.Node) bool {
			if id, ok := n.(*ast.Ident); ok {
				idents[id.Name] = true
			}
			return true
		})
		for _, decl := range file.Decls {
			switch d := decl.(type) {
			case *ast.FuncDecl:
				if d.Recv == nil {
					names[d.Name.Name] = true
				}
			case *ast.GenDecl:
				for _, spec := range d.Specs {
					switch s := spec.(type) {
					case *ast.TypeSpec:
						names[s.Name.Name] = true
					case *ast.ValueSpec:
						for _, id := range s.Names {
							names[id.Name] = true
						}
					}
				}
			}
		}
	}
	return names, idents, nil
}

package main

import (
	"strings"
	"testing"
)

// param and output make an interface entry for the local called name.
func param(t *testing.T, tg *Target, name string, pointer bool) Param {
	return Param{Obj: localNamed(t, tg, name), Name: name, Pointer: pointer}
}

func output(t *testing.T, tg *Target, name string, chunkDeclared bool) Output {
	return Output{Obj: localNamed(t, tg, name), Name: name, ChunkDeclared: chunkDeclared}
}

// body runs Body on lines from..to with the chunk's natural-end jumps and Plumbing names.
func body(t *testing.T, tg *Target, from, to int, f Iface) (string, int, error) {
	t.Helper()
	c := chunk(t, tg, from, to)
	natural, _ := Jumps(tg, c, Shared(tg, c))
	return Body(tg, c, f, natural, func(s string) string { return Plumbing(tg, nil, s) })
}

// wantBody wants Body's text and site count.
func wantBody(t *testing.T, tg *Target, from, to int, f Iface, want string, sites int) {
	t.Helper()
	got, n, err := body(t, tg, from, to, f)
	if err != nil || got != want || n != sites {
		t.Fatalf("%d-%d: %v, %d sites\ngot  %q\nwant %q", from, to, err, n, got, want)
	}
}

func TestRewritePointerToPointer(t *testing.T) {
	tg := target(t, "ptrselector", "F", "")
	wantBody(t, tg, 14, 15, Iface{Params: []Param{param(t, tg, "p", true)}}, "\t(*p).f = 1\n\t(*p).bump()\n", 2)
}

func TestRewriteRangeArray(t *testing.T) {
	tg := target(t, "rangearrayptr", "F", "")
	f := Iface{Params: []Param{param(t, tg, "arr", true), param(t, tg, "sum", false)}, Outputs: []Output{output(t, tg, "sum", false)}}
	wantBody(t, tg, 11, 14, f, "\tfor _, v := range (*arr) {\n\t\t(*arr)[2] = 10\n\t\tsum += v\n\t}\n\treturn sum\n", 2)
}

func TestRewriteAddressOfPointer(t *testing.T) {
	tg := target(t, "addrderef", "F", "")
	wantBody(t, tg, 10, 11, Iface{Params: []Param{param(t, tg, "x", true)}}, "\tuse(x)\n\t(*x)++\n", 1)
}

func TestRewriteStructSelectorKept(t *testing.T) {
	tg := target(t, "buildercopy", "F", "")
	f := Iface{Params: []Param{param(t, tg, "words", false), param(t, tg, "a", true)}}
	wantBody(t, tg, 15, 18, f, "\tfor _, w := range words {\n\t\ta.b.WriteString(w)\n\t\ta.n++\n\t}\n", 0)
}

func TestRewriteMultiValueReturn(t *testing.T) {
	tg := target(t, "multireturn", "F", "")
	f := Iface{Params: []Param{param(t, tg, "m", false)}, Returns: true}
	wantBody(t, tg, 16, 18, f, "\tif m > 10 {\n\t\tr0, r1 := f(m)\n\t\treturn true, r0, r1\n\t}\n\treturn false, 0, nil\n", 0)
}

func TestRewriteTailKeepsReturns(t *testing.T) {
	tg := target(t, "tail", "F", "")
	f := Iface{Params: []Param{param(t, tg, "n", false)}, Tail: true}
	wantBody(t, tg, 9, 12, f, "\tif n > 100 {\n\t\treturn \"\", fmt.Errorf(\"too big: %d\", n)\n\t}\n\treturn fmt.Sprint(n), nil\n", 0)
}

const bareReturns = `func F(a int) (n int, err error) {
	n = a
	if a > 1 {
		n++
		return
	}
	n += 2
	return n, nil
}

func G(a int) (n int, err error) {
	defer func() {}()
	n = a
	if a > 1 {
		n++
		return
	}
	n += 2
	return n, nil
}
`

func TestRewriteBareReturn(t *testing.T) {
	tg := basicWith(t, "F", "", bareReturns)
	f := Iface{Params: []Param{param(t, tg, "a", false), param(t, tg, "n", false), param(t, tg, "err", false)},
		Outputs: []Output{output(t, tg, "n", false)}, Returns: true}
	wantBody(t, tg, 24, 28, f, "\tif a > 1 {\n\t\tn++\n\t\treturn 0, true, n, err\n\t}\n\tn += 2\n\treturn n, false, 0, nil\n", 0)
	g, err := FindFunc(tg.L, tg.Path, "G", "")
	if err != nil {
		t.Fatal(err)
	}
	f = Iface{Params: []Param{param(t, g, "a", false), param(t, g, "n", true), param(t, g, "err", true)}, Returns: true}
	wantBody(t, g, 35, 39, f, "\tif a > 1 {\n\t\t(*n)++\n\t\treturn true, (*n), (*err)\n\t}\n\t(*n) += 2\n\treturn false, 0, nil\n", 2)
}

func TestRewriteBreakToNaturalEnd(t *testing.T) {
	tg := target(t, "breakswitch", "F", "")
	f := Iface{Params: []Param{param(t, tg, "c", false)}, Outputs: []Output{output(t, tg, "x", false)}, Named: true}
	f.Outputs[0].Named = true
	wantBody(t, tg, 9, 13, f, "\tx = 1\n\tif c {\n\t\treturn x\n\t}\n\tx = 2\n\treturn x\n", 0)
}

func TestRewriteDedentOutsideRawStrings(t *testing.T) {
	tg := target(t, "rawstring", "F", "")
	f := Iface{Params: []Param{param(t, tg, "total", false), param(t, tg, "reallyLongNameHere", false)},
		Outputs: []Output{output(t, tg, "q", false), output(t, tg, "total", false)}, Named: true}
	f.Outputs[0].Named = true
	lines := strings.SplitAfter(string(tg.Src), "\n")[11:20]
	var want strings.Builder
	for i, line := range lines {
		if i+12 != 15 && i+12 != 16 {
			line = strings.TrimPrefix(line, "\t")
		}
		want.WriteString(line)
	}
	want.WriteString("\treturn q, total\n")
	if !strings.Contains(want.String(), "\n\tFROM t\n\t\tWHERE b`\n") || !strings.Contains(want.String(), "\n\t   comment */\n") {
		t.Fatalf("unexpected case text %q", want.String())
	}
	wantBody(t, tg, 12, 20, f, want.String(), 0)
}

const undeclaredOutput = `func H(bad bool) (int, error) {
	errX := fmt.Errorf("x")
	if bad {
		return 0, errX
	}
	y := 2
	return y, nil
}

func K(c bool) (int, error) {
	x := 1
	if c {
		x := 2
		return x, nil
	}
	x++
	return x, nil
}

func L(c bool, k int) int {
	x := 1
	switch k {
	case 1:
		x = 2
		if c {
			x := 3
			_ = x
			break
		}
		x++
	}
	return x
}
`

func TestRewriteZeroForUndeclaredOutput(t *testing.T) {
	tg := basicWith(t, "H", "", undeclaredOutput)
	f := Iface{Params: []Param{param(t, tg, "bad", false), param(t, tg, "errX", false)}, Outputs: []Output{output(t, tg, "y", true)}, Returns: true}
	wantBody(t, tg, 24, 27, f, "\tif bad {\n\t\treturn 0, true, 0, errX\n\t}\n\ty := 2\n\treturn y, false, 0, nil\n", 0)
}

func TestRewriteShadowedOutput(t *testing.T) {
	// At an early return of the function the outputs are dead: zero values, whatever x means there.
	tg := basicWith(t, "K", "", undeclaredOutput)
	f := Iface{Params: []Param{param(t, tg, "c", false), param(t, tg, "x", false)}, Outputs: []Output{output(t, tg, "x", false)}, Returns: true}
	wantBody(t, tg, 33, 37, f, "\tif c {\n\t\tx := 2\n\t\treturn 0, true, x, nil\n\t}\n\tx++\n\treturn x, false, 0, nil\n", 0)
	// At a jump to the natural end the output is live, so x must still mean it.
	l, err := FindFunc(tg.L, tg.Path, "L", "")
	if err != nil {
		t.Fatal(err)
	}
	f = Iface{Params: []Param{param(t, l, "c", false), param(t, l, "x", false)}, Outputs: []Output{output(t, l, "x", false)}}
	if _, _, err := body(t, l, 45, 51, f); err == nil || err.Error() != "x is shadowed at line 47." {
		t.Fatal(err)
	}
}

func TestRewriteZeroWhereWritten(t *testing.T) {
	wantBuildProblems(t, target(t, "zeroshadow", "F", ""), "g", 13, 17, "g: T is shadowed at line 16.")
}

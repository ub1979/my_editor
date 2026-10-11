package main

import "testing"

// callBlock decides lines from..to as helper name and writes its call block with Plumbing names.
func callBlock(t *testing.T, tg *Target, from, to int, name string) string {
	t.Helper()
	c := chunk(t, tg, from, to)
	f, _, problems := Decide(tg, c, name)
	if len(problems) > 0 {
		t.Fatal(problems)
	}
	text, err := CallBlock(tg, c, f, func(s string) string { return Plumbing(tg, nil, s) })
	if err != nil {
		t.Fatal(err)
	}
	return text
}

func TestCallBlockForms(t *testing.T) {
	cases := []struct {
		name, fn, recv string
		from, to       int
		helper, want   string
	}{
		{"onboarding", "Plan", "", 38, 46, "queryRows", "\trows, err := queryRows(ctx, staleAfter, tx, req, imageRef)\n"},
		{"valuepath", "F", "", 22, 24, "setFields", "\tcfg, arr, x = setFields(cfg, arr, i, x)\n"},
		{"deferrecover", "F", "", 14, 17, "advance", "\tadvance(&n, bad)\n"},
		{"multireturn", "F", "", 16, 18, "early", "\tif done, r0, r1 := early(m); done {\n\t\treturn r0, r1\n\t}\n"},
		{"tail", "F", "", 9, 12, "finish", "\treturn finish(n)\n"},
		{"tailvoid", "G", "", 10, 13, "finishG", "\tfinishG(n, out)\n"},
		{"methodset", "Run", "S", 22, 23, "addRows", "\ttotal = s.addRows(total)\n"},
		{"basic", "Report", "", 11, 14, "collectItems", "\tout := collectItems(items)\n"},
		{"breakswitch", "F", "", 9, 13, "pickOne", "\t\tx = pickOne(c)\n"},
	}
	for _, c := range cases {
		if got := callBlock(t, target(t, c.name, c.fn, c.recv), c.from, c.to, c.helper); got != c.want {
			t.Errorf("%s:\ngot  %q\nwant %q", c.name, got, c.want)
		}
	}
}

func TestCallBlockVarLines(t *testing.T) {
	tg := basicWith(t, "V", "", `func V(c bool) (int, error) {
	var err error
	if c {
		if err != nil {
			return 0, err
		}
		y := 2
		err = fmt.Errorf("y")
		if err != nil {
			return y, err
		}
	}
	return 0, err
}
`)
	want := "\t\tvar y int\n\t\tvar done bool\n\t\tvar r0 int\n\t\tvar r1 error\n\t\ty, err, done, r0, r1 = h(err)\n" +
		"\t\tif done {\n\t\t\treturn r0, r1\n\t\t}\n"
	if got := callBlock(t, tg, 25, 29, "h"); got != want {
		t.Fatalf("\ngot  %q\nwant %q", got, want)
	}
}

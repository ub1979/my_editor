package main

import "testing"

func TestCheckRefusesDefer(t *testing.T) {
	// The deferred append would run when h returns, before "b".
	after := "package pdefer\n\nvar log []string\n\n// F logs.\nfunc F() {\n\tlog = append(log, \"a\")\n\th()\n\tlog = append(log, \"b\")\n}\n\n" +
		"// h is part of F, extracted by my_editor.\nfunc h() {\n\tdefer func() { log = append(log, \"d\") }()\n}\n"
	wantProblem(t, checkAfter(t, "pdefer", "F", "", after, fact("h", 8, 8)), "h: the chunk defers at line 8.")
}

func TestCheckRefusesRecover(t *testing.T) {
	// F is deferred; h is not, so its recover() returns nil and the panic goes on.
	after := "package precover\n\nvar got any\n\n// F recovers when deferred.\nfunc F() {\n\tgot = \"start\"\n\th()\n}\n\n" +
		"// h is part of F, extracted by my_editor.\nfunc h() {\n\tgot = recover()\n}\n"
	wantProblem(t, checkAfter(t, "precover", "F", "", after, fact("h", 8, 8)), "h: the chunk calls recover at line 8.")
}

func TestCheckRefusesGoWithOuterLocal(t *testing.T) {
	extra := "func use(ch chan int, n int) { ch <- n }\n\n// G sends.\nfunc G(n int, ch chan int) {\n\tn++\n\tgo use(ch, n)\n}\n"
	before := append(readCase(t, "basic"), "\n"+extra...)
	after := string(before[:len(before)-len("\tgo use(ch, n)\n}\n")]) + "\th(ch, n)\n}\n\n// h is part of G, extracted by my_editor.\n" +
		"func h(ch chan int, n int) {\n\tgo use(ch, n)\n}\n"
	list, pkg := listCase(t, "basic")
	problems := Check(list, pkg, caseFile(t, "basic"), "G", "", before, []byte(after), BuildResult{Helpers: []HelperFact{fact("h", 27, 27)}})
	wantProblem(t, problems, "h: the go statement at line 27 uses G's ch.")
}

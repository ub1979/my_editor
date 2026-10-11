package promoname

import "testing"

func TestPin(t *testing.T) {
	if (&S{}).Run() != 2 || Asserts() || (Outer{S: &S{}}).tally() != 1 {
		t.Fatal("changed")
	}
	_ = struct{ probed int }{}
}

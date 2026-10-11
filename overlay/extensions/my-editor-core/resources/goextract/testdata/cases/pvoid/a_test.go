package pvoid

import "testing"

func TestPin(t *testing.T) {
	out = nil
	F(1)
	if len(out) != 1 {
		t.Fatal(out)
	}
}

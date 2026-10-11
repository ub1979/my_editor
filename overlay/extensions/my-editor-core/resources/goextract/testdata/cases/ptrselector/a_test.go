package ptrselector

import "testing"

func TestPin(t *testing.T) {
	if F() != 2 {
		t.Fatal(F())
	}
}

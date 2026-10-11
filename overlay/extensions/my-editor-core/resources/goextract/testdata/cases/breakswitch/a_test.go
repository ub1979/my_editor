package breakswitch

import "testing"

func TestPin(t *testing.T) {
	if F(1, true) != 1 || F(1, false) != 2 || F(2, false) != 20 || F(3, false) != 0 {
		t.Fatal(F(1, true), F(1, false), F(2, false), F(3, false))
	}
}

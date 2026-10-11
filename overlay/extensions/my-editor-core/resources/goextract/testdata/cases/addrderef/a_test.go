package addrderef

import "testing"

func TestPin(t *testing.T) {
	if F() != 7 {
		t.Fatal(F())
	}
}

package pmax

import "testing"

func TestPin(t *testing.T) {
	if G(1, 5) != 5 {
		t.Fatal(G(1, 5))
	}
}

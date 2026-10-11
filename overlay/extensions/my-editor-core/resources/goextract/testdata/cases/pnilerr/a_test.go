package pnilerr

import "testing"

func TestPin(t *testing.T) {
	if F(-5) != "ok" {
		t.Fatal(F(-5))
	}
}

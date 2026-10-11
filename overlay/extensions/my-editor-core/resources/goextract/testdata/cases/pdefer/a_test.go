package pdefer

import "testing"

func TestPin(t *testing.T) {
	log = nil
	F()
	if len(log) != 3 || log[1] != "b" {
		t.Fatal(log)
	}
}

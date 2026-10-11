package poverlap

import "testing"

func TestPin(t *testing.T) {
	log = nil
	F()
	if len(log) != 3 {
		t.Fatal(log)
	}
}

package precover

import "testing"

func TestPin(t *testing.T) {
	func() {
		defer F()
		panic("x")
	}()
	if got != "x" {
		t.Fatal(got)
	}
}

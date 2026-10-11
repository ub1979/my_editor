package names

import "testing"

func takenInTests() {}

func TestPin(t *testing.T) {
	if F(1) != 6 {
		t.Fatal(F(1))
	}
}

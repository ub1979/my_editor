package rangearrayptr

import "testing"

func TestPin(t *testing.T) {
	if F() != 16 {
		t.Fatal(F())
	}
}

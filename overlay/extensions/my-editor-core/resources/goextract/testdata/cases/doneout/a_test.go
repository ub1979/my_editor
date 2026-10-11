package doneout

import "testing"

func TestPin(t *testing.T) {
	if x, err := F(1); x != 0 || err == nil || err.Error() != "odd" {
		t.Fatal(x, err)
	}
	if x, err := F(2); x != 18 || err != nil {
		t.Fatal(x, err)
	}
	if x, err := F(50); x != 0 || err == nil || err.Error() != "too big" {
		t.Fatal(x, err)
	}
}

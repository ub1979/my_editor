package deferrecover

import "testing"

func TestPin(t *testing.T) {
	if n, err := F(false); n != 3 || err != nil {
		t.Fatalf("F(false) = %d, %v", n, err)
	}
	if n, err := F(true); n != 2 || err == nil || err.Error() != "recovered at n=2: boom" {
		t.Fatalf("F(true) = %d, %v", n, err)
	}
}

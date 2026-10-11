package multireturn

import "testing"

func TestPin(t *testing.T) {
	if v, err := F(20); v != 42 || err != nil {
		t.Fatalf("F(20) = %d, %v", v, err)
	}
	if v, err := F(1); v != 3 || err != nil {
		t.Fatalf("F(1) = %d, %v", v, err)
	}
}

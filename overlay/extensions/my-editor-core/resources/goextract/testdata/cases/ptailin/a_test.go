package ptailin

import "testing"

func TestPin(t *testing.T) {
	if v, err := F(3); v != 7 || err != nil {
		t.Fatal(v, err)
	}
}

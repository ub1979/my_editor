package buildercopy

import "testing"

func TestPin(t *testing.T) {
	if got := F([]string{"a", "b"}); got != "<ab>" {
		t.Fatalf("F = %q", got)
	}
}

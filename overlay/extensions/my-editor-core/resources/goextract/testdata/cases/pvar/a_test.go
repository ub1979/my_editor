package pvar

import "testing"

func TestPin(t *testing.T) {
	if F([]int{1, 2}) != 3 {
		t.Fatal(F([]int{1, 2}))
	}
}

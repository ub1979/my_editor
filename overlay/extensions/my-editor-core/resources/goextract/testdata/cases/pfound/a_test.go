package pfound

import "testing"

func TestPin(t *testing.T) {
	if F([]int{1, 3}) != 1 || F([]int{1}) != 0 {
		t.Fatal(F([]int{1, 3}), F([]int{1}))
	}
}

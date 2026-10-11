package ptailin

import "errors"

// F doubles.
func F(n int) (int, error) {
	n *= 2
	if n > 100 {
		return 0, errors.New("big")
	}
	return n + 1, nil
}

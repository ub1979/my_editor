// Package tail: a chunk that is the tail of the body becomes `return h(…)` (★ tail chunk).
package tail

import "fmt"

// F ends in its chunk.
func F(n int) (string, error) {
	n *= 2
	if n > 100 {
		return "", fmt.Errorf("too big: %d", n)
	}
	return fmt.Sprint(n), nil
}

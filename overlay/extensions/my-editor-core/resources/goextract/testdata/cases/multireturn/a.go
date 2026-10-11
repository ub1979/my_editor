// Package multireturn: `return f()` with a multi-value f inside a chunk (★).
package multireturn

import "errors"

func f(n int) (int, error) {
	if n < 0 {
		return 0, errors.New("negative")
	}
	return n * 2, nil
}

// F returns early through f.
func F(n int) (int, error) {
	m := n + 1
	if m > 10 {
		return f(m)
	}
	m++
	return m, nil
}

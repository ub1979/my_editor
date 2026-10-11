// Package deadwrite: an outer local the chunk writes but nobody reads afterwards is passed in, so the helper compiles.
package deadwrite

import "errors"

func f() (int, error) { return 1, errors.New("f") }

// F ignores the second error.
func F() int {
	n, err := f()
	if err != nil {
		n++
	}
	m, err := f()
	n += m
	return n
}

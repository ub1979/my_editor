// Package ptrdefine: a pointer-passed variable on the left of := cannot be rewritten to (*err) and is refused.
package ptrdefine

import "errors"

func f() (int, error) { return 1, errors.New("f") }

// F has a deferred closure over err.
func F() (n int, err error) {
	defer func() {
		if err != nil {
			n = -1
		}
	}()
	m, err := f()
	n = m
	return n, err
}

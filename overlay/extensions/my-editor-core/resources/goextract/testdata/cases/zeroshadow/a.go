// Package zeroshadow: a zero value is written where its return is, and a local declared before that may shadow the
// name of its type.
package zeroshadow

import "errors"

// T is a result.
type T struct{ v int }

// F shadows T after an early return.
func F(n int) (T, error) {
	t := T{1}
	if n > 2 {
		return t, errors.New("big")
	}
	T := 5
	t.v += T
	return t, nil
}

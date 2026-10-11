// Package deferrecover: named results, a defer with recover, and a chunk that may panic (★).
package deferrecover

import "fmt"

// F sets n in steps; a panic in the middle is recovered into err with n as it was.
func F(bad bool) (n int, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("recovered at n=%d: %v", n, r)
		}
	}()
	n = 1
	n = 2
	if bad {
		panic("boom")
	}
	n = 3
	return n, nil
}

// Package gotoover: a goto before the call to a label after it would jump over the call block's declarations.
package gotoover

// F skips ahead.
func F(skip bool) int {
	x := 0
	if skip {
		goto done
	}
	x = 1
	x++
done:
	return x
}

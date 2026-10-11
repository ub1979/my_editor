// Package doneout: at an early return of the function the outputs are dead, so the helper returns their zero values
// there, whatever their names mean at that return.
package doneout

import "errors"

func step(n int) (int, error) {
	if n > 100 {
		return 0, errors.New("too big")
	}
	return n * 3, nil
}

func check(n int) error {
	if n%2 == 1 {
		return errors.New("odd")
	}
	return nil
}

// F steps twice, checking in between.
func F(n int) (int, error) {
	x, err := step(n)
	if err := check(x); err != nil {
		return 0, err
	}
	x, err = step(x)
	if err != nil {
		return 0, err
	}
	return x, nil
}

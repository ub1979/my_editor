// Package generic: generic functions are out of scope.
package generic

// Sum adds.
func Sum[T int | float64](xs []T) T {
	var s T
	for _, x := range xs {
		s += x
	}
	return s
}

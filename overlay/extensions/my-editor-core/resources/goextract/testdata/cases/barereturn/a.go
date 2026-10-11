// Package barereturn: a bare return after the chunk reads every named result.
package barereturn

// F returns n through a bare return.
func F() (n int) {
	n = 7
	return
}

// G returns n through bare returns inside and after a loop.
func G(xs []int) (n int) {
	for _, x := range xs {
		if x < 0 {
			return
		}
		n = x
	}
	return
}

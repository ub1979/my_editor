// Package addrderef: &x of a pointer-passed x is written x, never &(*x) (★).
package addrderef

func use(p *int) { *p += 5 }

// F shares x with a closure, so x goes by pointer.
func F() int {
	x := 1
	get := func() int { return x }
	use(&x)
	x++
	return get()
}

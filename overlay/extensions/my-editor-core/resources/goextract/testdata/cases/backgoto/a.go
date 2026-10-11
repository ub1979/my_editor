// Package backgoto: a goto after the chunk back to a label before it is a loop around the chunk.
package backgoto

// F loops with goto; the x the chunk writes is read on the next pass.
func F() int {
	x := 0
	n := 0
L:
	if n > 0 {
		return x
	}
	n++
	x = 5
	goto L
}

// G takes x's address after the chunk, inside the goto loop.
func G() int {
	x := 0
	var p *int
	n := 0
L:
	if n > 1 {
		return *p
	}
	x = n + 10
	p = &x
	n++
	goto L
}

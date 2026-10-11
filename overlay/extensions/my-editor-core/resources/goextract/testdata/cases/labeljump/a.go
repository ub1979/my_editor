// Package labeljump: a labeled jump that becomes the helper's return must not be its label's only use.
package labeljump

// F skips 2 with a labeled continue.
func F(n int) int {
	total := 0
outer:
	for i := 0; i < n; i++ {
		if i == 2 {
			continue outer
		}
		total += i
	}
	return total
}

// G leaves a labeled switch, whose label another case uses too.
func G(n int) int {
	total := 0
sw:
	switch {
	case n > 0:
		if n > 5 {
			break sw
		}
		total = n * 2
	case n < -5:
		break sw
	}
	return total
}

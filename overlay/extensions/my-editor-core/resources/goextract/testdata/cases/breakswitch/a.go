// Package breakswitch: a break to the switch is the chunk's natural end only when the chunk ends its case (★).
package breakswitch

// F picks a value per kind.
func F(k int, c bool) int {
	x := 0
	switch k {
	case 1:
		x = 1
		if c {
			break
		}
		x = 2
	case 2:
		x = 20
	}
	return x
}

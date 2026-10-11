package pmax

// G picks.
func G(c, a int) int { return max(c, a) }

// F doubles.
func F(c, a int) int {
	c *= 2
	return c + a
}

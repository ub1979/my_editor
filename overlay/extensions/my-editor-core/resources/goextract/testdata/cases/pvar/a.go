package pvar

// F sums.
func F(xs []int) int {
	var total int
	for _, x := range xs {
		total += x
	}
	return total
}

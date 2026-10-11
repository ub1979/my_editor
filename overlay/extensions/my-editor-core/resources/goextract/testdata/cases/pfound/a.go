package pfound

// F looks for 3.
func F(xs []int) int {
	n := 0
	found := false
	for _, x := range xs {
		if x == 3 {
			found = true
		}
	}
	if found {
		n = 1
	}
	return n
}

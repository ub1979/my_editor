// Package loopdecl: a variable the chunk declares in a loop body is not read after the chunk just because the loop
// runs the chunk again.
package loopdecl

// F doubles and sums.
func F(n int) int {
	total := 0
	for i := 0; i < n; i++ {
		v := i * 2
		total += v
	}
	return total
}

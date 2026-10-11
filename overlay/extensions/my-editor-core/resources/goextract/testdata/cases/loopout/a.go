// Package loopout: inside a loop, a variable the chunk assigns is an output when the loop reads it earlier.
package loopout

// F carries prev across iterations.
func F(xs []int) int {
	prev := 0
	sum := 0
	for _, x := range xs {
		sum += prev
		prev = x * 2
		sum++
	}
	return sum
}

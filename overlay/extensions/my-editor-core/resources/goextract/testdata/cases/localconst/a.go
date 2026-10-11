// Package localconst: a const or type the function declares would mean the package's one of the same name in a
// helper.
package localconst

import "fmt"

const limit = 100

type item struct{ v int }

// F clamps n and counts an item's fields.
func F(n int) int {
	const limit = 5
	type item struct{ v, w int }
	k := n
	if k > limit {
		k = limit
	}
	k += len(fmt.Sprint(item{}))
	return k
}

// Package tailvoid: the tail chunk of a function without results becomes a plain call.
package tailvoid

import "fmt"

// G has no results.
func G(n int, out *[]string) {
	n++
	*out = append(*out, fmt.Sprint(n))
	if n > 3 {
		return
	}
	*out = append(*out, "small")
}

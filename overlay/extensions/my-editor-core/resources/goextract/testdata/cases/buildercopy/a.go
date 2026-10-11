// Package buildercopy: a strings.Builder inside a struct value; copying it after use panics (★).
package buildercopy

import "strings"

type acc struct {
	b strings.Builder
	n int
}

// F writes through a.b before and inside the chunk.
func F(words []string) string {
	var a acc
	a.b.WriteString("<")
	for _, w := range words {
		a.b.WriteString(w)
		a.n++
	}
	a.b.WriteString(">")
	return a.b.String()
}

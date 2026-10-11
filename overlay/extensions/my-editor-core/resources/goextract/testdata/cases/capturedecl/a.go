// Package capturedecl: a chunk-declared variable used after the chunk and captured inside it is refused (★).
package capturedecl

// F counts with a closure.
func F() int {
	start := 1
	v := start
	inc := func() { v++ }
	inc()
	return v
}

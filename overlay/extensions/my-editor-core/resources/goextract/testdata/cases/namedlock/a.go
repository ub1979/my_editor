// Package namedlock: a named non-struct type whose pointer has Lock and Unlock must not be copied.
package namedlock

type spin int32

func (s *spin) Lock() {}

func (s *spin) Unlock() {}

// F locks and counts.
func F() int {
	var mu spin
	n := 0
	mu.Lock()
	n++
	mu.Unlock()
	return n
}

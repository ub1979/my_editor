// Package typeswitch: a type switch's clause variable can be shared.
package typeswitch

// F writes t through a pointer taken before the chunk.
func F(x any) int {
	switch t := x.(type) {
	case int:
		p := &t
		t = 5
		return *p
	}
	return 0
}

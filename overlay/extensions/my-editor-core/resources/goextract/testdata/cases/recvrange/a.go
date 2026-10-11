// Package recvrange: a range with = must not assign a pointer receiver.
package recvrange

// S is a node.
type S struct{ n int }

func use(*S) {}

// Last walks xs through the receiver variable.
func (s *S) Last(xs []*S) int {
	for _, s = range xs {
		use(s)
	}
	return s.n
}

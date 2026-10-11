// Package promoname: a helper method named like a method promoted into another type, or asserted through an
// anonymous interface, would take those calls over.
package promoname

// X has tally.
type X struct{}

func (X) tally() int { return 1 }

// Deep promotes tally.
type Deep struct{ X }

// S is the receiver.
type S struct{ n int }

// Outer embeds both; o.tally() is Deep's while S has no tally.
type Outer struct {
	*S
	Deep
}

// Run doubles.
func (s *S) Run() int {
	s.n++
	s.n *= 2
	return s.n
}

// Asserts reports whether *S has a count method.
func Asserts() bool {
	var v any = &S{}
	_, ok := v.(interface{ count() })
	return ok
}

// Package methodset: a helper name must not be a field or method of the receiver, promoted ones included,
// nor a method of an interface in the package (★ method-set shadowing names).
package methodset

// Base has a method S gets by embedding.
type Base struct{ rows int }

func (Base) loadRows() int { return 1 }

// Saver is satisfied by types with saveAll.
type Saver interface{ saveAll() }

// S embeds Base.
type S struct {
	Base
	count int
}

// Run sums.
func (s *S) Run() int {
	total := s.rows
	total += s.loadRows()
	s.count = total
	return total
}

// Package ptrselector: a pointer variable that is itself shared goes as **T; its selectors need (*p) (★ **T selector).
package ptrselector

type T struct{ f int }

func (t *T) bump() { t.f++ }

func keep(pp **T) {}

// F changes p's target.
func F() int {
	p := &T{}
	keep(&p)
	p.f = 1
	p.bump()
	return p.f
}

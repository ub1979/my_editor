// Package deadname: a chunk declaration must not share a name with a dead outer local the helper takes as a parameter.
package deadname

type myErr struct{}

func (*myErr) Error() string { return "" }

func use(...any) {}

// F shadows err inside the if; err != nil holds for the typed nil.
func F(c bool) error {
	var err error
	_ = err
	if c {
		err = nil
		x, err := 1, (*myErr)(nil)
		use(x, err != nil)
	}
	return nil
}

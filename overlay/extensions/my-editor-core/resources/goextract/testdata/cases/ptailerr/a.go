package ptailerr

// E is an error.
type E struct{}

func (*E) Error() string { return "e" }

// F checks.
func F(n int) error {
	n++
	if n > 5 {
		return &E{}
	}
	return nil
}

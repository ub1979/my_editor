package pnilerr

// E is an error.
type E struct{}

func (*E) Error() string { return "e" }

func find(n int) *E {
	if n > 0 {
		return &E{}
	}
	return nil
}

// F finds.
func F(n int) string {
	n++
	e := find(n)
	if e != nil {
		return "err"
	}
	return "ok"
}

// Package shadowerr: the chunk reads the outer err, then declares its own err in the same block (★ var err shadowing).
package shadowerr

import "errors"

func a() error { return errors.New("a") }
func b() error { return nil }

// F reports which error it saw.
func F(x bool) string {
	err := a()
	out := ""
	if x {
		if err != nil {
			out = "outer"
		}
		var err = b()
		if err == nil {
			out += "+inner"
		}
	}
	return out
}

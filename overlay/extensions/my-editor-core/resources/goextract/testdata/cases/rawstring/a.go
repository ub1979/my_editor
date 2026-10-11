// Package rawstring: a nested chunk with a multi-line raw string, a block comment and aligned trailing comments (★).
package rawstring

import "fmt"

// F builds a query.
func F(n int) string {
	total := 0
	q := ""
	if n > 0 {
		reallyLongNameHere := 3 // outside neighbor
		x := 1                  // short
		longer := 2             // aligned with x
		q = `SELECT a
	FROM t
		WHERE b`
		total += x + longer + len(q) + reallyLongNameHere
		/* a block
		   comment */
		fmt.Println(total)
	}
	return fmt.Sprint(total, q)
}

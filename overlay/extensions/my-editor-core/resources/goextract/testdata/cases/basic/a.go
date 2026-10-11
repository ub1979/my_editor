// Package basic is the smallest case: one function, two chunks.
package basic

import (
	"fmt"
	"strings"
)

// Report joins and prints.
func Report(items []string, upper bool) string {
	var out []string
	for _, it := range items {
		out = append(out, it)
	}
	text := strings.Join(out, ",")
	if upper {
		text = strings.ToUpper(text)
	}
	return fmt.Sprintf("[%s]", text)
}

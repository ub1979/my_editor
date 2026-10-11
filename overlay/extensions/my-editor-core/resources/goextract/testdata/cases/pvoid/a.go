package pvoid

var out []string

// F records.
func F(n int) {
	out = append(out, "a")
	if n > 0 {
		return
	}
	out = append(out, "b")
}

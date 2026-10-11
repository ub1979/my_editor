package pdefer

var log []string

// F logs.
func F() {
	log = append(log, "a")
	defer func() { log = append(log, "d") }()
	log = append(log, "b")
}

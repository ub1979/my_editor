package shop

import _ "embed"

//go:embed hello.txt

var hello string

// Generated below.
//
//go:generate stringer -type=Kind
type Colour int

var plain string

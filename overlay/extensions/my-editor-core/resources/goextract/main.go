//go:debug gotypesalias=1

// Command goextract outlines, extracts and checks helpers of one long Go function for my_editor's AI-ready refactors.
// It uses only the standard library, reads the package's types from `go list -export -deps -json` output, and never
// writes the files it reads.
package main

import (
	"fmt"
	"os"
)

func main() {
	fmt.Fprintln(os.Stderr, "usage: goextract outline|build|check -list FILE -pkg PATH -file FILE -func NAME [-recv TYPE] …")
	os.Exit(2)
}

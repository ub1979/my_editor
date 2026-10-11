// Package impname: a helper or plumbing name must not be an import name of a file of the package.
package impname

import done "strings"

// F trims.
func F(s string) (string, error) {
	if s == "" {
		return "", nil
	}
	return done.TrimSpace(s), nil
}

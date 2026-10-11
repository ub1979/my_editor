// Package typestr: writing types: aliases survive, a dot import, a shadowed package name, variadics, a local type.
package typestr

import (
	"errors"
	. "strings"
	tm "time"
)

// ID is an alias.
type ID = int64

// F uses each kind of type.
func F(id ID, d tm.Duration, parts ...string) (string, error) {
	b := Builder{}
	for _, p := range parts {
		b.WriteString(p)
	}
	total := id + ID(d)
	if total < 0 {
		return "", errors.New("negative")
	}
	errors := []string{b.String()}
	type local struct{ n int }
	l := local{n: len(errors)}
	return Join(errors, ",") + string(rune('0'+l.n)), nil
}

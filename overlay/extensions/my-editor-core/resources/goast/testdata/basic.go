// Package shop is a fixture for the goast helper.
package shop

import (
	"fmt"
	"strings"

	yaml "gopkg.in/yaml.v3"
	"gopkg.in/yaml.v3/extra"
)

// Kind is an enum.
type Kind int

const (
	KindA Kind = iota
	KindB
)

var (
	_ = fmt.Sprintf
	_ = strings.ToUpper
)

// counter starts at one.
var counter = 1

var cache map[string]int

func init() { cache = map[string]int{} }

// Detached note about the section below.

// Encode writes v as YAML.
func Encode(v any) ([]byte, error) { return yaml.Marshal(v) } // nolint

// Cart holds items.
type Cart[T any] struct{ items []T }

// Add appends an item.
func (c *Cart[T]) Add(item T) { c.items = append(c.items, item) }

func shadow() string {
	fmt := struct{ Sprint func(...any) string }{}
	_ = extra.Version
	return fmt.Sprint("x")
}

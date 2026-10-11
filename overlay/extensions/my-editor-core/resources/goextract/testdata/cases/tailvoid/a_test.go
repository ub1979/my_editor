package tailvoid

import (
	"reflect"
	"testing"
)

func TestPin(t *testing.T) {
	var out []string
	G(1, &out)
	G(5, &out)
	if !reflect.DeepEqual(out, []string{"2", "small", "6"}) {
		t.Fatal(out)
	}
}

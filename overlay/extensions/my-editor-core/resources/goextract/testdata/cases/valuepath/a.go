// Package valuepath: writes through field and array-index paths of values are assignments (★).
package valuepath

import "errors"

type config struct {
	Timeout int
	Name    string
}

type pair struct{ f int }

func g() (int, error) { return 7, errors.New("g") }

// F changes cfg, arr and x only through paths.
func F() (config, [3]int, pair, error) {
	cfg := config{Name: "a"}
	var arr [3]int
	var x pair
	var err error
	i := 1
	cfg.Timeout = 5
	arr[i] = 9
	x.f++
	x.f, err = g()
	return cfg, arr, x, err
}

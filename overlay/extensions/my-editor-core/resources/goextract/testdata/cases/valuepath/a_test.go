package valuepath

import "testing"

func TestPin(t *testing.T) {
	cfg, arr, x, err := F()
	if cfg.Timeout != 5 || cfg.Name != "a" || arr[1] != 9 || x.f != 7 || err == nil {
		t.Fatalf("F = %+v %v %+v %v", cfg, arr, x, err)
	}
}

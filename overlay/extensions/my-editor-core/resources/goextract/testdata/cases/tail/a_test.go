package tail

import "testing"

func TestPin(t *testing.T) {
	if s, err := F(3); s != "6" || err != nil {
		t.Fatal(s, err)
	}
	if _, err := F(60); err == nil || err.Error() != "too big: 120" {
		t.Fatal(err)
	}
}

package precover

var got any

// F recovers when deferred.
func F() {
	got = "start"
	got = recover()
}

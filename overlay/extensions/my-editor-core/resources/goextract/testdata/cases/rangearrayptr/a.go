// Package rangearrayptr: ranging over a shared array must stay a range over the array value, (*arr) (★).
package rangearrayptr

func keep(p *[3]int) {}

// F changes the array while ranging over it; the range sees the copy.
func F() int {
	arr := [3]int{1, 2, 3}
	keep(&arr)
	sum := 0
	for _, v := range arr {
		arr[2] = 10
		sum += v
	}
	return sum + arr[2]
}

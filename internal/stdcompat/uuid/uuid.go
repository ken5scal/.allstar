package uuid

import (
	"crypto/rand"
	"fmt"
)

type UUID [16]byte

func New() UUID {
	var id UUID
	if _, err := rand.Read(id[:]); err != nil {
		panic(fmt.Errorf("generate uuid: %w", err))
	}

	id[6] = (id[6] & 0x0f) | 0x40
	id[8] = (id[8] & 0x3f) | 0x80
	return id
}

func (id UUID) String() string {
	return fmt.Sprintf(
		"%08x-%04x-%04x-%04x-%012x",
		id[0:4],
		id[4:6],
		id[6:8],
		id[8:10],
		id[10:16],
	)
}

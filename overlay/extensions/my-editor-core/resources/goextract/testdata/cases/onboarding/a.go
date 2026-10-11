// Package onboarding mirrors the dialer's buildOnboardingPlanTx chunk: a long query whose rows and error flow out.
package onboarding

import (
	"context"
	"errors"
	"time"
)

// Rows is a result set.
type Rows interface {
	Next() bool
	Close()
}

// Tx runs queries.
type Tx interface {
	Query(ctx context.Context, sql string, args ...any) (Rows, error)
}

// Request is what the caller asks for.
type Request struct {
	TenantID string
	CellID   string
}

func pgInterval(d time.Duration) string { return d.String() }

func currentImage(ctx context.Context, tx Tx) (string, error) { return "img", ctx.Err() }

// Plan builds a plan.
func Plan(ctx context.Context, tx Tx, req Request, staleAfter time.Duration) (int, error) {
	imageRef, err := currentImage(ctx, tx)
	if err != nil {
		return 0, err
	}

	interval := pgInterval(staleAfter)
	rows, err := tx.Query(ctx,
		`SELECT cell_id
		   FROM cells
		  WHERE last_seen_at > now()-$1::interval
		    AND tenant_id IN ('', $2)
		    AND ($3 = '' OR cell_id = $3)
		    AND image_ref = $4`,
		interval, req.TenantID, req.CellID, imageRef)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		n++
	}
	if n == 0 {
		return 0, errors.New("no cell")
	}
	return n, nil
}

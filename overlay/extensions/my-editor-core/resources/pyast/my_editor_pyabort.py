"""The import check stops before project code runs when an invariant fails."""
class Abort(Exception):
    """Stops the real import when a check before it failed."""



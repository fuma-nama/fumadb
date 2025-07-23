For SQLite, we use unique index instead of constraint because:

1. They behave the same for foreign keys.
2. Only unique index can be added and dropped after table creation.

Otherwise, we need unique constraint because most SQL databases require unique constraint for foreign keys to work.

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row


class PostgresDatabase:
    def __init__(self, database_url: str):
        self.database_url = database_url

    @contextmanager
    def connect(self) -> Iterator[psycopg.Connection]:
        with psycopg.connect(self.database_url, row_factory=dict_row) as connection:
            yield connection

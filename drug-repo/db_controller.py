from __future__ import annotations

import json
import logging
import os
import sys
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, List, Optional, Tuple

import mysql.connector  # type: ignore
from mysql.connector import MySQLConnection
from cachetools import TTLCache  # type: ignore

logger = logging.getLogger(__name__)


class ValidationError(Exception):
    pass


class DrugNotFoundError(ValidationError):
    pass


class AssemblyError(RuntimeError):
    pass


class SortOrder(Enum):
    ASC = "ASC"
    DESC = "DESC"


@dataclass
class QueryCondition:
    clause: str
    params: List[Any] = field(default_factory=list)


class SelectQuery:
    _BASE_FROM = (
        "drug_versions dv "
        "JOIN drug_master dm ON dm.version_id = dv.version_id "
        "AND dv.is_current = 1 AND COALESCE(dv.is_deleted, 0) = 0"
    )
    _BASE_COLS = [
        "dv.drug_id AS drug_id",
        "dv.version_id AS version_id",
        "dm.generic_name",
        "dm.url",
        "dm.rx_status",
        "dm.brand_names",
        "dm.source",
        "dm.doctor_id",
        "dv.version_number",
        "dv.updated_at",
        "dv.is_current",
        "dv.is_deleted",
        "dv.deleted_at",
        "dde.price AS price",
        "dde.route AS route",
        "dde.arabic_route AS arabic_route",
        "dde.arabic_trade_name AS arabic_trade_name",
        "dde.ham AS ham",
        "dde.notes AS notes",
    ]
    _SORT_ALIASES = {
        "id": "drug_id",
        "name": "brand_names",
        "trade_name": "brand_names",
        "Trade Name": "brand_names",
        "`Trade Name`": "brand_names",
        "Generic Name": "generic_name",
        "`Generic Name`": "generic_name",
    }
    _SORT_COLUMNS = {
        "drug_id": "dv.`drug_id`",
        "generic_name": "dm.`generic_name`",
        "url": "dm.`url`",
        "rx_status": "dm.`rx_status`",
        "brand_names": "dm.`brand_names`",
        "source": "dm.`source`",
        "doctor_id": "dm.`doctor_id`",
        "version_id": "dv.`version_id`",
        "version_number": "dv.`version_number`",
        "updated_at": "dv.`updated_at`",
        "is_current": "dv.`is_current`",
        "is_deleted": "dv.`is_deleted`",
        "deleted_at": "dv.`deleted_at`",
        "price": "dde.`price`",
        "dosage_form": "(SELECT MIN(ddf.form_name) FROM drug_dosage_forms ddf WHERE ddf.version_id = dv.version_id)",
    }

    def __init__(self, table: Optional[str] = None, columns: Optional[List[str]] = None):
        self._use_join = table is None or table in ("drugs", "drug_master")
        self._table = table or "drug_master"
        self._columns = columns if columns else (self._BASE_COLS if self._use_join else ["*"])
        self._conditions: List[QueryCondition] = []
        self._order_by: Optional[Tuple[str, SortOrder]] = None
        self._limit: Optional[int] = None
        self._offset: Optional[int] = None
        self._extra_joins: List[str] = []
        if self._use_join:
            self._ensure_dms_join()

    def _ensure_dms_join(self) -> None:
        join = "LEFT JOIN drug_dms_extensions dde ON dde.version_id = dv.version_id"
        if join not in self._extra_joins:
            self._extra_joins.append(join)

    def search(self, term: Optional[str] = None, fields: Optional[List[str]] = None) -> "SelectQuery":
        if not term or not term.strip():
            return self
        fields = fields or ["dm.generic_name", "dm.brand_names", "dde.arabic_trade_name"]
        pattern = f"%{term}%"
        self._conditions.append(
            QueryCondition(f"({' OR '.join(f'{field_name} LIKE %s' for field_name in fields)})", [pattern] * len(fields))
        )
        return self

    def dosage_form_filter(self, form: Optional[str] = None) -> "SelectQuery":
        if not form or not form.strip():
            return self
        self._conditions.append(
            QueryCondition(
                "EXISTS (SELECT 1 FROM drug_dosage_forms ddf "
                "WHERE ddf.version_id = dv.version_id AND ddf.form_name LIKE %s)",
                [f"%{form}%"],
            )
        )
        return self

    def source_filter(self, source: Optional[str] = None) -> "SelectQuery":
        if source:
            self._conditions.append(QueryCondition("dm.`source` = %s", [source]))
        return self

    def price_between(self, min_price: Optional[float] = None, max_price: Optional[float] = None) -> "SelectQuery":
        if min_price is None and max_price is None:
            return self
        self._ensure_dms_join()
        if min_price is not None:
            self._conditions.append(QueryCondition("dde.price >= %s", [min_price]))
        if max_price is not None:
            self._conditions.append(QueryCondition("dde.price <= %s", [max_price]))
        return self

    def route_contains(self, route: Optional[str | List[str]] = None, arabic: bool = False) -> "SelectQuery":
        if route is None:
            return self
        routes = [route] if isinstance(route, str) else route
        routes = [item for item in routes if item and item.strip()]
        if not routes:
            return self
        self._ensure_dms_join()
        column = "dde.arabic_route" if arabic else "dde.route"
        self._conditions.append(
            QueryCondition(
                f"({' OR '.join(f'{column} LIKE %s' for _ in routes)})",
                [f"%{item}%" for item in routes],
            )
        )
        return self

    def drug_id_filter(self, ids: List[int]) -> "SelectQuery":
        """
        Restrict results to a specific set of drug_ids (e.g. from Meilisearch).
        Passing an empty list produces a query that returns zero rows.
        """
        if not ids:
            self._conditions.append(QueryCondition("1 = 0"))
            return self
        placeholders = ", ".join("%s" for _ in ids)
        self._conditions.append(
            QueryCondition(f"dv.drug_id IN ({placeholders})", list(ids))
        )
        return self

    def indication_contains(self, indication: Optional[str | List[str]] = None) -> "SelectQuery":
        if indication is None:
            return self
        indications = [indication] if isinstance(indication, str) else indication
        indications = [item for item in indications if item and item.strip()]
        if not indications:
            return self
        clauses = " OR ".join("ddo.indication LIKE %s" for _ in indications)
        self._conditions.append(
            QueryCondition(
                "EXISTS (SELECT 1 FROM drug_dosing ddo "
                "WHERE ddo.version_id = dv.version_id "
                f"AND ({clauses}))",
                [f"%{item}%" for item in indications],
            )
        )
        return self

    def fda_presence_filter(self, has_fda: Optional[bool] = None) -> "SelectQuery":
        if has_fda is None:
            return self
        exists_clause = (
            "EXISTS (SELECT 1 FROM ("
            "SELECT version_id FROM drug_fda_products "
            "UNION ALL SELECT version_id FROM drug_fda_submissions "
            "UNION ALL SELECT version_id FROM drug_fda_extensions"
            ") fda WHERE fda.version_id = dv.version_id)"
        )
        self._conditions.append(QueryCondition(exists_clause if has_fda else f"NOT {exists_clause}"))
        return self

    def orderBy(self, column: str, asc: bool = True) -> "SelectQuery":
        normalized = self._SORT_ALIASES.get((column or "drug_id").strip(), (column or "drug_id").strip())
        if normalized not in self._SORT_COLUMNS:
            raise ValidationError(
                "Invalid sort_by value. "
                f"Allowed: {', '.join(sorted(self._SORT_COLUMNS))}"
            )
        if normalized == "price":
            self._ensure_dms_join()
        self._order_by = (normalized, SortOrder.ASC if asc else SortOrder.DESC)
        return self

    def limit(self, count: int) -> "SelectQuery":
        if count > 0:
            self._limit = count
        return self

    def offset(self, count: int) -> "SelectQuery":
        if count >= 0:
            self._offset = count
        return self

    def build(self, count: bool = False) -> Tuple[str, Tuple[Any, ...]]:
        from_clause = self._BASE_FROM if self._use_join else f"`{self._table}`"
        if self._use_join and self._extra_joins:
            from_clause += " " + " ".join(self._extra_joins)
        select_sql = "SELECT COUNT(DISTINCT dv.drug_id) AS total" if count and self._use_join else "SELECT COUNT(*) AS total" if count else f"SELECT {', '.join(self._columns)}"
        parts = [select_sql, f"FROM {from_clause}"]
        params: List[Any] = []
        if self._conditions:
            parts.append(f"WHERE {' AND '.join(condition.clause for condition in self._conditions)}")
            for condition in self._conditions:
                params.extend(condition.params)
        if not count and self._order_by:
            column, order = self._order_by
            parts.append(f"ORDER BY {self._SORT_COLUMNS[column]} {order.value}")
        if not count and self._limit is not None:
            parts.append("LIMIT %s")
            params.append(self._limit)
        if not count and self._offset is not None:
            parts.append("OFFSET %s")
            params.append(self._offset)
        return " ".join(parts), tuple(params)


class UnifiedDrugDatabaseController:
    _SENTINEL = object()
    _DRUG_SUB_TABLES = {
        "classes": "drug_classes",
        "dosage_forms": "drug_dosage_forms",
        "dosing": "drug_dosing",
        "adverse_effects": "drug_adverse_effects",
        "warnings": "drug_warnings",
        "interactions": "drug_interactions",
        "pregnancy": "drug_pregnancy",
        "pharmacology": "drug_pharmacology",
        "administration": "drug_administration",
        "suggested_dosing": "drug_suggested_dosing",
        "suggested_uses": "drug_suggested_uses",
        "nutrition": "drug_nutrition",
        "subcategory_listing": "drug_subcategory_listing",
        "drug_dms_extensions": "drug_dms_extensions",
        "fda_ids": "drug_fda_ids",
        "fda_products": "drug_fda_products",
        "fda_submissions": "drug_fda_submissions",
        "fda_extensions": "drug_fda_extensions",
        "fda_payload_hashes": "drug_fda_payload_hashes",
    }
    _SUB_ROW_SYSTEM_FIELDS = {"id", "version_id", "drug_id"}
    _MASTER_COL_MAP = {
        "drug_id": "drug_id",
        "generic_name": "generic_name",
        "url": "url",
        "rx_status": "rx_status",
        "brand_names": "brand_names",
        "source": "source",
        "doctor_id": "doctor_id",
        "drug_name": "generic_name",
        "name": "generic_name",
        "trade_name": "generic_name",
    }
    _FLAT_DMS_EXTENSION_MAP = {
        "ham": "ham",
        "price": "price",
        "route": "route",
        "arabic_route": "arabic_route",
        "arabic_trade_name": "arabic_trade_name",
        "notes": "notes",
        "note_raw": "notes",
    }

    def __init__(
        self,
        host: Optional[str] = None,
        port: Optional[int] = None,
        user: Optional[str] = None,
        password: Optional[str] = None,
        database: Optional[str] = None,
        chunks_dir: Optional[str] = None,
        db_path: Optional[str] = None,
        assemble_to: Optional[str] = None,
        verify_chunks: bool = True,
        force_reassemble: bool = False,
        cache_maxsize: Optional[int] = None,
        cache_ttl: Optional[float] = None,
    ):
        if db_path or chunks_dir:
            logger.warning("db_path / chunks_dir are ignored in MySQL mode.")
        self._host = host or os.getenv("MYSQL_HOST", "localhost")
        self._port = port or int(os.getenv("MYSQL_PORT", "3306"))
        self._user = user or os.getenv("MYSQL_USER", "root")
        self._password = password or os.getenv("MYSQL_PASSWORD", "")
        self._database = database or os.getenv("MYSQL_DATABASE", "unified_drugs")
        self._connect_retries = int(os.getenv("MYSQL_CONNECT_RETRIES", "30"))
        self._connect_retry_delay = float(os.getenv("MYSQL_CONNECT_RETRY_DELAY", "2"))
        self._conn: Optional[MySQLConnection] = None
        self._active_sub_tables: Optional[dict[str, str]] = None
        self._table_columns: dict[str, List[str]] = {}
        self._master_columns: List[str] = []
        self._master_data_columns: List[str] = []
        self._versioned_main_columns: List[str] = []

        _maxsize = cache_maxsize if cache_maxsize is not None else int(os.getenv("CACHE_MAXSIZE", "500"))
        _ttl     = cache_ttl     if cache_ttl     is not None else float(os.getenv("CACHE_TTL_SECONDS", "600"))
        self._cache_maxsize = _maxsize
        self._cache_ttl     = _ttl
        # TTLCache: LRU eviction when full, TTL expiry per entry.
        # TTL is reset on every write — _cached_current_snapshot re-inserts on
        # read so that actively-used drugs stay warm indefinitely.
        self._json_cache: TTLCache = TTLCache(maxsize=_maxsize, ttl=_ttl)
        self._oneshot_snapshot_sql: Optional[str] = None
        self._stats_cache: TTLCache = TTLCache(
            maxsize=1, ttl=float(os.getenv("STATS_CACHE_TTL_SECONDS", "60"))
        )

    def _get_connection(self) -> MySQLConnection:
        if self._conn is None or not self._conn.is_connected():
            last_error: Optional[Exception] = None
            for attempt in range(1, self._connect_retries + 1):
                try:
                    self._conn = mysql.connector.connect(  # type: ignore
                        host=self._host,  # type: ignore
                        port=self._port,  # type: ignore
                        user=self._user,  # type: ignore
                        password=self._password,  # type: ignore
                        database=self._database,  # type: ignore
                        autocommit=False,  # type: ignore
                    )
                    logger.info(f"MySQL connected: {self._user}@{self._host}:{self._port}/{self._database}")
                    self._load_schema_metadata()
                    break
                except mysql.connector.Error as exc:  # type: ignore[attr-defined]
                    last_error = exc
                    if attempt >= self._connect_retries:
                        raise
                    logger.warning(
                        "MySQL connect failed (%s/%s): %s. Retrying in %ss.",
                        attempt,
                        self._connect_retries,
                        exc,
                        self._connect_retry_delay,
                    )
                    time.sleep(self._connect_retry_delay)
            if self._conn is None:
                raise last_error if last_error else RuntimeError("MySQL connection failed")
        return self._conn  # type: ignore[return-value]

    def _reset_connection(self) -> None:
        if self._conn is not None:
            try:
                if self._conn.is_connected():
                    self._conn.close()
            except Exception:
                pass
        self._conn = None

    def _is_retryable_mysql_error(self, exc: Exception) -> bool:
        if not isinstance(exc, mysql.connector.Error):  # type: ignore[attr-defined]
            return False
        errno = getattr(exc, "errno", None)
        if errno in (2006, 2013, 2055):
            return True
        text = str(exc).lower()
        return "lost connection" in text or "server has gone away" in text

    def _cursor(self):
        return self._get_connection().cursor(dictionary=True)

    def _load_schema_metadata(self) -> None:
        cur = self._cursor()
        cur.execute(
            "SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
            "WHERE TABLE_SCHEMA = %s ORDER BY TABLE_NAME, ORDINAL_POSITION",
            (self._database,),
        )
        table_columns: dict[str, List[str]] = {}
        for row in cur.fetchall(): # type:ignore
            table_columns.setdefault(row["TABLE_NAME"], []).append(row["COLUMN_NAME"])  # type: ignore[index]
        cur.close()
        self._table_columns = table_columns
        self._active_sub_tables = {
            name: table for name, table in self._DRUG_SUB_TABLES.items() if table in table_columns
        }
        self._master_columns = table_columns.get("drug_master", [])
        self._master_data_columns = [column for column in self._master_columns if column != "version_id"]
        version_columns = table_columns.get("drug_versions", [])
        self._versioned_main_columns = [
            column for column in self._master_columns if column not in ("drug_id", "version_id") and column in version_columns
        ]
        self._oneshot_snapshot_sql = None

    def _version_has_soft_delete(self) -> bool:
        return "is_deleted" in self._table_columns.get("drug_versions", [])

    def _not_deleted_condition(self, alias: str = "drug_versions") -> str:
        return f"COALESCE({alias}.is_deleted, 0) = 0"

    def _begin_transaction(self) -> MySQLConnection:
        conn = self._get_connection()
        if conn.in_transaction:  # type: ignore[attr-defined]
            conn.rollback()
        conn.start_transaction()
        return conn

    @property
    def _active(self) -> dict[str, str]:
        if self._active_sub_tables is None:
            self._get_connection()
        return self._active_sub_tables  # type: ignore[return-value]

    def _version_main_supported(self) -> bool:
        return bool(self._versioned_main_columns)

    def _normalize_payload(self, kwargs: dict[str, Any]) -> tuple[dict[str, Any], dict[str, List[dict]]]:
        payload = dict(kwargs)
        dms_rows = payload.pop("dms_extensions", self._SENTINEL)
        if dms_rows is not self._SENTINEL:
            payload["drug_dms_extensions"] = dms_rows
        flat_row: dict[str, Any] = {}
        for alias, column in self._FLAT_DMS_EXTENSION_MAP.items():
            value = payload.pop(alias, self._SENTINEL)
            if value is not self._SENTINEL:
                flat_row[column] = value
        if flat_row:
            existing = payload.get("drug_dms_extensions", self._SENTINEL)
            if existing in (self._SENTINEL, None):
                payload["drug_dms_extensions"] = [flat_row]
            elif isinstance(existing, list):
                if len(existing) > 1:
                    raise ValidationError("drug_dms_extensions accepts at most one row with flat DMS fields.")
                payload["drug_dms_extensions"] = [dict(existing[0]) | flat_row] if existing else [flat_row]
            else:
                raise ValidationError("drug_dms_extensions must be a list.")
        main_fields: dict[str, Any] = {}
        for public_name, column in self._MASTER_COL_MAP.items():
            value = payload.get(public_name, self._SENTINEL)
            if value is not self._SENTINEL and column in self._master_columns:
                main_fields[column] = value
        sub_data: dict[str, List[dict]] = {}
        for public_name in self._active:
            value = payload.get(public_name, self._SENTINEL)
            if value is self._SENTINEL or value is None:
                continue
            if not isinstance(value, list):
                raise ValidationError(f"{public_name} must be an array.")
            sub_data[public_name] = self._normalize_sub_rows(public_name, value)
        return main_fields, sub_data

    def _sub_table_data_cols(self, table: str) -> List[str]:
        return [column for column in self._table_columns.get(table, []) if column not in ("id", "version_id")]

    def _resolve_sub_col(self, table: str, key: str) -> str:
        columns = self._table_columns.get(table, [])
        if key in columns:
            return key
        for column in columns:
            if column.lower().replace(" ", "_") == key.lower():
                return column
        raise ValidationError(f"Unknown column '{key}' in '{table}'.")

    def _normalize_sub_rows(self, public_name: str, rows: List[dict]) -> List[dict[str, Any]]:
        table = self._DRUG_SUB_TABLES[public_name]
        normalized: List[dict[str, Any]] = []
        for index, row in enumerate(rows):
            if not isinstance(row, dict):
                raise ValidationError(f"{public_name}[{index}] must be an object.")
            clean_row: dict[str, Any] = {}
            for key, value in row.items():
                if key in self._SUB_ROW_SYSTEM_FIELDS or key.startswith("_"):
                    continue
                column = self._resolve_sub_col(table, key)
                if column in self._SUB_ROW_SYSTEM_FIELDS:
                    continue
                clean_row[column] = value
            if any(value is not None and (not isinstance(value, str) or value.strip()) for value in clean_row.values()):
                normalized.append(clean_row)
        return normalized

    def _batch_insert_sub(self, table: str, version_id: int, rows: List[dict[str, Any]]) -> None:
        if not rows:
            return
        data_columns = self._sub_table_data_cols(table)
        row_keys = [column for column in data_columns if any(column in row for row in rows)]
        if not row_keys:
            return
        sql_cols = ["version_id"] + row_keys
        values = [[version_id] + [row.get(key) for key in row_keys] for row in rows]
        cur = self._get_connection().cursor()
        cur.executemany(
            f"INSERT INTO `{table}` ({', '.join(f'`{column}`' for column in sql_cols)}) "
            f"VALUES ({', '.join('%s' for _ in sql_cols)})",
            values,
        )
        cur.close()

    def _delete_sub_rows(self, version_id: int, table: str) -> None:
        cur = self._get_connection().cursor()
        cur.execute(f"DELETE FROM `{table}` WHERE version_id = %s", (version_id,))
        cur.close()

    def _replace_sub_rows(self, version_id: int, public_name: str, rows: List[dict]) -> None:
        table = self._DRUG_SUB_TABLES[public_name]
        self._delete_sub_rows(version_id, table)
        if rows:
            self._batch_insert_sub(table, version_id, rows)

    def _copy_subtables(self, source_version_id: int, target_version_id: int, skip: Optional[set[str]] = None) -> None:
        skip = skip or set()
        for public_name, table in self._active.items():
            if public_name in skip:
                continue
            data_columns = self._sub_table_data_cols(table)
            if not data_columns:
                continue
            cur = self._get_connection().cursor()
            cur.execute(
                f"INSERT INTO `{table}` (version_id, {', '.join(f'`{column}`' for column in data_columns)}) "
                f"SELECT %s, {', '.join(f'`{column}`' for column in data_columns)} "
                f"FROM `{table}` WHERE version_id = %s",
                (target_version_id, source_version_id),
            )
            cur.close()

    def _get_master_row_by_version(self, version_id: int) -> Optional[dict]:
        cur = self._cursor()
        cur.execute("SELECT * FROM drug_master WHERE version_id = %s", (version_id,))
        row = cur.fetchone()
        cur.close()
        return row

    def _get_master_row(self, drug_id: int) -> Optional[dict]:
        version_id = self._current_version_id(drug_id)
        if version_id is None:
            return None
        return self._get_master_row_by_version(version_id)

    def _ensure_drug_exists(self, drug_id: int) -> dict:
        row = self._get_version_row(drug_id)
        if row is None:
            raise DrugNotFoundError(f"drug_id={drug_id} does not exist")
        return row

    def _get_version_row(
        self,
        drug_id: int,
        version_number: Optional[int] = None,
        current: bool = False,
        include_deleted: bool = False,
    ) -> Optional[dict]:
        cur = self._cursor()
        sql = "SELECT * FROM drug_versions WHERE drug_id = %s"
        params: List[Any] = [drug_id]
        if version_number is not None:
            sql += " AND version_number = %s"
            params.append(version_number)
        if not include_deleted and self._version_has_soft_delete():
            sql += " AND COALESCE(is_deleted, 0) = 0"
        if current:
            sql += " AND is_current = 1 ORDER BY version_number DESC LIMIT 1"
        elif version_number is None:
            sql += " ORDER BY version_number DESC LIMIT 1"
        cur.execute(sql, tuple(params))
        row = cur.fetchone()
        cur.close()
        return row

    def _current_version_id(self, drug_id: int) -> Optional[int]:
        row = self._get_version_row(drug_id, current=True)
        return row["version_id"] if row else None

    def _next_version_number(self, drug_id: int) -> int:
        cur = self._cursor()
        cur.execute(
            "SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version FROM drug_versions WHERE drug_id = %s",
            (drug_id,),
        )
        row = cur.fetchone()
        cur.close()
        return int(row["next_version"])  # type: ignore[index]

    def _next_drug_id(self) -> int:
        cur = self._cursor()
        cur.execute("SELECT COALESCE(MAX(drug_id), 0) + 1 AS next_drug_id FROM drug_versions")
        row = cur.fetchone()
        cur.close()
        return int(row["next_drug_id"])  # type: ignore[index]

    def _build_main_snapshot(self, master_row: dict, version_row: dict) -> dict:
        snapshot = dict(master_row)
        snapshot["drug_id"] = version_row["drug_id"]
        snapshot["version_id"] = version_row["version_id"]
        snapshot["version_number"] = version_row["version_number"]
        snapshot["updated_at"] = version_row["updated_at"]
        snapshot["is_current"] = version_row["is_current"]
        if "is_deleted" in version_row:
            snapshot["is_deleted"] = version_row["is_deleted"]
        if "deleted_at" in version_row:
            snapshot["deleted_at"] = version_row["deleted_at"]
        for column in self._versioned_main_columns:
            snapshot[column] = version_row[column]
        return snapshot

    def _get_sub_rows(self, version_id: int, table: str) -> List[dict]:
        cur = self._cursor()
        cur.execute(f"SELECT * FROM `{table}` WHERE version_id = %s", (version_id,))
        rows = cur.fetchall()
        cur.close()
        return rows  # type: ignore[return-value]

    def _assemble_snapshot(self, drug_id: int, version_row: dict, include_subtables: bool = True) -> Optional[dict]:
        master_row = self._get_master_row_by_version(version_row["version_id"])
        if master_row is None:
            return None
        snapshot = self._build_main_snapshot(master_row, version_row)
        if include_subtables:
            for public_name, table in self._active.items():
                snapshot[public_name] = self._get_sub_rows(version_row["version_id"], table)
            snapshot["has_fda"] = any(
                snapshot.get(public_name)
                for public_name in (
                    "fda_products",
                    "fda_submissions",
                    "fda_extensions",
                )
            )
        return snapshot

    def _insert_master_row(self, version_id: int, snapshot: dict[str, Any]) -> None:
        columns = [column for column in self._master_data_columns if column in snapshot]
        if not columns:
            return
        cur = self._get_connection().cursor()
        cur.execute(
            f"INSERT INTO `drug_master` (`version_id`, {', '.join(f'`{column}`' for column in columns)}) "
            f"VALUES (%s, {', '.join('%s' for _ in columns)})",
            [version_id] + [snapshot.get(column) for column in columns],
        )
        cur.close()

    def _update_master_row(self, version_id: int, snapshot: dict[str, Any]) -> None:
        if not self._master_data_columns:
            return
        cur = self._get_connection().cursor()
        cur.execute(
            f"UPDATE `drug_master` SET {', '.join(f'`{column}` = %s' for column in self._master_data_columns)} "
            "WHERE version_id = %s",
            [snapshot.get(column) for column in self._master_data_columns] + [version_id],
        )
        cur.close()

    def _insert_version_row(self, drug_id: int, version_number: int, is_current: int, snapshot: dict[str, Any]) -> int:
        columns = ["drug_id", "version_number", "updated_at", "is_current"] + self._versioned_main_columns
        placeholders = ["%s", "%s", "NOW()", "%s"] + ["%s" for _ in self._versioned_main_columns]
        params: List[Any] = [drug_id, version_number, is_current] + [snapshot.get(column) for column in self._versioned_main_columns]
        cur = self._get_connection().cursor()
        cur.execute(
            f"INSERT INTO `drug_versions` ({', '.join(f'`{column}`' for column in columns)}) "
            f"VALUES ({', '.join(placeholders)})",
            params,
        )
        version_id = int(cur.lastrowid) # type:ignore
        cur.close()
        return version_id

    def _update_version_main(self, version_id: int, snapshot: dict[str, Any]) -> None:
        if not self._versioned_main_columns:
            cur = self._get_connection().cursor()
            cur.execute("UPDATE drug_versions SET updated_at = NOW() WHERE version_id = %s", (version_id,))
            cur.close()
            return
        cur = self._get_connection().cursor()
        cur.execute(
            f"UPDATE `drug_versions` SET "
            f"{', '.join(f'`{column}` = %s' for column in self._versioned_main_columns)}, "
            "updated_at = NOW() WHERE version_id = %s",
            [snapshot.get(column) for column in self._versioned_main_columns] + [version_id],
        )
        cur.close()

    def _cache_current_snapshot(self, drug_id: int, snapshot: dict) -> None:
        self._json_cache[drug_id] = json.dumps(snapshot, ensure_ascii=False, default=str)

    def _cached_current_snapshot(self, drug_id: int) -> Optional[dict]:
        cached = self._json_cache.get(drug_id)
        if cached is None:
            return None
        # Re-insert to reset the TTL — actively-read drugs stay warm.
        self._json_cache[drug_id] = cached
        return json.loads(cached)

    def _get_or_build_current_snapshot(self, drug_id: int) -> Optional[dict]:
        snapshot = self._cached_current_snapshot(drug_id)
        if snapshot is not None:
            return snapshot
        snapshot = self._get_current_snapshot_uncached(drug_id)
        if snapshot is None:
            return None
        self._cache_current_snapshot(drug_id, snapshot)
        return self._cached_current_snapshot(drug_id)

    def _refresh_cache(self, drug_id: int) -> None:
        self._stats_cache.pop("stats", None)
        snapshot = self._get_current_snapshot_uncached(drug_id)
        if snapshot is None:
            self._json_cache.pop(drug_id, None)
            return
        self._cache_current_snapshot(drug_id, snapshot)

    def _build_oneshot_snapshot_sql(self) -> str:
        has_soft_delete = self._version_has_soft_delete()
        meta_cols = [
            "dv.`drug_id` AS `drug_id`",
            "dv.`version_id` AS `version_id`",
            "dv.`version_number` AS `version_number`",
            "dv.`updated_at` AS `updated_at`",
            "dv.`is_current` AS `is_current`",
        ]
        if has_soft_delete:
            meta_cols += ["dv.`is_deleted` AS `is_deleted`", "dv.`deleted_at` AS `deleted_at`"]
        master_cols = [f"dm.`{c}` AS `__dm_{c}`" for c in self._master_columns if c != "version_id"]
        versioned_cols = [f"dv.`{c}` AS `__dv_{c}`" for c in self._versioned_main_columns]
        sub_selects = []
        for public_name, table in self._active.items():
            cols = self._table_columns.get(table, [])
            json_pairs = ", ".join(f"'{c}', t.`{c}`" for c in cols)
            sub_selects.append(
                f"(SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT({json_pairs})), JSON_ARRAY()) "
                f"FROM `{table}` t WHERE t.version_id = dv.version_id) AS `{public_name}`"
            )
        soft = "AND COALESCE(dv.is_deleted, 0) = 0" if has_soft_delete else ""
        return (
            f"SELECT {', '.join(meta_cols + master_cols + versioned_cols + sub_selects)} "
            "FROM drug_versions dv JOIN drug_master dm ON dm.version_id = dv.version_id "
            f"WHERE dv.drug_id = %s AND dv.is_current = 1 {soft} "
            "ORDER BY dv.version_number DESC LIMIT 1"
        )

    def _get_current_snapshot_uncached(self, drug_id: int) -> Optional[dict]:
        if self._oneshot_snapshot_sql is None:
            self._get_connection()
            self._oneshot_snapshot_sql = self._build_oneshot_snapshot_sql()
        rows = self.execute_query(self._oneshot_snapshot_sql, (drug_id,))
        if not rows:
            return None
        row = rows[0]
        snapshot: dict[str, Any] = {
            "drug_id": row["drug_id"],
            "version_id": row["version_id"],
            "version_number": row["version_number"],
            "updated_at": row["updated_at"],
            "is_current": row["is_current"],
        }
        if "is_deleted" in row:
            snapshot["is_deleted"] = row["is_deleted"]
            snapshot["deleted_at"] = row["deleted_at"]
        for col in self._master_columns:
            if col != "version_id":
                snapshot[col] = row[f"__dm_{col}"]
        for col in self._versioned_main_columns:
            snapshot[col] = row[f"__dv_{col}"]
        for public_name in self._active:
            raw = row.get(public_name)
            if isinstance(raw, (bytes, bytearray)):
                raw = raw.decode("utf-8")
            snapshot[public_name] = json.loads(raw) if isinstance(raw, str) else (raw or [])
        snapshot["has_fda"] = any(
            snapshot.get(name) for name in ("fda_products", "fda_submissions", "fda_extensions")
        )
        return snapshot

    def query(self, table: Optional[str] = None, columns: Optional[List[str]] = None) -> SelectQuery:
        return SelectQuery(table=table, columns=columns)

    def execute_query(self, sql: str, params: tuple = ()) -> List[dict]:
        for attempt in range(2):
            try:
                cur = self._cursor()
                cur.execute(sql, params)
                rows = cur.fetchall()
                cur.close()
                return rows  # type: ignore[return-value]
            except Exception as exc:
                if attempt == 0 and self._is_retryable_mysql_error(exc):
                    logger.warning("Transient MySQL error during execute_query; reconnecting and retrying once: %s", exc)
                    self._reset_connection()
                    continue
                raise
        return []

    def insert_drug(self, **kwargs) -> int:
        main_fields, sub_data = self._normalize_payload(kwargs)
        if not main_fields:
            raise ValidationError("insert_drug() requires at least one main-table field.")
        conn = self._begin_transaction()
        try:
            drug_id = self._next_drug_id()
            version_id = self._insert_version_row(drug_id, 1, 1, main_fields)
            self._insert_master_row(version_id, main_fields)
            for public_name, rows in sub_data.items():
                self._batch_insert_sub(self._DRUG_SUB_TABLES[public_name], version_id, rows)
            conn.commit()
            self._refresh_cache(drug_id)
            return drug_id
        except Exception:
            conn.rollback()
            raise

    def get_drug_by_id(self, drug_id: int) -> Optional[dict]:
        return self._get_or_build_current_snapshot(drug_id)

    def get_drug_main(self, drug_id: int) -> Optional[dict]:
        snapshot = self._get_or_build_current_snapshot(drug_id)
        if snapshot is None:
            return None
        main = dict(snapshot)
        for public_name in self._active:
            main.pop(public_name, None)
        return main

    def _get_sub_table(self, drug_id: int, table: str) -> List[dict]:
        snapshot = self._get_or_build_current_snapshot(drug_id)
        if snapshot is not None:
            for public_name, mapped_table in self._active.items():
                if mapped_table == table:
                    rows = snapshot.get(public_name, [])
                    return rows if isinstance(rows, list) else []
        version_id = self._current_version_id(drug_id)
        return [] if version_id is None else self._get_sub_rows(version_id, table)

    def get_drug_dosage_forms(self, drug_id: int) -> List[dict]:
        return self._get_sub_table(drug_id, "drug_dosage_forms")

    def get_drug_classes(self, drug_id: int) -> List[dict]:
        return self._get_sub_table(drug_id, "drug_classes")

    def get_drug_dosing(self, drug_id: int) -> List[dict]:
        return self._get_sub_table(drug_id, "drug_dosing")

    def get_drug_adverse_effects(self, drug_id: int) -> List[dict]:
        return self._get_sub_table(drug_id, "drug_adverse_effects")

    def get_drug_warnings(self, drug_id: int) -> List[dict]:
        return self._get_sub_table(drug_id, "drug_warnings")

    def get_drug_interactions(self, drug_id: int) -> List[dict]:
        return self._get_sub_table(drug_id, "drug_interactions")

    def get_drug_pregnancy(self, drug_id: int) -> List[dict]:
        return self._get_sub_table(drug_id, "drug_pregnancy")

    def get_drug_pharmacology(self, drug_id: int) -> List[dict]:
        return self._get_sub_table(drug_id, "drug_pharmacology")

    def get_drug_administration(self, drug_id: int) -> List[dict]:
        return self._get_sub_table(drug_id, "drug_administration")

    def get_drug_suggested_dosing(self, drug_id: int) -> List[dict]:
        return self._get_sub_table(drug_id, "drug_suggested_dosing")

    def get_drug_suggested_uses(self, drug_id: int) -> List[dict]:
        return self._get_sub_table(drug_id, "drug_suggested_uses")

    def get_drug_nutrition(self, drug_id: int) -> List[dict]:
        return self._get_sub_table(drug_id, "drug_nutrition")

    def get_drug_subcategory_listing(self, drug_id: int) -> List[dict]:
        return self._get_sub_table(drug_id, "drug_subcategory_listing")

    def get_drug_dms_extensions(self, drug_id: int) -> List[dict]:
        return self._get_sub_table(drug_id, "drug_dms_extensions")

    def get_drug_fda_ids(self, drug_id: int) -> List[dict]:
        return self._get_sub_table(drug_id, "drug_fda_ids")

    def get_drug_fda_products(self, drug_id: int) -> List[dict]:
        return self._get_sub_table(drug_id, "drug_fda_products")

    def get_drug_fda_submissions(self, drug_id: int) -> List[dict]:
        return self._get_sub_table(drug_id, "drug_fda_submissions")

    def get_drug_fda_extensions(self, drug_id: int) -> List[dict]:
        return self._get_sub_table(drug_id, "drug_fda_extensions")

    def get_drug_fda_payload_hashes(self, drug_id: int) -> List[dict]:
        return self._get_sub_table(drug_id, "drug_fda_payload_hashes")

    def get_drug_name_components(self, drug_id: int) -> List[dict]:
        self._ensure_drug_exists(drug_id)
        return []

    def list_drug_versions(self, drug_id: int) -> List[dict]:
        self._ensure_drug_exists(drug_id)
        cur = self._cursor()
        select_cols = [
            "dv.version_id",
            "dv.version_number",
            "dv.updated_at",
            "dv.is_current",
            "COALESCE(dm.doctor_id, 0) AS doctor_id",
        ]
        where = ["dv.drug_id = %s"]
        if self._version_has_soft_delete():
            select_cols.extend(["dv.is_deleted", "dv.deleted_at"])
            where.append(self._not_deleted_condition("dv"))
        cur.execute(
            f"SELECT {', '.join(select_cols)} "
            "FROM drug_versions dv "
            "LEFT JOIN drug_master dm ON dm.version_id = dv.version_id "
            f"WHERE {' AND '.join(where)} ORDER BY dv.version_number ASC",
            (drug_id,),
        )
        rows = cur.fetchall()
        cur.close()
        return rows  # type: ignore[return-value]

    def get_drug_version(self, drug_id: int, version_number: int) -> Optional[dict]:
        row = self._get_version_row(drug_id, version_number=version_number)
        return None if row is None else self._assemble_snapshot(drug_id, row, include_subtables=True)

    def create_version(self, drug_id: int) -> int:
        self._ensure_drug_exists(drug_id)
        current_row = self._get_version_row(drug_id, current=True)
        if current_row is None:
            raise ValidationError(f"drug_id={drug_id} has no current version to clone.")
        base_snapshot = self._assemble_snapshot(drug_id, current_row, include_subtables=False)
        if base_snapshot is None:
            raise DrugNotFoundError(f"drug_id={drug_id} does not exist")
        conn = self._begin_transaction()
        try:
            new_number = self._next_version_number(drug_id)
            new_id = self._insert_version_row(drug_id, new_number, 0, base_snapshot)
            self._insert_master_row(new_id, base_snapshot)
            self._copy_subtables(current_row["version_id"], new_id)
            conn.commit()
            return new_number
        except Exception:
            conn.rollback()
            raise

    def update_version(self, drug_id: int, version_number: int, **kwargs) -> int:
        self._ensure_drug_exists(drug_id)
        row = self._get_version_row(drug_id, version_number=version_number)
        if row is None:
            raise DrugNotFoundError(f"drug_id={drug_id} version_number={version_number} does not exist")
        main_fields, sub_data = self._normalize_payload(kwargs)
        if not main_fields and not sub_data:
            raise ValidationError("update_version() called with no fields to update.")
        base_snapshot = self._assemble_snapshot(drug_id, row, include_subtables=False)
        if base_snapshot is None:
            raise DrugNotFoundError(f"drug_id={drug_id} does not exist")
        new_snapshot = dict(base_snapshot)
        new_snapshot.update(main_fields)
        conn = self._begin_transaction()
        try:
            if main_fields or sub_data:
                self._update_version_main(row["version_id"], new_snapshot)
            if main_fields:
                self._update_master_row(row["version_id"], new_snapshot)
            for public_name, rows in sub_data.items():
                self._replace_sub_rows(row["version_id"], public_name, rows)
            conn.commit()
            if row["is_current"] == 1:
                self._refresh_cache(drug_id)
            return version_number
        except Exception:
            conn.rollback()
            raise

    def promote_version(self, drug_id: int, version_number: int) -> int:
        self._ensure_drug_exists(drug_id)
        row = self._get_version_row(drug_id, version_number=version_number)
        if row is None:
            raise DrugNotFoundError(f"drug_id={drug_id} version_number={version_number} does not exist")
        conn = self._begin_transaction()
        try:
            cur = conn.cursor()
            cur.execute("UPDATE drug_versions SET is_current = 0 WHERE drug_id = %s", (drug_id,))
            cur.close()
            cur = conn.cursor()
            cur.execute(
                "UPDATE drug_versions SET is_current = 1 WHERE drug_id = %s AND version_number = %s",
                (drug_id, version_number),
            )
            cur.close()
            conn.commit()
            self._refresh_cache(drug_id)
            return version_number
        except Exception:
            conn.rollback()
            raise

    def delete_version(self, drug_id: int, version_number: int) -> dict:
        rows = self.list_drug_versions(drug_id)
        if len(rows) <= 1:
            raise ValidationError("Cannot delete the last remaining version of a drug.")
        target = next((row for row in rows if row["version_number"] == version_number), None)
        if target is None:
            raise DrugNotFoundError(f"drug_id={drug_id} version_number={version_number} does not exist")
        remaining = [row for row in rows if row["version_number"] != version_number]
        promoted = max(remaining, key=lambda item: item["version_number"]) if target["is_current"] == 1 else None
        conn = self._begin_transaction()
        try:
            cur = conn.cursor()
            cur.execute(
                "DELETE FROM drug_versions WHERE version_id = %s",
                (target["version_id"],),
            )
            cur.close()
            if promoted is not None:
                cur = conn.cursor()
                cur.execute("UPDATE drug_versions SET is_current = 0 WHERE drug_id = %s", (drug_id,))
                cur.close()
                cur = conn.cursor()
                cur.execute(
                    "UPDATE drug_versions SET is_current = 1 WHERE drug_id = %s AND version_number = %s",
                    (drug_id, promoted["version_number"]),
                )
                cur.close()
            conn.commit()
            if promoted is not None:
                self._refresh_cache(drug_id)
            return {
                "deleted_version_number": version_number,
                "current_version_number": promoted["version_number"] if promoted else None,
            }
        except Exception:
            conn.rollback()
            raise

    def update_drug(self, drug_id: int, **kwargs) -> int:
        self._ensure_drug_exists(drug_id)
        current_row = self._get_version_row(drug_id, current=True)
        main_fields, sub_data = self._normalize_payload(kwargs)
        if not main_fields and not sub_data:
            raise ValidationError("update_drug() called with no fields to update.")
        base_snapshot = self._assemble_snapshot(drug_id, current_row, include_subtables=False) if current_row else self._get_master_row(drug_id)
        if base_snapshot is None:
            raise DrugNotFoundError(f"drug_id={drug_id} does not exist")
        new_snapshot = dict(base_snapshot)
        new_snapshot.update(main_fields)
        conn = self._begin_transaction()
        try:
            if current_row is not None:
                cur = conn.cursor()
                cur.execute("UPDATE drug_versions SET is_current = 0 WHERE version_id = %s", (current_row["version_id"],))
                cur.close()
            new_number = self._next_version_number(drug_id)
            new_id = self._insert_version_row(drug_id, new_number, 1, new_snapshot)
            self._insert_master_row(new_id, new_snapshot)
            if current_row is not None:
                self._copy_subtables(current_row["version_id"], new_id, set(sub_data))
            for public_name, rows in sub_data.items():
                self._replace_sub_rows(new_id, public_name, rows)
            conn.commit()
            self._refresh_cache(drug_id)
            return drug_id
        except Exception:
            conn.rollback()
            raise

    def delete_drug(self, drug_id: int) -> bool:
        if self._get_version_row(drug_id) is None:
            return False
        conn = self._begin_transaction()
        try:
            cur = conn.cursor()
            if self._version_has_soft_delete():
                cur.execute(
                    "UPDATE drug_versions "
                    "SET is_deleted = 1, deleted_at = COALESCE(deleted_at, NOW()) "
                    "WHERE drug_id = %s AND COALESCE(is_deleted, 0) = 0",
                    (drug_id,),
                )
            else:
                cur.execute("DELETE FROM drug_versions WHERE drug_id = %s", (drug_id,))
            deleted = cur.rowcount > 0
            cur.close()
            conn.commit()
            self._json_cache.pop(drug_id, None)
            self._stats_cache.pop("stats", None)
            return deleted
        except Exception:
            conn.rollback()
            raise

    def cache_info(self) -> dict:
        """Return live cache statistics without touching the DB."""
        cache = self._json_cache
        currsize = len(cache)
        payload_bytes = sum(len(v.encode("utf-8")) for v in cache.values())
        return {
            "maxsize":       self._cache_maxsize,
            "ttl_seconds":   self._cache_ttl,
            "currsize":      currsize,
            "payload_bytes": payload_bytes,
            "payload_mb":    round(payload_bytes / (1024 * 1024), 3),
        }

    def get_stats(self) -> dict:
        cached = self._stats_cache.get("stats")
        if cached is not None:
            return dict(cached)
        stats: dict[str, Any] = {}
        version_where = (
            f" WHERE {self._not_deleted_condition('drug_versions')}"
            if self._version_has_soft_delete()
            else ""
        )
        cur = self._cursor()
        cur.execute(f"SELECT COUNT(DISTINCT drug_id) AS n FROM drug_versions{version_where}")
        stats["total_drugs"] = cur.fetchone()["n"]  # type: ignore[index]
        cur.close()
        cur = self._cursor()
        cur.execute(f"SELECT COUNT(*) AS n FROM drug_versions{version_where}")
        stats["total_versions"] = cur.fetchone()["n"]  # type: ignore[index]
        cur.close()
        for public_name, table in self._active.items():
            cur = self._cursor()
            if self._version_has_soft_delete() and "version_id" in self._table_columns.get(table, []):
                cur.execute(
                    f"SELECT COUNT(*) AS n FROM `{table}` t "
                    "JOIN drug_versions dv ON dv.version_id = t.version_id "
                    f"WHERE {self._not_deleted_condition('dv')}"
                )
            else:
                cur.execute(f"SELECT COUNT(*) AS n FROM `{table}`")
            stats[f"total_{public_name}"] = cur.fetchone()["n"]  # type: ignore[index]
            cur.close()
        self._stats_cache["stats"] = stats
        return dict(stats)

    def list_tables(self) -> List[str]:
        return sorted(self._table_columns)

    def warm_cache(self) -> int:
        """
        Pre-populate the LRU+TTL cache up to its maxsize with the most-recently
        updated drugs. Entries will expire naturally after cache_ttl seconds, and
        the LRU policy will evict the least-recently-used entry when full.
        """
        for attempt in range(2):
            try:
                cur = self._cursor()
                # Fetch in recency order so the most relevant drugs fill the cache first
                where = "is_current = 1"
                if self._version_has_soft_delete():
                    where += " AND COALESCE(is_deleted, 0) = 0"
                cur.execute(
                    f"SELECT drug_id FROM drug_versions WHERE {where} "
                    "ORDER BY updated_at DESC LIMIT %s",
                    (self._cache_maxsize,),
                )
                ids = [row["drug_id"] for row in cur.fetchall()]  # type: ignore[index]
                cur.close()
                break
            except Exception as exc:
                if attempt == 0 and self._is_retryable_mysql_error(exc):
                    logger.warning("Transient MySQL error while listing ids for warm_cache; reconnecting and retrying once: %s", exc)
                    self._reset_connection()
                    continue
                raise

        cached = 0
        for drug_id in ids:
            if drug_id in self._json_cache:
                continue
            snapshot = None
            for attempt in range(2):
                try:
                    snapshot = self._get_current_snapshot_uncached(drug_id)
                    break
                except Exception as exc:
                    if attempt == 0 and self._is_retryable_mysql_error(exc):
                        logger.warning(
                            "Transient MySQL error warming drug_id=%s; reconnecting and retrying once: %s",
                            drug_id,
                            exc,
                        )
                        self._reset_connection()
                        continue
                    raise
            if snapshot is None:
                continue
            self._cache_current_snapshot(drug_id, snapshot)
            cached += 1
        return cached

    def _deep_sizeof(self, obj: Any, seen: Optional[set[int]] = None) -> int:
        if seen is None:
            seen = set()
        obj_id = id(obj)
        if obj_id in seen:
            return 0
        seen.add(obj_id)

        size = sys.getsizeof(obj)
        if isinstance(obj, dict):
            for key, value in obj.items():
                size += self._deep_sizeof(key, seen)
                size += self._deep_sizeof(value, seen)
        elif isinstance(obj, (list, tuple, set, frozenset)):
            for item in obj:
                size += self._deep_sizeof(item, seen)
        return size

    def benchmark_cache(self, reset: bool = True) -> dict:
        """
        Benchmark warm-up time and in-memory size of the current-version JSON cache.
        """
        before_entries = len(self._json_cache)
        if reset:
            self._json_cache.clear()

        t0 = time.perf_counter()
        added = self.warm_cache()
        warm_seconds = time.perf_counter() - t0

        info = self.cache_info()
        estimated_bytes = self._deep_sizeof(self._json_cache)

        return {
            "reset":             reset,
            "entries_before":    before_entries,
            "entries_after":     info["currsize"],
            "added":             added,
            "warm_seconds":      round(warm_seconds, 3),
            "payload_bytes":     info["payload_bytes"],
            "payload_mb":        info["payload_mb"],
            "estimated_bytes":   estimated_bytes,
            "estimated_mb":      round(estimated_bytes / (1024 * 1024), 2),
            "avg_payload_bytes": round(info["payload_bytes"] / info["currsize"], 1) if info["currsize"] else 0.0,
            "avg_estimated_bytes": round(estimated_bytes / info["currsize"], 1) if info["currsize"] else 0.0,
        }

    def get_all_drug_ids(self) -> List[int]:
        """
        Return every current, non-deleted drug_id — used by Meilisearch sync
        to determine which drugs need to be indexed.
        """
        where = "is_current = 1"
        if self._version_has_soft_delete():
            where += " AND COALESCE(is_deleted, 0) = 0"
        rows = self.execute_query(
            f"SELECT DISTINCT drug_id FROM drug_versions WHERE {where} ORDER BY drug_id",
            (),
        )
        return [int(row["drug_id"]) for row in rows]

    def close(self) -> None:
        if self._conn and self._conn.is_connected():
            self._conn.close()
            self._conn = None
            logger.info("MySQL connection closed")
        self._json_cache.clear()

    def __enter__(self) -> "UnifiedDrugDatabaseController":
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
        return False

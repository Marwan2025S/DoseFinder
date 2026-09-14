"""
meilisearch_service.py — Full-text drug search via Meilisearch.
===============================================================

Provides:
  configure_index()    — Create the index and set searchable/filterable attrs.
  build_drug_document() — Flatten a full drug snapshot to a Meilisearch doc.
  sync_drug()          — Add/update one drug in the index.
  delete_drug_document() — Remove one drug from the index.
  sync_all_drugs()     — Full re-index from MySQL (batch upload).
  search_drug_ids()    — Full-text search; returns drug_ids in relevance order.
  is_available()       — Non-throwing health check (True / False).

Environment variables:
  MEILISEARCH_URL  — default "http://meilisearch:7700"
  MEILISEARCH_KEY  — master/API key (default "")
"""

from __future__ import annotations

import logging
import os
from typing import TYPE_CHECKING, List, Optional

logger = logging.getLogger(__name__)

MEILISEARCH_URL: str = os.getenv("MEILISEARCH_URL", "http://meilisearch:7700")
MEILISEARCH_KEY: str = os.getenv("MEILISEARCH_KEY", "")
INDEX_NAME: str = "drugs"

# Lazy-initialised client — created on first use.
_client = None


def _get_client():
    global _client
    if _client is None:
        try:
            import meilisearch  # type: ignore
            _client = meilisearch.Client(MEILISEARCH_URL, MEILISEARCH_KEY or None)
        except ImportError:
            logger.warning("[Meilisearch] 'meilisearch' package not installed — search disabled.")
    return _client


# ─────────────────────────────────────────────────────────────────────────────
#  Health
# ─────────────────────────────────────────────────────────────────────────────

def is_available() -> bool:
    """Return True if Meilisearch is reachable, False otherwise (never raises)."""
    try:
        client = _get_client()
        if client is None:
            return False
        client.health()
        return True
    except Exception:
        return False


# ─────────────────────────────────────────────────────────────────────────────
#  Index configuration
# ─────────────────────────────────────────────────────────────────────────────

def configure_index() -> bool:
    """
    Ensure the drugs index exists and configure its settings.
    Returns True on success, False on failure.
    """
    try:
        client = _get_client()
        if client is None:
            return False

        # Create index (silently ignored if it already exists)
        try:
            client.create_index(INDEX_NAME, {"primaryKey": "id"})
        except Exception:
            pass  # Index already exists

        index = client.index(INDEX_NAME)

        # Searchable attributes — order determines relevance priority.
        # Name fields first (highest priority), then clinical text.
        index.update_searchable_attributes([
            "generic_name",
            "brand_names",
            "arabic_trade_name",
            "classes",
            "indications",
            "adverse_effects",
            "pharmacology",
            "warnings",
            "administration",
            "suggested_uses",
            "dosage_form",
            "route",
            "source",
            "rx_status",
        ])

        # Filterable attributes — used for post-search narrowing
        index.update_filterable_attributes([
            "source",
            "rx_status",
        ])

        logger.info("[Meilisearch] Index '%s' configured at %s", INDEX_NAME, MEILISEARCH_URL)
        return True

    except Exception as exc:
        logger.warning("[Meilisearch] configure_index failed: %s", exc)
        return False


# ─────────────────────────────────────────────────────────────────────────────
#  Document builder
# ─────────────────────────────────────────────────────────────────────────────

def _join_text(items: Optional[list], *keys: str) -> str:
    """
    Collect unique, non-empty string values from a list of dicts.
    Multiple fields are checked per dict row; results are pipe-separated.
    """
    seen: set = set()
    parts: list = []
    for item in (items or []):
        if not isinstance(item, dict):
            continue
        for key in keys:
            val = item.get(key)
            if val and str(val).strip():
                v = str(val).strip()
                if v not in seen:
                    seen.add(v)
                    parts.append(v)
    return " | ".join(parts)


def _safe_str(val) -> str:
    return str(val).strip() if val else ""


def build_drug_document(drug: dict) -> dict:
    """
    Flatten a full drug snapshot (from get_drug_by_id) into a single
    Meilisearch document.  All related sub-tables are concatenated into
    searchable text fields so that a plain-text query can match any field
    (indications, adverse effects, warnings, pharmacology, etc.).
    """
    dde_list = drug.get("drug_dms_extensions") or []
    dde: dict = dde_list[0] if isinstance(dde_list, list) and dde_list else {}

    return {
        # Primary key (must be "id" to match index primaryKey setting)
        "id":                drug["drug_id"],
        "drug_id":           drug["drug_id"],

        # Name fields — highest search priority
        "generic_name":      _safe_str(drug.get("generic_name")),
        "brand_names":       _safe_str(drug.get("brand_names")),
        "arabic_trade_name": _safe_str(
            dde.get("arabic_trade_name") or drug.get("arabic_trade_name")
        ),

        # Scalar metadata (also used for filters / display)
        "source":            _safe_str(drug.get("source")),
        "rx_status":         _safe_str(drug.get("rx_status")),
        "route":             _safe_str(dde.get("route") or drug.get("route")),
        "price":             drug.get("price"),

        # Sub-table text — the fields that the old search completely missed
        "classes":           _join_text(drug.get("classes"),         "class_name"),
        "dosage_form":       _join_text(drug.get("dosage_forms"),    "form_name", "strength_text"),
        "indications":       _join_text(drug.get("dosing"),          "indication", "notes_text"),
        "adverse_effects":   _join_text(drug.get("adverse_effects"), "effect_text", "body_system"),
        "warnings":          _join_text(drug.get("warnings"),        "text", "warning_type"),
        "pharmacology":      _join_text(drug.get("pharmacology"),    "text", "topic"),
        "administration":    _join_text(drug.get("administration"),  "text", "topic"),
        "suggested_uses":    _join_text(drug.get("suggested_uses"),  "text", "topic"),
    }


# ─────────────────────────────────────────────────────────────────────────────
#  Single-document operations
# ─────────────────────────────────────────────────────────────────────────────

def sync_drug(drug: dict) -> bool:
    """
    Add or update one drug document in Meilisearch.
    Returns True on success, False on failure (never raises).
    """
    try:
        doc = build_drug_document(drug)
        _get_client().index(INDEX_NAME).add_documents([doc])
        return True
    except Exception as exc:
        logger.warning(
            "[Meilisearch] sync_drug(%s) failed: %s",
            drug.get("drug_id"), exc
        )
        return False


def delete_drug_document(drug_id: int) -> bool:
    """
    Remove a drug document from the index.
    Returns True on success, False on failure (never raises).
    """
    try:
        _get_client().index(INDEX_NAME).delete_document(drug_id)
        return True
    except Exception as exc:
        logger.warning("[Meilisearch] delete_drug_document(%s) failed: %s", drug_id, exc)
        return False


# ─────────────────────────────────────────────────────────────────────────────
#  Full re-index  (bulk SQL — dedicated connection)
# ─────────────────────────────────────────────────────────────────────────────

def _build_documents_bulk(sync_db, drug_id_version_pairs: list) -> list:
    """
    Build Meilisearch documents for a batch of drugs using one SQL query per
    table instead of one full snapshot per drug.

    drug_id_version_pairs: list of {"drug_id": N, "version_id": M} dicts
    """
    if not drug_id_version_pairs:
        return []

    drug_ids   = [r["drug_id"]   for r in drug_id_version_pairs]
    version_ids = [r["version_id"] for r in drug_id_version_pairs]

    ph_d = ", ".join("%s" for _ in drug_ids)
    ph_v = ", ".join("%s" for _ in version_ids)

    # ── Main drug data (1 query) ─────────────────────────────────────────
    try:
        main_rows = sync_db.execute_query(
            f"""
            SELECT dv.drug_id, dv.version_id,
                   dm.generic_name, dm.brand_names, dm.rx_status, dm.source,
                   dde.arabic_trade_name, dde.route, dde.price
            FROM drug_versions dv
            JOIN drug_master dm ON dm.version_id = dv.version_id
            LEFT JOIN drug_dms_extensions dde ON dde.version_id = dv.version_id
            WHERE dv.drug_id IN ({ph_d}) AND dv.is_current = 1
              AND COALESCE(dv.is_deleted, 0) = 0
            """,
            tuple(drug_ids),
        )
    except Exception as exc:
        logger.warning("[Meilisearch] Main query failed for batch: %s", exc)
        return []

    if not main_rows:
        return []

    # Map version_id → main row for quick lookup
    main_map: dict = {r["version_id"]: r for r in main_rows}

    # ── Sub-table helper (1 query per table) ────────────────────────────
    def fetch_sub(table: str, *cols: str) -> dict:
        """Returns {version_id: [row, ...]} for the given version_ids."""
        col_list = ", ".join(f"`{c}`" for c in cols)
        try:
            rows = sync_db.execute_query(
                f"SELECT version_id, {col_list} FROM `{table}` WHERE version_id IN ({ph_v})",
                tuple(version_ids),
            )
            result: dict = {}
            for r in rows:
                result.setdefault(r["version_id"], []).append(r)
            return result
        except Exception as exc:
            logger.debug("[Meilisearch] Sub-table '%s' skipped: %s", table, exc)
            return {}

    classes_map  = fetch_sub("drug_classes",        "class_name")
    forms_map    = fetch_sub("drug_dosage_forms",   "form_name", "strength_text")
    dosing_map   = fetch_sub("drug_dosing",         "indication", "notes_text")
    adverse_map  = fetch_sub("drug_adverse_effects","effect_text", "body_system")
    warnings_map = fetch_sub("drug_warnings",       "text", "warning_type")
    pharma_map   = fetch_sub("drug_pharmacology",   "text", "topic")
    admin_map    = fetch_sub("drug_administration", "text", "topic")
    uses_map     = fetch_sub("drug_suggested_uses", "text", "topic")

    # ── Assemble one document per drug ──────────────────────────────────
    documents = []
    for row in main_rows:
        vid = row["version_id"]
        did = row["drug_id"]
        documents.append({
            "id":                did,
            "drug_id":           did,
            "generic_name":      _safe_str(row.get("generic_name")),
            "brand_names":       _safe_str(row.get("brand_names")),
            "arabic_trade_name": _safe_str(row.get("arabic_trade_name")),
            "source":            _safe_str(row.get("source")),
            "rx_status":         _safe_str(row.get("rx_status")),
            "route":             _safe_str(row.get("route")),
            "price":             row.get("price"),
            "classes":           _join_text(classes_map.get(vid, []),  "class_name"),
            "dosage_form":       _join_text(forms_map.get(vid, []),    "form_name", "strength_text"),
            "indications":       _join_text(dosing_map.get(vid, []),   "indication", "notes_text"),
            "adverse_effects":   _join_text(adverse_map.get(vid, []),  "effect_text", "body_system"),
            "warnings":          _join_text(warnings_map.get(vid, []), "text", "warning_type"),
            "pharmacology":      _join_text(pharma_map.get(vid, []),   "text", "topic"),
            "administration":    _join_text(admin_map.get(vid, []),    "text", "topic"),
            "suggested_uses":    _join_text(uses_map.get(vid, []),     "text", "topic"),
        })

    return documents


def sync_all_drugs(db_controller, batch_size: int = 500) -> dict:
    """
    Full re-index using bulk SQL (9 queries per batch of 500 drugs instead
    of ~10,000).  Runs on a dedicated DB connection so the main API stays
    fully responsive during indexing.

    Returns {"indexed": N, "errors": M, "total": T}
    """
    from db_controller import UnifiedDrugDatabaseController  # local import to avoid circular

    # ── Dedicated connection — keeps sync I/O off the main API connection ──
    sync_db = UnifiedDrugDatabaseController(
        host=db_controller._host,
        port=db_controller._port,
        user=db_controller._user,
        password=db_controller._password,
        database=db_controller._database,
        cache_maxsize=1,   # No caching needed for a one-time sync pass
        cache_ttl=1,
    )

    indexed = 0
    errors  = 0
    total   = 0

    try:
        # Fetch all (drug_id, version_id) pairs in one query
        where = "is_current = 1 AND COALESCE(is_deleted, 0) = 0"
        all_pairs = sync_db.execute_query(
            f"SELECT drug_id, version_id FROM drug_versions WHERE {where} ORDER BY drug_id",
            (),
        )
        total = len(all_pairs)
        logger.info("[Meilisearch] Starting full sync: %d drugs (%d batches of %d)",
                    total, -(-total // batch_size), batch_size)

        for i in range(0, total, batch_size):
            batch_pairs = all_pairs[i : i + batch_size]
            try:
                documents = _build_documents_bulk(sync_db, batch_pairs)
                if documents:
                    _get_client().index(INDEX_NAME).add_documents(documents)
                    indexed += len(documents)
                errors += len(batch_pairs) - len(documents)
            except Exception as exc:
                logger.warning("[Meilisearch] Batch at offset %d failed: %s", i, exc)
                errors += len(batch_pairs)

            if (i // batch_size + 1) % 10 == 0:   # log every 10 batches
                logger.info("[Meilisearch] Progress: %d / %d", indexed, total)

        logger.info("[Meilisearch] Full sync complete — indexed: %d, errors: %d", indexed, errors)

    except Exception as exc:
        logger.error("[Meilisearch] sync_all_drugs failed: %s", exc)
        errors += 1

    finally:
        try:
            sync_db.close()
        except Exception:
            pass

    return {"indexed": indexed, "errors": errors, "total": total}


# ─────────────────────────────────────────────────────────────────────────────
#  Search
# ─────────────────────────────────────────────────────────────────────────────

def search_drug_ids(query: str, limit: int = 1000) -> List[int]:
    """
    Full-text search via Meilisearch.

    Returns a list of drug_ids ordered by relevance (best match first).
    Returns [] on error or if Meilisearch is unavailable.
    """
    try:
        client = _get_client()
        if client is None:
            return []

        result = client.index(INDEX_NAME).search(
            query,
            {
                "limit": min(limit, 1000),
                "attributesToRetrieve": ["drug_id"],
            },
        )
        return [hit["drug_id"] for hit in result.get("hits", [])]

    except Exception as exc:
        logger.warning("[Meilisearch] search_drug_ids('%s') failed: %s", query, exc)
        return []

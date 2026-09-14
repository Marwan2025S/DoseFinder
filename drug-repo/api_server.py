"""
api_server.py  —  Unified Drug Database API  (MedScape + DMS)
==============================================================

Endpoints
---------
Utility
  GET  /api/health
  GET  /api/stats

Search / List
  GET  /api/drugs/search          hybrid URL-params + body

Full drug (main + all sub-tables in one JSON)
  GET  /api/drugs/{drug_id}

Main row only
  GET  /api/drugs/{drug_id}/main

Versions
  GET  /api/drugs/{drug_id}/versions
  GET  /api/drugs/{drug_id}/versions/{version_number}
  POST /api/drugs/{drug_id}/versions/{version_number}/promote

Individual sub-table endpoints
  GET  /api/drugs/{drug_id}/dosage-forms
  GET  /api/drugs/{drug_id}/dosing
  GET  /api/drugs/{drug_id}/adverse-effects
  GET  /api/drugs/{drug_id}/warnings
  GET  /api/drugs/{drug_id}/interactions
  GET  /api/drugs/{drug_id}/pregnancy
  GET  /api/drugs/{drug_id}/pharmacology
  GET  /api/drugs/{drug_id}/administration
  GET  /api/drugs/{drug_id}/suggested-dosing
  GET  /api/drugs/{drug_id}/suggested-uses
  GET  /api/drugs/{drug_id}/nutrition
  GET  /api/drugs/{drug_id}/name-components

CRUD
  POST   /api/drugs
  PUT    /api/drugs/{drug_id}
  DELETE /api/drugs/{drug_id}

Configuration (env vars)
------------------------
  MYSQL_HOST      MySQL host                     (default: mysql)
  MYSQL_PORT      MySQL port                     (default: 3306)
  MYSQL_USER      MySQL user
  MYSQL_PASSWORD  MySQL password
  MYSQL_DATABASE  MySQL database                 (default: dms_db)
  API_PORT        (default: 8000)
  API_HOST        (default: 0.0.0.0)
"""

import logging
import os
import threading
from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import Depends, FastAPI, HTTPException, Query, Path as PathParam
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict

from db_controller import (
    UnifiedDrugDatabaseController,
    ValidationError,
    DrugNotFoundError,
)
import meilisearch_service

logging.getLogger("watchfiles").setLevel(logging.WARNING)
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────

MYSQL_HOST     = os.getenv("MYSQL_HOST", "mysql")
MYSQL_PORT     = int(os.getenv("MYSQL_PORT", "3306"))
MYSQL_USER     = os.getenv("MYSQL_USER")
MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD")
MYSQL_DATABASE = os.getenv("MYSQL_DATABASE", "dms_db")
API_PORT       = int(os.getenv("API_PORT", "8000"))
API_HOST       = os.getenv("API_HOST", "0.0.0.0")
CACHE_WARM_ON_STARTUP  = os.getenv("CACHE_WARM_ON_STARTUP",  "0").strip().lower() in {"1", "true", "yes", "on"}
SEARCH_SYNC_ON_STARTUP = os.getenv("SEARCH_SYNC_ON_STARTUP", "0").strip().lower() in {"1", "true", "yes", "on"}
CACHE_MAXSIZE  = int(os.getenv("CACHE_MAXSIZE", "500"))
CACHE_TTL      = float(os.getenv("CACHE_TTL_SECONDS", "600"))

if MYSQL_PASSWORD is None:
    raise RuntimeError("MYSQL_PASSWORD is not set")

db_controller: Optional[UnifiedDrugDatabaseController] = None


# ── Lifespan: assemble DB and open controller ─────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_controller
    try:
        logger.info(f"Connecting to MySQL database {MYSQL_DATABASE} at {MYSQL_HOST}:{MYSQL_PORT}.")
        db_controller = UnifiedDrugDatabaseController(
            host=MYSQL_HOST,
            port=MYSQL_PORT,
            user=MYSQL_USER,
            password=MYSQL_PASSWORD,
            database=MYSQL_DATABASE,
            cache_maxsize=CACHE_MAXSIZE,
            cache_ttl=CACHE_TTL,
        )
        db_controller._get_connection()
        logger.info("Database controller ready")
        if CACHE_WARM_ON_STARTUP:
            try:
                cached = db_controller.warm_cache()
                if cached:
                    logger.info(f"Cache warmed: {cached} drugs cached")
                else:
                    logger.info("Cache already warm - nothing to do")
            except Exception as e:
                logger.warning(f"Cache warm failed (non-fatal): {e}")

        # ── Meilisearch setup (non-fatal) ─────────────────────────────────
        if meilisearch_service.is_available():
            meilisearch_service.configure_index()
            if SEARCH_SYNC_ON_STARTUP:
                # Run sync in a background thread so the API starts immediately
                # and can serve requests (MySQL fallback) while indexing continues.
                def _background_sync():
                    logger.info("SEARCH_SYNC_ON_STARTUP=1 — background sync started...")
                    try:
                        result = meilisearch_service.sync_all_drugs(db_controller)
                        logger.info(f"Meilisearch background sync complete: {result}")
                    except Exception as ms_exc:
                        logger.warning(f"Meilisearch background sync failed (non-fatal): {ms_exc}")

                sync_thread = threading.Thread(target=_background_sync, daemon=True)
                sync_thread.start()
                logger.info(
                    "Meilisearch sync started in background — API is ready now. "
                    "Search uses MySQL fallback until indexing completes."
                )
        else:
            logger.warning(
                "Meilisearch not reachable at %s — full-text search disabled, "
                "falling back to MySQL LIKE search.",
                meilisearch_service.MEILISEARCH_URL,
            )

    except Exception as e:
        logger.critical(f"Startup failed: {e}")
        raise
    yield
    if db_controller:
        db_controller.close()
        logger.info("Database controller closed")


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title       = "Unified Drug Database API",
    description = "REST API for the unified MedScape + DMS drug database",
    version     = "2.0.0",
    lifespan    = lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins     = ["*"],
    allow_credentials = True,
    allow_methods     = ["*"],
    allow_headers     = ["*"],
)


def get_db() -> UnifiedDrugDatabaseController:
    if db_controller is None:
        raise HTTPException(status_code=503, detail="Database not ready")
    return db_controller


IMMUTABLE_WRITE_FIELDS = {
    "drug_id",
    "version_id",
    "version_number",
    "updated_at",
    "is_current",
    "is_deleted",
    "deleted_at",
    "date_updated",
}
IMMUTABLE_SUB_ROW_FIELDS = {"id", "version_id", "drug_id"}


# ─────────────────────────────────────────────────────────────────────────────
#  Pydantic models
# ─────────────────────────────────────────────────────────────────────────────

class SearchFilters(BaseModel):
    """Complex search filters — sent in the request body."""
    q:          Optional[str]        = None
    dosage_form: Optional[str]       = None
    source:     Optional[str]        = None   # 'MedScape' | 'DMS'
    routes:     Optional[List[str]]  = None
    indications: Optional[List[str]] = None
    has_fda:    Optional[bool]       = None
    min_price:  Optional[float]      = None
    max_price:  Optional[float]      = None
    sort_by:    Optional[str]        = "id"
    sort_order: Optional[str]        = "asc"
    model_config = ConfigDict(extra="forbid")


class DrugCreate(BaseModel):
    """Drug creation — main fields + optional sub-table arrays."""
    # Core / DMS fields
    drug_id:                             Optional[int]        = None
    trade_name:                          Optional[str]        = None
    generic_name:                        Optional[str]        = None
    brand_names:                         Optional[str]        = None
    code:                                Optional[str]        = None
    price:                               Optional[float]      = None
    arabic_trade_name:                   Optional[str]        = None
    dosage_form:                         Optional[str]        = None
    ham:                                 Optional[str]        = None
    rx_status:                           Optional[str]        = None
    allergic_category:                   Optional[str]        = None
    allergy_type:                        Optional[str]        = None
    raw_contraindication:                Optional[str]        = None
    contraindication_status:             Optional[str]        = None
    contraindication_count:              Optional[int]        = None
    contraindication_primary_category:   Optional[str]        = None
    contraindication_severity:           Optional[str]        = None
    contraindications_list:              Optional[str]        = None
    note_raw:                            Optional[str]        = None
    note_primary_category:               Optional[str]        = None
    note_all_categories:                 Optional[str]        = None
    note_category_count:                 Optional[int]        = None
    # Unified-schema additions
    drug_name:    Optional[str]  = None   # MedScape canonical name
    url:          Optional[str]  = None
    categories:   Optional[str]  = None
    source:       Optional[str]  = None   # 'MedScape' | 'DMS'
    version_id:   Optional[int]  = None
    version_number: Optional[int] = None
    doctor_id:    Optional[int]  = None
    date_updated: Optional[str]  = None
    updated_at:   Optional[str]  = None
    is_current:   Optional[int]  = None
    is_deleted:   Optional[int]  = None
    deleted_at:   Optional[str]  = None
    # Sub-table data
    dosage_forms:     Optional[List[dict]] = None
    dosing:           Optional[List[dict]] = None
    classes:          Optional[List[dict]] = None
    adverse_effects:  Optional[List[dict]] = None
    warnings:         Optional[List[dict]] = None
    interactions:     Optional[List[dict]] = None
    pregnancy:        Optional[List[dict]] = None
    pharmacology:     Optional[List[dict]] = None
    administration:   Optional[List[dict]] = None
    suggested_dosing: Optional[List[dict]] = None
    suggested_uses:   Optional[List[dict]] = None
    nutrition:        Optional[List[dict]] = None
    subcategory_listing: Optional[List[dict]] = None
    name_components:  Optional[List[dict]] = None
    dms_extensions:   Optional[List[dict]] = None
    drug_dms_extensions: Optional[List[dict]] = None
    fda_products:         Optional[List[dict]] = None
    fda_submissions:      Optional[List[dict]] = None
    fda_extensions:       Optional[List[dict]] = None
    model_config = ConfigDict(extra="forbid")


class DrugUpdate(BaseModel):
    """Drug update — all fields optional for partial updates."""
    drug_id:                             Optional[int]        = None
    trade_name:                          Optional[str]        = None
    generic_name:                        Optional[str]        = None
    brand_names:                         Optional[str]        = None
    code:                                Optional[str]        = None
    price:                               Optional[float]      = None
    arabic_trade_name:                   Optional[str]        = None
    dosage_form:                         Optional[str]        = None
    ham:                                 Optional[str]        = None
    rx_status:                           Optional[str]        = None
    allergic_category:                   Optional[str]        = None
    allergy_type:                        Optional[str]        = None
    raw_contraindication:                Optional[str]        = None
    contraindication_status:             Optional[str]        = None
    contraindication_count:              Optional[int]        = None
    contraindication_primary_category:   Optional[str]        = None
    contraindication_severity:           Optional[str]        = None
    contraindications_list:              Optional[str]        = None
    note_raw:                            Optional[str]        = None
    note_primary_category:               Optional[str]        = None
    note_all_categories:                 Optional[str]        = None
    note_category_count:                 Optional[int]        = None
    drug_name:        Optional[str]  = None
    url:              Optional[str]  = None
    categories:       Optional[str]  = None
    source:           Optional[str]  = None
    version_id:       Optional[int]  = None
    version_number:   Optional[int]  = None
    doctor_id:        Optional[int]  = None
    date_updated:     Optional[str]  = None
    updated_at:       Optional[str]  = None
    is_current:       Optional[int]  = None
    is_deleted:       Optional[int]  = None
    deleted_at:       Optional[str]  = None
    dosage_forms:     Optional[List[dict]] = None
    dosing:           Optional[List[dict]] = None
    classes:          Optional[List[dict]] = None
    adverse_effects:  Optional[List[dict]] = None
    warnings:         Optional[List[dict]] = None
    interactions:     Optional[List[dict]] = None
    pregnancy:        Optional[List[dict]] = None
    pharmacology:     Optional[List[dict]] = None
    administration:   Optional[List[dict]] = None
    suggested_dosing: Optional[List[dict]] = None
    suggested_uses:   Optional[List[dict]] = None
    nutrition:        Optional[List[dict]] = None
    subcategory_listing: Optional[List[dict]] = None
    name_components:  Optional[List[dict]] = None
    dms_extensions:   Optional[List[dict]] = None
    drug_dms_extensions: Optional[List[dict]] = None
    fda_products:         Optional[List[dict]] = None
    fda_submissions:      Optional[List[dict]] = None
    fda_extensions:       Optional[List[dict]] = None
    model_config = ConfigDict(extra="forbid")


class PaginatedResponse(BaseModel):
    results:  List[dict]
    page:     int
    per_page: int
    total:    int


class StatsResponse(BaseModel):
    total_drugs: int
    model_config = ConfigDict(extra="allow")


class HealthResponse(BaseModel):
    status:   str
    database: str


def _reject_immutable_write_fields(payload: dict) -> None:
    violations = sorted(field for field in IMMUTABLE_WRITE_FIELDS if field in payload)
    for section_name, value in payload.items():
        if not isinstance(value, list):
            continue
        for index, row in enumerate(value):
            if not isinstance(row, dict):
                continue
            for field in sorted(IMMUTABLE_SUB_ROW_FIELDS.intersection(row)):
                violations.append(f"{section_name}[{index}].{field}")
    if violations:
        raise ValidationError(
            "Immutable fields cannot be written: " + ", ".join(violations)
        )


def _strip_public_internal_fields(payload: dict) -> dict:
    """Remove system-owned metadata from public API responses."""
    clean = dict(payload)
    clean.pop("fda_ids", None)
    clean.pop("fda_payload_hashes", None)
    return clean


# ─────────────────────────────────────────────────────────────────────────────
#  Utility endpoints
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/health", response_model=HealthResponse, tags=["Utility"])
async def health_check(db: UnifiedDrugDatabaseController = Depends(get_db)):
    return {"status": "healthy", "database": "connected"}


@app.get("/api/stats", response_model=StatsResponse, tags=["Utility"])
async def get_statistics(db: UnifiedDrugDatabaseController = Depends(get_db)):
    try:
        stats = db.get_stats()
        stats.pop("total_fda_ids", None)
        stats.pop("total_fda_payload_hashes", None)
        return stats
    except Exception as e:
        logger.error(f"Stats failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/cache/warm", response_model=dict, tags=["Cache"])
async def warm_cache(db: UnifiedDrugDatabaseController = Depends(get_db)):
    """
    Pre-populate the cache with the most recently updated drugs (up to maxsize).
    Existing entries that haven't expired yet are skipped.
    """
    try:
        cached = db.warm_cache()  # type: ignore
        return {**db.cache_info(), "added": cached, "message": f"{cached} drugs added to cache"}
    except Exception as e:
        logger.error(f"Cache warm failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/cache/stats", response_model=dict, tags=["Cache"])
async def cache_stats(db: UnifiedDrugDatabaseController = Depends(get_db)):
    """
    Return live cache statistics: current size, max size, TTL, and memory usage.
    No drugs are fetched or evicted.
    """
    try:
        return db.cache_info()
    except Exception as e:
        logger.error(f"Cache stats failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/cache", response_model=dict, tags=["Cache"])
async def clear_cache(db: UnifiedDrugDatabaseController = Depends(get_db)):
    """Evict all entries from the cache immediately."""
    try:
        before = db.cache_info()["currsize"]
        db._json_cache.clear()
        return {"evicted": before, "message": f"{before} entries cleared"}
    except Exception as e:
        logger.error(f"Cache clear failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────────────────────────────────────
#  Search helpers
# ─────────────────────────────────────────────────────────────────────────────

import json as _json

def _enrich_search_results(
    db: UnifiedDrugDatabaseController, results: list[dict]
) -> list[dict]:
    """
    Attach aggregated sub-table data to flat search rows so the frontend
    can filter by dosage form, route, etc. without fetching full details.

    Adds to each row:
      - dosage_forms: [{"form_name": "..."}]   (unique forms for this drug)
      - drug_dms_extensions: canonical DMS row used by frontend filters/cards
      - has_fda: true when any user-visible FDA subtable has rows for the version
    """
    if not results:
        return results

    version_ids = [r["version_id"] for r in results if r.get("version_id")]
    if not version_ids:
        return results

    # ── Batch-fetch dosage forms ──────────────────────────────────────────
    placeholders = ", ".join("%s" for _ in version_ids)
    form_sql = (
        f"SELECT version_id, GROUP_CONCAT(DISTINCT form_name SEPARATOR '||') AS forms "
        f"FROM drug_dosage_forms WHERE version_id IN ({placeholders}) "
        f"GROUP BY version_id"
    )
    form_rows = db.execute_query(form_sql, tuple(version_ids))
    form_map: dict[int, list[dict]] = {}
    for fr in form_rows:
        names = (fr.get("forms") or "").split("||")
        form_map[fr["version_id"]] = [
            {"form_name": n.strip()} for n in names if n.strip()
        ]

    fda_map: dict[int, int] = {}
    try:
        fda_sql = (
            f"SELECT version_id, COUNT(*) AS row_count FROM ("
            f"SELECT version_id FROM drug_fda_products WHERE version_id IN ({placeholders}) "
            f"UNION ALL SELECT version_id FROM drug_fda_submissions WHERE version_id IN ({placeholders}) "
            f"UNION ALL SELECT version_id FROM drug_fda_extensions WHERE version_id IN ({placeholders})"
            f") fda GROUP BY version_id"
        )
        fda_params = tuple(version_ids * 3)
        for fr in db.execute_query(fda_sql, fda_params):
            fda_map[int(fr["version_id"])] = int(fr.get("row_count") or 0)
    except Exception as exc:
        logger.warning("FDA search enrichment skipped: %s", exc)

    # ── Enrich each result ────────────────────────────────────────────────
    for row in results:
        vid = row.get("version_id")
        # dosage_forms
        row["dosage_forms"] = form_map.get(vid, [])
        row["drug_dms_extensions"] = [{
            "ham": row.get("ham"),
            "price": row.get("price"),
            "notes": row.get("notes"),
            "route": row.get("route"),
            "arabic_route": row.get("arabic_route"),
            "arabic_trade_name": row.get("arabic_trade_name"),
        }]
        row["has_fda"] = fda_map.get(int(vid), 0) > 0 if vid is not None else False

        # Legacy route summary retained for older clients; canonical clients
        # should read drug_dms_extensions[0].route.
        raw_route = row.get("route") or ""
        parsed_routes: list[dict] = []
        if raw_route:
            try:
                route_list = _json.loads(raw_route)
                if isinstance(route_list, list):
                    parsed_routes = [
                        {"route_name": str(r).strip()}
                        for r in route_list
                        if str(r).strip()
                    ]
            except (_json.JSONDecodeError, TypeError):
                # Might be a plain comma-separated string
                parsed_routes = [
                    {"route_name": r.strip()}
                    for r in raw_route.split(",")
                    if r.strip()
                ]
        row["routes"] = parsed_routes

    return results


# ─────────────────────────────────────────────────────────────────────────────
#  Search
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/drugs/search", response_model=PaginatedResponse, tags=["Query"])
async def search_drugs(
    # URL query parameters
    q:           Optional[str]   = Query(None,  description="Search term"),
    dosage_form: Optional[str]   = Query(None,  description="Exact dosage form filter"),
    source:      Optional[str]   = Query(None,  description="Data source: MedScape or DMS"),
    route:       Optional[str]   = Query(None,  description="Single route filter"),
    indication:  Optional[str]   = Query(None,  description="Single indication filter"),
    has_fda:     Optional[bool]  = Query(None,  description="Only include drugs with FDA rows when true"),
    min_price:   Optional[float] = Query(None,  description="Minimum price"),
    max_price:   Optional[float] = Query(None,  description="Maximum price"),
    sort_by:     str             = Query("id",  description="Column to sort by"),
    sort_order:  str             = Query("asc", description="asc or desc"),
    page:        int             = Query(1,     ge=1,         description="Page number"),
    per_page:    int             = Query(20,    ge=1, le=100, description="Results per page"),
    # Request body (arrays + overrides)
    filters: Optional[SearchFilters] = None,
    db: UnifiedDrugDatabaseController = Depends(get_db),
):
    """
    Hybrid search: simple filters via URL params, complex filters (arrays) in body.
    Body values take priority over URL params for the same field.

    Example URL::

        /api/drugs/search?q=aspirin&source=MedScape&page=1&per_page=20

    Example body::

        {"routes": ["ORAL", "IV"], "indications": ["pain", "fever"], "min_price": 5}
    """
    try:
        # Merge: body overrides URL params
        final_q           = (filters.q           if filters and filters.q           is not None else q)
        final_dosage_form = (filters.dosage_form  if filters and filters.dosage_form is not None else dosage_form)
        final_source      = (filters.source       if filters and filters.source      is not None else source)
        final_has_fda     = (filters.has_fda      if filters and filters.has_fda     is not None else has_fda)
        final_min_price   = (filters.min_price    if filters and filters.min_price   is not None else min_price)
        final_max_price   = (filters.max_price    if filters and filters.max_price   is not None else max_price)
        final_sort_by     = (filters.sort_by      if filters and filters.sort_by     is not None else sort_by)
        final_sort_order  = (filters.sort_order   if filters and filters.sort_order  is not None else sort_order)

        # ── Meilisearch full-text path ────────────────────────────────────
        # When a text query is present and Meilisearch is reachable, use it for
        # relevance-ranked full-text matching across ALL drug fields (indications,
        # adverse effects, warnings, pharmacology, classes, …).  Additional
        # structured filters (source, price, route, …) are applied in MySQL on
        # top of the Meilisearch result set so they keep working as before.
        if final_q and meilisearch_service.is_available():
            matched_ids = meilisearch_service.search_drug_ids(final_q, limit=1000)

            # Only take the Meilisearch path when it returned hits.  An empty result
            # means the index hasn't been synced yet (fresh deployment), so fall through
            # to the MySQL fallback below instead of returning a hard empty response.
            if matched_ids:
                # Build a MySQL query that:
                #   1. Restricts to Meilisearch-matched drug_ids
                #   2. Applies any remaining structured filters
                #   3. Fetches ALL matching rows (pagination done in Python to preserve relevance order)
                q_builder = db.query()
                q_builder.drug_id_filter(matched_ids)
                if final_dosage_form:
                    q_builder.dosage_form_filter(final_dosage_form)  # type: ignore
                if final_source:
                    q_builder.source_filter(final_source)
                if filters and filters.routes:
                    q_builder.route_contains(filters.routes)
                elif route:
                    q_builder.route_contains(route)
                if filters and filters.indications:
                    q_builder.indication_contains(filters.indications)
                elif indication:
                    q_builder.indication_contains(indication)
                q_builder.fda_presence_filter(final_has_fda)
                if final_min_price is not None or final_max_price is not None:
                    q_builder.price_between(final_min_price, final_max_price)
                q_builder.orderBy("id")   # stable MySQL order; Meilisearch rank applied below
                q_builder.limit(1000)     # cap total fetch; Meilisearch already capped at 1000

                sql, params = q_builder.build()
                all_results = db.execute_query(sql, params)

                # Re-sort by Meilisearch relevance (best match first)
                id_to_rank = {drug_id: rank for rank, drug_id in enumerate(matched_ids)}
                all_results.sort(key=lambda r: id_to_rank.get(r["drug_id"], 9999))

                total = len(all_results)

                # Python-level pagination (preserves relevance order across pages)
                start = (page - 1) * per_page
                page_results = all_results[start : start + per_page]

                page_results = _enrich_search_results(db, page_results)
                return {"results": page_results, "page": page, "per_page": per_page, "total": total}

        # ── MySQL fallback (no text query, Meilisearch unavailable, or empty index) ──
        def _build_query(paginate: bool):
            q_builder = db.query()
            if final_q:
                q_builder.search(final_q)
            if final_dosage_form:
                q_builder.dosage_form_filter(final_dosage_form)  # type: ignore
            if final_source:
                q_builder.source_filter(final_source)
            if filters and filters.routes:
                q_builder.route_contains(filters.routes)
            elif route:
                q_builder.route_contains(route)
            if filters and filters.indications:
                q_builder.indication_contains(filters.indications)
            elif indication:
                q_builder.indication_contains(indication)
            q_builder.fda_presence_filter(final_has_fda)
            if final_min_price is not None or final_max_price is not None:
                q_builder.price_between(final_min_price, final_max_price)
            q_builder.orderBy(final_sort_by, asc=(final_sort_order.lower() == "asc"))
            if paginate:
                q_builder.limit(per_page).offset((page - 1) * per_page)
            return q_builder

        sql, params = _build_query(paginate=True).build()
        count_sql, count_params = _build_query(paginate=False).build(count=True)

        results = db.execute_query(sql, params)
        total_rows = db.execute_query(count_sql, count_params)
        total = total_rows[0].get("total", 0) if total_rows else 0

        results = _enrich_search_results(db, results)

        return {"results": results, "page": page, "per_page": per_page, "total": total}

    except Exception as e:
        logger.error(f"Search failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/drugs/search", response_model=PaginatedResponse, tags=["Query"])
async def search_drugs_post(
    filters: SearchFilters,
    page:     int   = Query(1,    ge=1,         description="Page number"),
    per_page: int   = Query(20,   ge=1, le=100, description="Results per page"),
    db: UnifiedDrugDatabaseController = Depends(get_db),
):
    """
    POST variant of the search endpoint — identical behaviour to GET /api/drugs/search
    but accepts all filters in the request body. Preferred for browser clients
    because browsers block GET requests with a body.

    Pagination (page, per_page) can still be passed as URL query params.

    Example::

        POST /api/drugs/search?page=1&per_page=20
        {
          "q": "aspirin",
          "source": "MedScape",
          "routes": ["ORAL", "IV"],
          "indications": ["PAIN_RELIEF"],
          "min_price": 5,
          "sort_by": "price",
          "sort_order": "asc"
        }
    """
    try:
        # ── Meilisearch full-text path ────────────────────────────────────
        if filters.q and meilisearch_service.is_available():
            matched_ids = meilisearch_service.search_drug_ids(filters.q, limit=1000)

            if matched_ids:
                q_builder = db.query()
                q_builder.drug_id_filter(matched_ids)
                if filters.dosage_form:
                    q_builder.dosage_form_filter(filters.dosage_form)  # type: ignore
                if filters.source:
                    q_builder.source_filter(filters.source)
                if filters.routes:
                    q_builder.route_contains(filters.routes)
                if filters.indications:
                    q_builder.indication_contains(filters.indications)
                q_builder.fda_presence_filter(filters.has_fda)
                if filters.min_price is not None or filters.max_price is not None:
                    q_builder.price_between(filters.min_price, filters.max_price)
                q_builder.orderBy("id")
                q_builder.limit(1000)

                sql, params = q_builder.build()
                all_results = db.execute_query(sql, params)

                id_to_rank = {drug_id: rank for rank, drug_id in enumerate(matched_ids)}
                all_results.sort(key=lambda r: id_to_rank.get(r["drug_id"], 9999))

                total = len(all_results)
                start = (page - 1) * per_page
                page_results = all_results[start : start + per_page]

                page_results = _enrich_search_results(db, page_results)
                return {"results": page_results, "page": page, "per_page": per_page, "total": total}

        # ── MySQL fallback (no text query, Meilisearch unavailable, or empty index) ──
        def _build_query(paginate: bool):
            q_builder = db.query()
            if filters.q:
                q_builder.search(filters.q)
            if filters.dosage_form:
                q_builder.dosage_form_filter(filters.dosage_form)  # type: ignore
            if filters.source:
                q_builder.source_filter(filters.source)
            if filters.routes:
                q_builder.route_contains(filters.routes)
            if filters.indications:
                q_builder.indication_contains(filters.indications)
            q_builder.fda_presence_filter(filters.has_fda)
            if filters.min_price is not None or filters.max_price is not None:
                q_builder.price_between(filters.min_price, filters.max_price)
            sort_by    = filters.sort_by    or "id"
            sort_order = filters.sort_order or "asc"
            q_builder.orderBy(sort_by, asc=(sort_order.lower() == "asc"))
            if paginate:
                q_builder.limit(per_page).offset((page - 1) * per_page)
            return q_builder

        sql, params = _build_query(paginate=True).build()
        count_sql, count_params = _build_query(paginate=False).build(count=True)

        results = db.execute_query(sql, params)
        total_rows = db.execute_query(count_sql, count_params)
        total = total_rows[0].get("total", 0) if total_rows else 0

        results = _enrich_search_results(db, results)

        return {"results": results, "page": page, "per_page": per_page, "total": total}

    except Exception as e:
        logger.error(f"Search (POST) failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────────────────────────────────────
#  Full drug  (main + all sub-tables merged into one JSON)
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/drugs/{drug_id}", response_model=dict, tags=["Query"])
async def get_drug_full(
    drug_id: int = PathParam(..., description="Drug ID"),
    db: UnifiedDrugDatabaseController = Depends(get_db),
):
    """
    Return the complete drug object: main row merged with every drug-linked
    sub-table as nested arrays.

    Non-drug tables (e.g. drug_categories) are not included here.
    Use ``/api/drugs/{drug_id}/main`` if you only need the core fields.
    """
    try:
        drug = db.get_drug_by_id(drug_id)
        if drug is None:
            raise HTTPException(status_code=404, detail=f"Drug {drug_id} not found")
        return _strip_public_internal_fields(drug)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_drug_full({drug_id}) failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────────────────────────────────────
#  Main row only
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/drugs/{drug_id}/main", response_model=dict, tags=["Query"])
async def get_drug_main(
    drug_id: int = PathParam(..., description="Drug ID"),
    db: UnifiedDrugDatabaseController = Depends(get_db),
):
    """Return only the core drugs table row — no sub-table data."""
    try:
        drug = db.get_drug_main(drug_id)
        if drug is None:
            raise HTTPException(status_code=404, detail=f"Drug {drug_id} not found")
        return drug
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_drug_main({drug_id}) failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/drugs/{drug_id}/versions", response_model=List[dict], tags=["Query"])
async def get_drug_versions(
    drug_id: int = PathParam(..., description="Drug ID"),
    db: UnifiedDrugDatabaseController = Depends(get_db),
):
    """Return all stored versions for a drug."""
    try:
        return db.list_drug_versions(drug_id)
    except DrugNotFoundError:
        raise HTTPException(status_code=404, detail=f"Drug {drug_id} not found")
    except Exception as e:
        logger.error(f"get_drug_versions({drug_id}) failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/drugs/{drug_id}/versions/{version_number}", response_model=dict, tags=["Query"])
async def get_drug_version(
    drug_id: int = PathParam(..., description="Drug ID"),
    version_number: int = PathParam(..., ge=1, description="Stored version number"),
    db: UnifiedDrugDatabaseController = Depends(get_db),
):
    """Return a specific stored version snapshot for a drug."""
    try:
        version = db.get_drug_version(drug_id, version_number)
        if version is None:
            raise HTTPException(status_code=404, detail=f"Drug {drug_id} version {version_number} not found")
        return _strip_public_internal_fields(version)
    except HTTPException:
        raise
    except DrugNotFoundError:
        raise HTTPException(status_code=404, detail=f"Drug {drug_id} version {version_number} not found")
    except Exception as e:
        logger.error(f"get_drug_version({drug_id}, {version_number}) failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/drugs/{drug_id}/versions/{version_number}/promote", response_model=dict, tags=["Mutation"])
async def promote_drug_version(
    drug_id: int = PathParam(..., description="Drug ID"),
    version_number: int = PathParam(..., ge=1, description="Version number to promote"),
    db: UnifiedDrugDatabaseController = Depends(get_db),
):
    """Promote a stored version to become the current version."""
    try:
        promoted_version = db.promote_version(drug_id, version_number)
        return {
            "drug_id": drug_id,
            "current_version_number": promoted_version,
        }
    except DrugNotFoundError:
        raise HTTPException(status_code=404, detail=f"Drug {drug_id} version {version_number} not found")
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"promote_drug_version({drug_id}, {version_number}) failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────────────────────────────────────
#  Individual sub-table endpoints
# ─────────────────────────────────────────────────────────────────────────────

def _sub_endpoint(fetcher_name: str):
    """Factory: build a sub-table GET handler from a controller method name."""
    async def handler(
        drug_id: int = PathParam(..., description="Drug ID"),
        db: UnifiedDrugDatabaseController = Depends(get_db),
    ):
        try:
            rows = getattr(db, fetcher_name)(drug_id)
            return rows
        except Exception as e:
            logger.error(f"{fetcher_name}({drug_id}) failed: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    return handler


app.add_api_route(
    "/api/drugs/{drug_id}/classes",
    _sub_endpoint("get_drug_classes"),
    methods=["GET"], response_model=List[dict], tags=["Query"],
    summary="Drug classes for a drug",
)
app.add_api_route(
    "/api/drugs/{drug_id}/dosage-forms",
    _sub_endpoint("get_drug_dosage_forms"),
    methods=["GET"], response_model=List[dict], tags=["Query"],
    summary="Dosage forms for a drug",
)
app.add_api_route(
    "/api/drugs/{drug_id}/dosing",
    _sub_endpoint("get_drug_dosing"),
    methods=["GET"], response_model=List[dict], tags=["Query"],
    summary="Dosing entries for a drug",
)
app.add_api_route(
    "/api/drugs/{drug_id}/adverse-effects",
    _sub_endpoint("get_drug_adverse_effects"),
    methods=["GET"], response_model=List[dict], tags=["Query"],
    summary="Adverse effects for a drug",
)
app.add_api_route(
    "/api/drugs/{drug_id}/warnings",
    _sub_endpoint("get_drug_warnings"),
    methods=["GET"], response_model=List[dict], tags=["Query"],
    summary="Warnings for a drug",
)
app.add_api_route(
    "/api/drugs/{drug_id}/interactions",
    _sub_endpoint("get_drug_interactions"),
    methods=["GET"], response_model=List[dict], tags=["Query"],
    summary="Drug interactions",
)
app.add_api_route(
    "/api/drugs/{drug_id}/pregnancy",
    _sub_endpoint("get_drug_pregnancy"),
    methods=["GET"], response_model=List[dict], tags=["Query"],
    summary="Pregnancy information for a drug",
)
app.add_api_route(
    "/api/drugs/{drug_id}/pharmacology",
    _sub_endpoint("get_drug_pharmacology"),
    methods=["GET"], response_model=List[dict], tags=["Query"],
    summary="Pharmacology data for a drug",
)
app.add_api_route(
    "/api/drugs/{drug_id}/administration",
    _sub_endpoint("get_drug_administration"),
    methods=["GET"], response_model=List[dict], tags=["Query"],
    summary="Administration guidelines for a drug",
)
app.add_api_route(
    "/api/drugs/{drug_id}/suggested-dosing",
    _sub_endpoint("get_drug_suggested_dosing"),
    methods=["GET"], response_model=List[dict], tags=["Query"],
    summary="Suggested dosing for a drug",
)
app.add_api_route(
    "/api/drugs/{drug_id}/suggested-uses",
    _sub_endpoint("get_drug_suggested_uses"),
    methods=["GET"], response_model=List[dict], tags=["Query"],
    summary="Suggested uses for a drug",
)
app.add_api_route(
    "/api/drugs/{drug_id}/nutrition",
    _sub_endpoint("get_drug_nutrition"),
    methods=["GET"], response_model=List[dict], tags=["Query"],
    summary="Nutrition data for a drug",
)
app.add_api_route(
    "/api/drugs/{drug_id}/subcategory-listing",
    _sub_endpoint("get_drug_subcategory_listing"),
    methods=["GET"], response_model=List[dict], tags=["Query"],
    summary="Subcategory listing rows for a drug",
)
app.add_api_route(
    "/api/drugs/{drug_id}/name-components",
    _sub_endpoint("get_drug_name_components"),
    methods=["GET"], response_model=List[dict], tags=["Query"],
    summary="Searchable name components for a drug (DMS-origin)",
)
app.add_api_route(
    "/api/drugs/{drug_id}/dms-extensions",
    _sub_endpoint("get_drug_dms_extensions"),
    methods=["GET"], response_model=List[dict], tags=["Query"],
    summary="DMS extension fields (ham, price, route, arabic_route, notes, arabic_trade_name)",
)
app.add_api_route(
    "/api/drugs/{drug_id}/fda-products",
    _sub_endpoint("get_drug_fda_products"),
    methods=["GET"], response_model=List[dict], tags=["Query"],
    summary="FDA products for a drug",
)
app.add_api_route(
    "/api/drugs/{drug_id}/fda-submissions",
    _sub_endpoint("get_drug_fda_submissions"),
    methods=["GET"], response_model=List[dict], tags=["Query"],
    summary="FDA submissions for a drug",
)
app.add_api_route(
    "/api/drugs/{drug_id}/fda-extensions",
    _sub_endpoint("get_drug_fda_extensions"),
    methods=["GET"], response_model=List[dict], tags=["Query"],
    summary="FDA marketing and ingredient metadata for a drug",
)
# ─────────────────────────────────────────────────────────────────────────────
#  CRUD  —  Create / Update / Delete
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/api/drugs", response_model=dict, status_code=201, tags=["Mutation"])
async def create_drug(
    drug: DrugCreate,
    db: UnifiedDrugDatabaseController = Depends(get_db),
):
    """Create a new drug entry with optional sub-table data."""
    try:
        drug_data = drug.model_dump(exclude_unset=True)
        _reject_immutable_write_fields(drug_data)
        for field in IMMUTABLE_WRITE_FIELDS:
            drug_data.pop(field, None)
        drug_id  = db.insert_drug(**drug_data)
        snapshot = db.get_drug_by_id(drug_id) or {}
        # Sync new drug to Meilisearch (non-fatal)
        try:
            if snapshot and meilisearch_service.is_available():
                meilisearch_service.sync_drug(snapshot)
        except Exception as ms_exc:
            logger.warning(f"Meilisearch sync after create failed (non-fatal): {ms_exc}")
        return _strip_public_internal_fields(snapshot)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"create_drug failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/drugs/{drug_id}", response_model=dict, tags=["Mutation"])
async def update_drug(
    drug_id: int      = PathParam(..., description="Drug ID"),
    drug:    DrugUpdate = None,  # type: ignore
    db: UnifiedDrugDatabaseController = Depends(get_db),
):
    """
    Partial update of a drug. Only supplied fields are changed.
    For sub-tables, all existing rows are replaced with the provided array.
    """
    try:
        drug_data = drug.model_dump(exclude_unset=True)
        _reject_immutable_write_fields(drug_data)
        for field in IMMUTABLE_WRITE_FIELDS:
            drug_data.pop(field, None)
        db.update_drug(drug_id, **drug_data)
        snapshot = db.get_drug_by_id(drug_id) or {}
        # Sync updated drug to Meilisearch (non-fatal)
        try:
            if snapshot and meilisearch_service.is_available():
                meilisearch_service.sync_drug(snapshot)
        except Exception as ms_exc:
            logger.warning(f"Meilisearch sync after update failed (non-fatal): {ms_exc}")
        return _strip_public_internal_fields(snapshot)
    except DrugNotFoundError:
        raise HTTPException(status_code=404, detail=f"Drug {drug_id} not found")
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"update_drug({drug_id}) failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/drugs/{drug_id}", response_model=dict, tags=["Mutation"])
async def delete_drug(
    drug_id: int = PathParam(..., description="Drug ID"),
    db: UnifiedDrugDatabaseController = Depends(get_db),
):
    """Soft-delete a drug by marking its version rows deleted."""
    try:
        deleted = db.delete_drug(drug_id)
        if not deleted:
            raise HTTPException(status_code=404, detail=f"Drug {drug_id} not found")
        # Remove from Meilisearch (non-fatal)
        try:
            if meilisearch_service.is_available():
                meilisearch_service.delete_drug_document(drug_id)
        except Exception as ms_exc:
            logger.warning(f"Meilisearch delete after drug removal failed (non-fatal): {ms_exc}")
        return {"message": f"Drug {drug_id} soft-deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"delete_drug({drug_id}) failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────────────────────────────────────
#  Meilisearch admin endpoints
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/search/health", response_model=dict, tags=["Search"])
async def search_health():
    """
    Check whether Meilisearch is reachable.

    Returns ``{"available": true, "url": "..."}`` when healthy,
    ``{"available": false, ...}`` when Meilisearch is down
    (the drug API continues to work with MySQL LIKE fallback).
    """
    available = meilisearch_service.is_available()
    return {
        "available": available,
        "url":       meilisearch_service.MEILISEARCH_URL,
        "mode":      "meilisearch" if available else "mysql-fallback",
    }


@app.post("/api/search/sync", response_model=dict, tags=["Search"])
async def sync_search_index(db: UnifiedDrugDatabaseController = Depends(get_db)):
    """
    Trigger a full re-index of all current drugs into Meilisearch.

    This is an admin / maintenance endpoint — call it once after initial
    setup or whenever you need to rebuild the index from scratch.

    Returns ``{"indexed": N, "errors": M, "total": T}``.
    """
    if not meilisearch_service.is_available():
        raise HTTPException(
            status_code=503,
            detail=(
                f"Meilisearch not reachable at {meilisearch_service.MEILISEARCH_URL}. "
                "Make sure the meilisearch container is running."
            ),
        )
    try:
        result = meilisearch_service.sync_all_drugs(db)
        return result
    except Exception as exc:
        logger.error(f"sync_search_index failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/api/search/sync/{drug_id}", response_model=dict, tags=["Search"])
async def sync_single_drug(
    drug_id: int = PathParam(..., description="Drug ID to re-index"),
    db: UnifiedDrugDatabaseController = Depends(get_db),
):
    """Re-index a single drug in Meilisearch."""
    if not meilisearch_service.is_available():
        raise HTTPException(status_code=503, detail="Meilisearch not reachable")
    try:
        drug = db.get_drug_by_id(drug_id)
        if drug is None:
            raise HTTPException(status_code=404, detail=f"Drug {drug_id} not found")
        ok = meilisearch_service.sync_drug(drug)
        return {"drug_id": drug_id, "synced": ok}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"sync_single_drug({drug_id}) failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


# ─────────────────────────────────────────────────────────────────────────────
#  Entry point
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    from pathlib import Path

    # Only watch .py files — prevents DB writes (cache, WAL) from
    # triggering a reload loop regardless of exclude patterns.
    _script_dir = str(Path(__file__).resolve().parent)

    uvicorn.run(
        "api_server:app",
        host            = API_HOST,
        port            = API_PORT,
        reload          = True,
        reload_dirs     = [_script_dir],
        reload_includes = ["*.py"],
        reload_excludes = ["*.db", "*.db-wal", "*.db-shm", "*.db-tmp",
                           "*.json", "*.csv", "*.sql"],
        log_level       = "info",
    )

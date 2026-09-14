"""Integration smoke tests for the versioned MySQL drug schema.

These tests intentionally target the new application contract instead of the
old SQLite ``drugs`` fixture. They skip when a MySQL test database is not
available, and the mutating create/update/delete flow is opt-in via
``RUN_DRUG_API_MUTATION_TESTS=1``.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

pytest.importorskip("mysql.connector")

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("MYSQL_PASSWORD", "example")
os.environ.setdefault("MYSQL_CONNECT_RETRIES", "1")
os.environ.setdefault("MYSQL_CONNECT_RETRY_DELAY", "0")

import api_server  # noqa: E402
from db_controller import UnifiedDrugDatabaseController  # noqa: E402


REQUIRED_TABLES = {
    "drug_versions",
    "drug_master",
    "drug_dms_extensions",
    "drug_dosage_forms",
    "drug_dosing",
    "drug_adverse_effects",
    "drug_warnings",
    "drug_interactions",
    "drug_pregnancy",
    "drug_pharmacology",
    "drug_administration",
    "drug_suggested_dosing",
    "drug_suggested_uses",
    "drug_nutrition",
    "drug_classes",
    "drug_subcategory_listing",
    "drug_fda_ids",
    "drug_fda_products",
    "drug_fda_submissions",
    "drug_fda_extensions",
    "drug_fda_payload_hashes",
    "__init_sentinel",
}

FDA_TABLES = [
    "drug_fda_products",
    "drug_fda_submissions",
    "drug_fda_extensions",
]


@pytest.fixture(scope="session")
def db() -> UnifiedDrugDatabaseController:
    controller = UnifiedDrugDatabaseController(
        host=os.getenv("MYSQL_HOST", "localhost"),
        port=int(os.getenv("MYSQL_PORT", "3306")),
        user=os.getenv("MYSQL_USER", "root"),
        password=os.getenv("MYSQL_PASSWORD", "example"),
        database=os.getenv("MYSQL_DATABASE", "dms_db"),
        cache_maxsize=16,
        cache_ttl=30,
    )
    try:
        controller.execute_query("SELECT 1 AS ok")
        tables = set(controller.list_tables())
    except Exception as exc:  # pragma: no cover - environment dependent
        pytest.skip(f"MySQL drug test database is unavailable: {exc}")

    missing = sorted(REQUIRED_TABLES.difference(tables))
    if missing:
        controller.close()
        pytest.skip(f"MySQL drug test database is missing new-schema tables: {missing}")

    yield controller
    controller.close()


@pytest.fixture()
def client(db: UnifiedDrugDatabaseController):
    api_server.db_controller = db
    api_server.app.dependency_overrides[api_server.get_db] = lambda: db
    test_client = TestClient(api_server.app)
    try:
        yield test_client
    finally:
        test_client.close()
        api_server.app.dependency_overrides.clear()


def _first_current_drug_with_fda(db: UnifiedDrugDatabaseController) -> int | None:
    union_sql = " UNION ALL ".join(f"SELECT version_id FROM {table}" for table in FDA_TABLES)
    rows = db.execute_query(
        "SELECT dv.drug_id "
        "FROM drug_versions dv "
        f"JOIN ({union_sql}) fda ON fda.version_id = dv.version_id "
        "WHERE dv.is_current = 1 AND COALESCE(dv.is_deleted, 0) = 0 "
        "LIMIT 1"
    )
    return int(rows[0]["drug_id"]) if rows else None


def _first_current_drug_without_fda(db: UnifiedDrugDatabaseController) -> int | None:
    union_sql = " UNION ALL ".join(f"SELECT version_id FROM {table}" for table in FDA_TABLES)
    rows = db.execute_query(
        "SELECT dv.drug_id "
        "FROM drug_versions dv "
        "WHERE dv.is_current = 1 AND COALESCE(dv.is_deleted, 0) = 0 "
        f"AND NOT EXISTS (SELECT 1 FROM ({union_sql}) fda WHERE fda.version_id = dv.version_id) "
        "LIMIT 1"
    )
    return int(rows[0]["drug_id"]) if rows else None


def test_new_schema_tables_and_sentinel_exist(db: UnifiedDrugDatabaseController):
    assert REQUIRED_TABLES.issubset(set(db.list_tables()))
    sentinel = db.execute_query("SELECT status FROM __init_sentinel LIMIT 1")
    assert sentinel


def test_health_and_stats_use_versioned_current_records(client: TestClient):
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json()["status"] == "healthy"

    stats = client.get("/api/stats")
    assert stats.status_code == 200
    payload = stats.json()
    assert payload["total_drugs"] > 0
    assert payload["total_versions"] >= payload["total_drugs"]
    assert "total_fda_submissions" in payload


def test_search_returns_current_not_deleted_schema(client: TestClient):
    response = client.get("/api/drugs/search", params={"per_page": 5})
    assert response.status_code == 200
    payload = response.json()
    assert payload["results"]

    row = payload["results"][0]
    assert row["drug_id"]
    assert row["version_id"]
    assert row["is_current"] == 1
    assert row.get("is_deleted") in (0, None, False)
    assert "generic_name" in row
    assert isinstance(row.get("dosage_forms"), list)
    assert isinstance(row.get("drug_dms_extensions"), list)
    assert isinstance(row.get("has_fda"), bool)


def test_full_detail_includes_fda_arrays_when_present(
    client: TestClient,
    db: UnifiedDrugDatabaseController,
):
    drug_id = _first_current_drug_with_fda(db)
    if drug_id is None:
        pytest.skip("No current non-deleted drug with FDA rows in this database.")

    response = client.get(f"/api/drugs/{drug_id}")
    assert response.status_code == 200
    payload = response.json()
    assert payload["drug_id"] == drug_id
    assert payload["is_current"] == 1
    assert "fda_ids" not in payload
    assert "fda_payload_hashes" not in payload
    assert any(payload.get(key) for key in ("fda_products", "fda_submissions", "fda_extensions"))


def test_full_detail_handles_drugs_without_fda_rows(
    client: TestClient,
    db: UnifiedDrugDatabaseController,
):
    drug_id = _first_current_drug_without_fda(db)
    if drug_id is None:
        pytest.skip("No current non-deleted drug without FDA rows in this database.")

    response = client.get(f"/api/drugs/{drug_id}")
    assert response.status_code == 200
    payload = response.json()
    assert payload["drug_id"] == drug_id
    assert "fda_ids" not in payload
    assert "fda_payload_hashes" not in payload
    for key in ("fda_products", "fda_submissions", "fda_extensions"):
        assert isinstance(payload.get(key), list)


def test_immutable_top_level_and_nested_fields_are_rejected(client: TestClient):
    top_level = client.post("/api/drugs", json={"generic_name": "Immutable Test", "version_id": 1})
    assert top_level.status_code == 400
    assert "Immutable fields" in top_level.json()["detail"]

    nested = client.post(
        "/api/drugs",
        json={
            "generic_name": "Immutable Nested Test",
            "fda_products": [{"id": 1, "product_ndc": "00000-000", "application_number": "NDA000000"}],
        },
    )
    assert nested.status_code == 400
    assert "fda_products[0].id" in nested.json()["detail"]

    internal_ids = client.post(
        "/api/drugs",
        json={
            "generic_name": "Internal FDA IDs Test",
            "fda_ids": [{"id_type": "application_number", "id_value": "NDA000000"}],
        },
    )
    assert internal_ids.status_code == 422

    internal = client.post(
        "/api/drugs",
        json={
            "generic_name": "Internal Payload Hash Test",
            "fda_payload_hashes": [{"endpoint": "test", "payload_hash": "0" * 64}],
        },
    )
    assert internal.status_code == 422


@pytest.mark.skipif(
    os.getenv("RUN_DRUG_API_MUTATION_TESTS") != "1",
    reason="Set RUN_DRUG_API_MUTATION_TESTS=1 to mutate the MySQL test database.",
)
def test_create_update_fda_and_soft_delete_flow(
    client: TestClient,
    db: UnifiedDrugDatabaseController,
):
    create_payload = {
        "generic_name": "Codex Schema Smoke",
        "brand_names": "Codex Brand",
        "source": "DMS",
        "drug_dms_extensions": [{"ham": 0, "price": 12.5, "route": "[\"ORAL\"]", "arabic_route": "[]"}],
        "dosage_forms": [{"population": "adult", "form_name": "tablet", "strength_text": "10 mg"}],
        "dosing": [{"population": "adult", "indication": "smoke_test", "sub_indication": None, "list_header": None, "notes_text": "1 tablet daily"}],
        "fda_products": [{"product_ndc": "00000-001", "application_number": "NDA000000"}],
    }
    created = client.post("/api/drugs", json=create_payload)
    assert created.status_code == 201
    drug_id = created.json()["drug_id"]
    assert "fda_ids" not in created.json()
    assert created.json()["fda_products"]

    updated = client.put(
        f"/api/drugs/{drug_id}",
        json={
            "fda_products": [{"product_ndc": "00000-000", "application_number": "NDA000000"}],
        },
    )
    assert updated.status_code == 200
    assert updated.json()["fda_products"]
    assert "fda_payload_hashes" not in updated.json()

    deleted = client.delete(f"/api/drugs/{drug_id}")
    assert deleted.status_code == 200
    assert client.get(f"/api/drugs/{drug_id}").status_code == 404

    version_rows = db.execute_query(
        "SELECT COUNT(*) AS n, SUM(COALESCE(is_deleted, 0)) AS deleted_count "
        "FROM drug_versions WHERE drug_id = %s",
        (drug_id,),
    )
    assert version_rows[0]["n"] >= 1
    assert version_rows[0]["deleted_count"] == version_rows[0]["n"]

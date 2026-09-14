import argparse
import os
import requests


def fetch_drug(api_base_url: str, drug_id: int) -> dict:
    url = f"{api_base_url.rstrip('/')}/api/drugs/{drug_id}"
    response = requests.get(url, timeout=10)
    response.raise_for_status()
    return response.json()


def main():
    parser = argparse.ArgumentParser(description="Fetch full data for a specific drug from api_server")
    parser.add_argument("drug_id", type=int, help="Numeric ID of the drug to fetch")
    parser.add_argument(
        "--host",
        default=os.environ.get("API_HOST", "127.0.0.1"),
        help="API server host (default: 127.0.0.1 or API_HOST env var)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("API_PORT", "8000")),
        help="API server port (default: 8000 or API_PORT env var)",
    )

    args = parser.parse_args()

    api_base_url = f"http://{args.host}:{args.port}"
    data = fetch_drug(api_base_url, args.drug_id)

    print(data)


if __name__ == "__main__":
    main()

# example run: 
# python -m drug-repo\test\quick_fetch_drug 123
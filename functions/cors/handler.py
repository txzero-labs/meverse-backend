from typing import Any, Dict

CORS_HEADERS: Dict[str, str] = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
}


def lambda_handler(_event: Dict[str, Any], _context: Dict[str, Any]) -> Dict[str, Any]:
    return {"statusCode": 204, "headers": CORS_HEADERS}

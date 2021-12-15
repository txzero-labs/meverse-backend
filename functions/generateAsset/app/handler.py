import io
import json
import os
from typing import Any, Dict, Optional, Union, cast

import boto3
from boto3.exceptions import Boto3Error
from PIL import Image

from . import logger
from .exception import ValidationError

s3 = boto3.resource("s3")
dynamodb = boto3.client("dynamodb")

GROUP_TO_ID: Dict[str, int] = {
    "adventurer": 0,
    "chad": 1,
    "commander": 2,
    "defender": 3,
    "thinker": 4,
}

MAX_ASSETS_PER_WALLET: int = int(os.environ.get("MAX_ASSETS_PER_WALLET", 3))
ASSET_DYNAMODB_TABLE: str = os.environ.get("ASSET_DYNAMODB_TABLE", "Asset")
S3_BUCKET: str = os.environ.get("S3_BUCKET", "meverse-dev")


def lambda_handler(event: Dict[str, Any], _context: Dict[str, Any]) -> Dict[str, Any]:
    request_body = event["body"]
    wallet_address = request_body["wallet"]

    try:
        validate_selected_items(request_body)
        validate_max_assets_per_wallet(wallet_address)
        validate_trait_uniqueness(request_body)
    except ValidationError as error:
        return {
            "statusCode": 400,
            "body": json.dumps({"message": str(error)}),
        }
    except Boto3Error:
        logger.error("DynamoDB request failed", exc_info=True)
        return {
            "statusCode": 500,
            "body": json.dumps({"message": "Service temporarily unavailable."}),
        }

    traits_bitstring = build_traits_bitstring(request_body)

    merge_image_layers(request_body, traits_bitstring)
    save_wallet_traits(wallet_address, traits_bitstring)

    return {
        "statusCode": 200,
        "body": json.dumps({"traits": traits_bitstring}),
    }


def validate_selected_items(  # pylint: disable=too-many-branches
    request_body: Dict[str, Any]
) -> None:
    if safe_get(request_body, "group") not in GROUP_TO_ID:
        raise ValidationError("Invalid selected group.")

    if safe_get(request_body, "faceId") not in {0, 1}:
        raise ValidationError("Invalid face ID.")

    if safe_get(request_body, "poseId") not in {0, 1, 2}:
        raise ValidationError("Invalid body pose ID.")

    right_hand = safe_get(request_body, "rightHandItemId")
    if right_hand is not None:
        right_hand = cast(int, right_hand)
        group = request_body["group"]
        pose_id = request_body["poseId"]

        if group == "adventurer":
            if pose_id == 1 and (right_hand < 0 or right_hand > 3):
                raise ValidationError(
                    f"Invalid right hand item given {group=} and {pose_id=}"
                )
            if pose_id == 2 and (right_hand < 0 or right_hand > 1):
                raise ValidationError(
                    f"Invalid right hand item given {group=} and {pose_id=}"
                )

        if group == "defender":
            if pose_id == 1 and (right_hand < 0 or right_hand > 6):
                raise ValidationError(
                    f"Invalid right hand item given {group=} and {pose_id=}"
                )
            if pose_id == 2 and (right_hand < 0 or right_hand > 3):
                raise ValidationError(
                    f"Invalid right hand item given {group=} and {pose_id=}"
                )

        if group in {"chad", "commander"} and pose_id == 2:
            if right_hand > 4 or right_hand < 0:
                raise ValidationError(
                    f"Invalid right hand item given {group=} and {pose_id=}"
                )

        if group == "thinker" and pose_id == 2:
            if right_hand > 3 or right_hand < 0:
                raise ValidationError(
                    f"Invalid right hand item given {group=} and {pose_id=}"
                )

    if "items" not in request_body:
        raise ValidationError("Invalid request body: missing items field.")

    _validate_item(request_body, field="head", max_value=38)
    _validate_item(request_body, field="background", max_value=10)
    _validate_item(request_body, field="chest", max_value=19)
    _validate_item(request_body, field="legs", max_value=15)
    _validate_item(request_body, field="boots", max_value=15)
    _validate_item(request_body, field="accessory", max_value=9)
    _validate_item(request_body, field="hand", max_value=28)


def _validate_item(request_body: Dict[str, Any], field: str, max_value: int) -> None:
    if (item := cast(int, safe_get(request_body["items"], field))) is not None:
        if item < 0 or item > max_value:
            raise ValidationError(f"Invalid {field} item.")


def safe_get(body: Dict[str, Any], field: str) -> Optional[Union[str, int]]:
    try:
        return body[field]
    except KeyError:
        return None


def field_exists(body: Dict[str, Any], field: str) -> bool:
    return field in body and body[field] is not None


def validate_max_assets_per_wallet(wallet_address: str) -> None:
    count = count_generated_assets(wallet_address)

    logger.info(f"Wallet {wallet_address} minted {count} NFTs")

    if count == MAX_ASSETS_PER_WALLET:
        raise ValidationError("The maximum number of NFTs per wallet is minted.")


def validate_trait_uniqueness(request_body: Dict[str, Any]) -> None:
    traits_bitstring = build_traits_bitstring(request_body)

    response = dynamodb.scan(
        TableName=ASSET_DYNAMODB_TABLE,
        ConsistentRead=True,
        Select="COUNT",
        ScanFilter={
            "Traits": {
                "AttributeValueList": [{"S": traits_bitstring}],
                "ComparisonOperator": "CONTAINS",
            }
        },
    )

    if response["Count"] > 0:
        raise ValidationError("Selected items are not unique.")


def count_generated_assets(wallet_address: str) -> int:
    response = dynamodb.get_item(
        TableName=ASSET_DYNAMODB_TABLE,
        Key={"WalletAddress": {"S": wallet_address}},
        ConsistentRead=True,
        AttributesToGet=["Traits"],
    )
    if "Item" in response:
        traits = response["Item"]["Traits"]["SS"]
        return len(traits)
    return 0


def build_traits_bitstring(request_body: Dict[str, Any]) -> str:
    group = int_to_bin(GROUP_TO_ID[request_body["group"].lower()], bits=3)
    founder = "0"
    background = int_to_bin(request_body["items"]["background"], bits=4)
    head = int_to_bin(request_body["items"]["head"], bits=6)
    face = int_to_bin(request_body["faceId"], bits=1)
    chest = int_to_bin(request_body["items"]["chest"], bits=5)
    pose = int_to_bin(request_body["poseId"], bits=2)
    legs = int_to_bin(request_body["items"]["legs"], bits=4)
    boots = int_to_bin(request_body["items"]["boots"], bits=4)
    accessory = int_to_bin(request_body["items"]["accessory"], bits=4)
    left_hand = int_to_bin(request_body["items"]["hand"], bits=5)
    right_hand = int_to_bin(request_body["rightHandItemId"], bits=3)
    return (
        group
        + founder
        + background
        + head
        + face
        + chest
        + pose
        + legs
        + boots
        + accessory
        + left_hand
        + right_hand
    )


def int_to_bin(x: int, bits: int) -> str:
    encoded = bin(x)[2:]
    return "0" * (bits - len(encoded)) + encoded


def save_wallet_traits(wallet_address: str, traits_bitstring: str) -> None:
    dynamodb.update_item(
        TableName=ASSET_DYNAMODB_TABLE,
        Key={"WalletAddress": {"S": wallet_address}},
        UpdateExpression="ADD Traits :trait",
        ExpressionAttributeValues={":trait": {"SS": [traits_bitstring]}},
    )


def merge_image_layers(request_body: Dict[str, Any], traits_bitstring: str) -> None:
    items = request_body["items"]
    group = request_body["group"].lower()
    pose_id = request_body["poseId"]
    is_universal_pose = pose_id == 2

    layer_keys = [
        f"backgrounds/{items['background']}.png",
        "base.png",
        f"faces/{group}/{request_body['faceId']}.png",
        f"boots/{items['boots']}.png",
        f"legs/{items['legs']}.png",
    ]

    chest_path: str
    if is_universal_pose:
        chest_path = f"chests/{items['chest']}/universal/0.png"
    else:
        chest_path = f"chests/{items['chest']}/{group}/{pose_id}.png"
    layer_keys.append(chest_path)

    if (accessory := items["accessory"]) < 9:
        layer_keys.append(f"accessories/{accessory}.png")

    layer_keys.append(f"heads/{items['head']}.png")

    if (left_hand := items["hand"]) < 28:
        layer_keys.append(f"lhands/{left_hand}.png")

    if (right_hand := request_body["rightHandItemId"]) is not None:
        layer_keys.append(
            f"rhands/{group}/{'universal' if is_universal_pose else pose_id}"
            f"/{right_hand}.png"
        )

    layers = [get_png_from_s3(f"layers/{key}") for key in layer_keys]

    image = Image.new("RGBA", (350, 350), (255, 0, 0, 0))
    for layer in layers:
        if layer.mode == "RGB":
            alpha_channel = Image.new("L", layer.size, 255)
            layer.putalpha(alpha_channel)

        image.paste(layer, (0, 0), layer)

    put_png_to_s3(image, key=f"meridians/{traits_bitstring}.png")


def get_png_from_s3(key: str) -> Image:
    logger.info(f"GetObject {key}")

    image_object = s3.Object(S3_BUCKET, key)
    response = image_object.get()
    file_stream = response["Body"]
    image = Image.open(file_stream)
    return image


def put_png_to_s3(image: Image, key: str) -> None:
    mem_file = io.BytesIO()
    image.save(mem_file, format="PNG")
    s3.Object(S3_BUCKET, key).put(Body=mem_file.getvalue())

    logger.info(f"Uploaded merged image '{key}' to S3")

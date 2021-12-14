import json
import requests
import boto3

S3 = boto3.resource("s3")

def lambda_handler(event, context):
    ip = requests.get("http://checkip.amazonaws.com/")

    bucket = S3.Bucket('meverse-dev')
    folders = " ".join([o.key for o in bucket.objects.all()])

    return {
        "statusCode": 200,
        "body": json.dumps({
            "location": ip.text.replace("\n", ""),
            "folders": folders
        }),
    }
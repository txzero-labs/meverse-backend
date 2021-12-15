const { DynamoDBClient, GetItemCommand } = require("@aws-sdk/client-dynamodb");
const { unmarshall } = require("@aws-sdk/util-dynamodb");
const tiny = require('tiny-json-http');

const response = (statusCode, jsonData) => {
  return {
    statusCode: statusCode,
    headers: {
      "Content-Type": "application/json",
    },
    isBase64Encoded: false,
    body: jsonData,
  };
};

exports.handler = async (event, context) => {
  const dynamodb = new DynamoDBClient({ region: process.env.REGION });
  const tableName = process.env.DYNAMO_METADATA_TABLE;
  const partitionKeyName = "TokenId";

  var params = {};
    try {
      params[partitionKeyName] = {"N": event.pathParameters.id};
    } catch(err) {
      return response(500, JSON.stringify({error: 'Id value has wrong type. ' + err}));
    }

    let getItemParams = {
      TableName: tableName,
      Key: params,
      ProjectionExpression: "metadata"
    }
    const getCommand = new GetItemCommand(getItemParams);
    try {
      const data = await dynamodb.send(getCommand);
      if (data.Item == undefined || data.Item == null) {
        return response(404, JSON.stringify({error: `Could not find item with id: ${event.pathParameters.id}`}));
      } else {
        const metadataItem = unmarshall(data.Item);

        const metadataHash = metadataItem.metadata;
        const metadataURI = `${process.env.METADATA_URI}/${metadataHash}`;

        console.info('Sending request to: ' + metadataURI);

        try {
            const res = await tiny.get({url: metadataURI});
            return response(200, JSON.stringify(res.body));
        } catch (error) {
            console.log(error);
            return response(500, JSON.stringify({error: 'Unable to fetch metadata for tokenId: ' + event.pathParameters.id}));
        }
      }
    } catch (err) {
      return response(500, JSON.stringify({ error: err.message }));
    };
};
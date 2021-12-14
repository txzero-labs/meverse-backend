const {
  DynamoDBClient,
  ListTablesCommand,
} = require("@aws-sdk/client-dynamodb");

exports.handler = async (event, context) => {
  const client = new DynamoDBClient({ region: "eu-central-1" });
  const command = new ListTablesCommand({});

  var results = {};
  try {
    results = await client.send(command);
    console.log(results.TableNames.join("\n"));
  } catch (err) {
    console.error(err);
  }

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
    },
    isBase64Encoded: false,
    body: results,
  };
};

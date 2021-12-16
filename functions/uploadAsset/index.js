const { DynamoDBClient, PutItemCommand, UpdateItemCommand } = require("@aws-sdk/client-dynamodb")
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");

const pinataSDK = require('@pinata/sdk');
const exceptions = require('./exception');
const utils = require('./utils');
const { createAlchemyWeb3 } = require("@alch/alchemy-web3");
const { vol } = require("memfs");

const contractABIPath = './contracts/meridian.sol/Meridian.json';

let metadataTable = process.env.DYNAMO_METADATA_TABLE;
let walletTable = process.env.DYNAMO_WALLET_TABLE;

const response = (statusCode, jsonData) => {
  return {
    statusCode: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type",
    },
    isBase64Encoded: false,
    body: jsonData,
  };
};


const traitPlaceholder = (traitName, traitValue) => {
  switch(traitName) {
    case "group": return {
      "trait_type": "Group",
      "value": utils.groupTrait(traitValue)
    };
    case "head": return {
      "trait_type": "Head",
      "value": utils.headTrait(traitValue)
    };
    case "chest": return {
      "trait_type": "Chest",
      "value": utils.chestTrait(traitValue)
    };
    case "legs": return {
      "trait_type": "Legs",
      "value": utils.legsTrait(traitValue)
    };
    case "boots": return {
      "trait_type": "Boots",
      "value": utils.bootsTrait(traitValue)
    };
    case "hand": return {
      "trait_type": "Hand",
      "value": utils.handTrait(traitValue)
    };
    case "background": return {
      "trait_type": "Background",
      "value": utils.backgroundTrait(traitValue)
    };
    case "accessory": return {
      "trait_type": "Accessory",
      "value": utils.accessoriesTrait(traitValue)
    };
    default: {
      throw new exceptions.NoTraitIndexError("No trait type for index: " + traitIndex);
    }
  }
}

// Metadata traits
const prepareTraits = (traitsMap) => {
  var traits = [];

  for (var traitName in traitsMap) {
    var traitValue = traitsMap[traitName];

    traitObj = traitPlaceholder(traitName, traitValue);
    traits.push(traitObj);
  }

  return traits;
}

const metadataSetup = (tokenId, imageURI, attributes) => {
  var metadata = {};

  const name = "Meridian #" + tokenId;
  const description = "A chill Meridian inhabiting MeVerse."

  metadata.name = name;
  metadata.description = description;
  metadata.image = imageURI;
  metadata.attributes = attributes;
  metadata.external_url = '';

  return metadata;
};


const imageUpload = async (s3, imageS3Name, tokenId, pinata) => {
  var s3Params = {
    Bucket: process.env.S3_BUCKET,
    Key: imageS3Name,
  }

  const getObject = new GetObjectCommand(s3Params);
  try {
    const item = await s3.send(getObject);

    var imageName = tokenId + '.png';
    var pinataImageOptions = {
      pinataMetadata: {
        name: imageName
      }
    }

    try {
      const uploadedImage = await pinata.pinFileToIPFS(item.Body, pinataImageOptions);
      console.log(`Image: ${imageName} successfully uploaded to IPFS.`)
      return uploadedImage.IpfsHash; 
    } catch (err) {
      console.log(err);
      throw new exceptions.UnableToPinFileError("Unable to upload image to IPFS with name: " + imageName);
    };
  } catch (err) {
    console.log(err);
  }
}

const metadataUpload = async (metadataObj, tokenId, pinata) => {
  metadataName = tokenId + '.json';
  var pinataMetadataOptions = {
    pinataMetadata: {
      name: metadataName
    }
  }
  const jsonMetadata = JSON.stringify(metadataObj);
  var buffer = Buffer.from(jsonMetadata);
  if (!vol.existsSync('/tmp/')) {
      vol.mkdirSync('/tmp/');
  }

  if (!vol.existsSync(`/tmp/${metadataName}`)) {
      vol.writeFileSync(`/tmp/${metadataName}`, buffer);
  }

  const readableStream = vol.createReadStream(`/tmp/${metadataName}`);

  try {
    const uploadedFile = await pinata.pinFileToIPFS(readableStream, pinataMetadataOptions);
    console.log(`Metadata file: ${metadataName} successfully uploaded to IPFS.`)
    return uploadedFile.IpfsHash;
  } catch(err) {
    console.log(err);
    throw new exceptions.UnableToPinFileError("Unable to upload metadata file to IPFS with name: " + metadataName);
  };
};

const saveMetadata = async (dynamodb, metadataTable, tokenId, metadataHash, imageHash) => {
  let params = {
    TableName: metadataTable,
    Item: {
      TokenId: {"N": tokenId},
      Metadata: {"S": metadataHash},
      Image: {"S": imageHash},
    }
  }
  const putItem = new PutItemCommand(params);

  try {
    const data = await dynamodb.send(putItem);
    console.log(`Metadata hash: ${metadataHash} saved to DynamoDB for tokenId: ${tokenId}.`)
    return data;
  } catch (err) {
      throw new exceptions.DynamoDBInsertError(`Error inserting metadata for tokenId: ${tokenId}.`);
  }
};

const saveWalletAddress = async (dynamodb, walletTable, walletAddress, tokenId) => {
  let params = {
    TableName: walletTable,
    Key: {
      WalletAddress: {"S": walletAddress},
    },
    UpdateExpression: "ADD TokenIds :TokenIds",
    ExpressionAttributeValues: {
      ':TokenIds': {"SS": [tokenId]}
    },
    ReturnValues: "UPDATED_NEW"
  }; 
  const updateCommand = new UpdateItemCommand(params);

  try { 
    const data = await dynamodb.send(updateCommand);
    console.log(`Saved tokendId: ${tokenId} for walledAddress ${walletAddress}.`);
    return data;
  } catch(err) {
    throw new exceptions.DynamoDBInsertError("Error inserting wallet address: " + walletAddress);
  }
};

const getTokenId = async (meridianContract, callerAddress, walletAddress) => {
  try {
      const result = await meridianContract.methods.tokenForWallet(walletAddress).call({from: callerAddress});
      console.log(`Meridian contract successfully called tokenForWallet method for wallet: ${walletAddress}.`);
      var tokenId = parseInt(result);
      return tokenId;
  } catch(error) {
      console.log(error);
      throw new exceptions.ContractUnavailableError("Method tokenForWallet not available.");
  }
}

const getFounder = async (meridianContract, callerAddress, tokenId) => {
  try {
      const result = await meridianContract.methods.founder(tokenId).call({from: callerAddress});
      console.log(`Meridian contract successfully called founder method for tokenId: ${tokenId}.`);
      var founder = !!parseInt(result);
      return founder;

  } catch (error) {
    console.log(error);
    throw new exceptions.ContractUnavailableError("Method founder not available.");
  }
}

exports.handler = async (event, context) => {
    // Initialization
    if (event.body === null && event.body === undefined) {
      return response(400, {});
    }

    let body = JSON.parse(event.body);
    const dynamodb = new DynamoDBClient({ region: process.env.REGION });
    const pinata = pinataSDK(process.env.PINATA_KEY, process.env.PINATA_SECRET_KEY);
    const s3 = new S3Client({ region: process.env.REGION });

    const web3 = createAlchemyWeb3(process.env.ALCHEMY_API_URL);
    const contract = require(contractABIPath);

    const meridianContract = new web3.eth.Contract(contract.abi, process.env.CONTRACT_ADDRESS);

    const walletAddress = body.walletAddress;
    const imageName = body.imageName;

    if(!walletAddress || !imageName || !body.traits) {
      console.error("Invalid input parameters.");

      return response(
        400, 
        JSON.stringify({ 
          walletAddress: walletAddress, 
          imageName: imageName, 
          traits: body.traits
        })
      );
    }

    console.log("Preparing traits...")
    const traits = prepareTraits(body.traits);
    resObj = {
      walletAddress: walletAddress,
      imageName: imageName,
      traits: body.traits,
    };

    console.log(`Fetching last tokenId for wallet: ${walletAddress}.`);
    const tokenId = await getTokenId(meridianContract, process.env.CONTRACT_ADDRESS, walletAddress);
    console.log(`Last transaction tokenId: ${tokenId}`);
    resObj.tokenId = tokenId;

    const founder = await getFounder(meridianContract, process.env.CONTRACT_ADDRESS, tokenId);
    resObj.founder = founder;

    traits.push({
      "trait_type": "Founder",
      "value": founder
    });

    console.log(`Uploading image: ${imageName} to IPFS.`);
    const imageHash = await imageUpload(s3, imageName, tokenId, pinata);
    resObj.imageHash = imageHash;

    const imageURI = `${process.env.METADATA_URI}/${imageHash}`;
    const metadataFile = metadataSetup(tokenId, imageURI, traits);

    console.log(`Uploading metadata file for tokenId: ${tokenId} to IPFS.`);
    const metadataHash = await metadataUpload(metadataFile, tokenId, pinata);
    resObj.metadataHash = metadataHash;

    console.log(`Saving metadata hash: ${metadataHash} to DynamoDB.`);
    try {
      await saveMetadata(dynamodb, metadataTable, tokenId.toString(), metadataHash, imageHash);
    } catch (err) {
      console.log(err);
      return response(500, resObj)
    }

    console.log(`Saving tokenId: ${tokenId} for wallet: ${walletAddress} to DynamoDB.`);

    try {
      await saveWalletAddress(dynamodb, walletTable, walletAddress, tokenId.toString());
    } catch (err) {
      console.log(err);
      return response(500, JSON.stringify(resObj));
    }

    console.log("Assets have been uploaded and saved to database.");
    return response(200, JSON.stringify(resObj));
};
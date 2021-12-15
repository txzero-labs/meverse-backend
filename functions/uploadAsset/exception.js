class UnableToPinFileError extends Error {
    constructor(message) {
        super(message);

        this.name = this.constructor.name;

        Error.captureStackTrace(this, this.constructor);
    }
};

class DynamoDBInsertError extends Error {
    constructor(message) {
        super(message);

        this.name = this.constructor.name;

        Error.captureStackTrace(this.name, this.constructor);
    }
};

class ContractUnavailableError extends Error {
    constructor(message) {
        super(message);

        this.name = this.constructor.name;

        Error.captureStackTrace(this.name, this.constructor);
    }
}

class NoTraitIndexError extends Error {
    constructor(message) {
        super(message);

        this.name = this.constructor.name;

        Error.captureStackTrace(this.name, this.constructor);
    }
}

module.exports = { 
    UnableToPinFileError, 
    DynamoDBInsertError, 
    ContractUnavailableError,
    NoTraitIndexError,
};
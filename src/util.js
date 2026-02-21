'use strict';

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const generateId         = () => uuidv4();
const generateApiKey     = () => 'cc_' + crypto.randomBytes(24).toString('hex');
const generateClaimToken = () => crypto.randomBytes(20).toString('hex');
const now                = () => Date.now();

module.exports = { generateId, generateApiKey, generateClaimToken, now };

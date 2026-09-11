const express = require('express');
const { getDocuments, deleteDocuments } = require('../controllers/documentController');

const router = express.Router();

router.get('/', getDocuments);
router.delete('/', deleteDocuments);

module.exports = router;

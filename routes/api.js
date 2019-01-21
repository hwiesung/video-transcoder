var express = require('express');
var router = express.Router();
var admin = require("firebase-admin");

var serviceAccount = require("../serviceAccountKey.json");

var axios = require('axios');
var fs = require('fs');

var app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://peeple-7d3de.firebaseio.com",
    projectId: "peeple-7d3de",
    uid:"transcoder"
});


/* GET users listing. */
router.post('/notify/upload', function(req, res) {
    const url = req.body.url;
    const name = req.body.name;

    console.log(req.body);

    axios.request({
        responseType:'arraybuffer',
        url:url,
        method:'get'
    }).then((result)=>{
        const outputFilename = './temp/'+name;
        fs.writeFileSync(outputFilename, result.data);
        res.send(JSON.stringify({ret_code:0}));
    });

});

module.exports = router;

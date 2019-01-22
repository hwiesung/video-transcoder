var express = require('express');
var router = express.Router();
var admin = require("firebase-admin");

var serviceAccount = require("../serviceAccountKey.json");

var axios = require('axios');
var fs = require('fs');

var ffmpeg = require('fluent-ffmpeg');


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
        console.log('local saved');


        ffmpeg.ffprobe(outputFilename, (err, metadata)=>{
           if(err){
               console.log(err);
               res.send(JSON.stringify({ret_code:1, msg:'metadata load failed'}));
           }
           else{
               console.log('laod metadata');
               console.log(metadata.format);
               var command = ffmpeg(outputFilename).on('codecData', (data)=>{
                   console.log(data);
               }).on('start',()=>{
                   console.log('processing start');

               }).on('end',(stdout, stderr)=>{
                   console.log('end');
                   res.send(JSON.stringify({ret_code:0}));

               }).on('error', (err)=>{
                   console.log("error occured:"+err.message);
                   res.send(JSON.stringify({ret_code:1, msg:'transcoding failed'}));
               }).output('./temp/'+name+'.mp4').run();
           }

        });


    });

});

module.exports = router;

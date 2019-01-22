var express = require('express');
var router = express.Router();
var admin = require("firebase-admin");

var serviceAccount = require("../serviceAccountKey.json");
var awsKey = require("../awsKey.json");

var axios = require('axios');
var fs = require('fs');

const AWS = require('aws-sdk');
const s3 = new AWS.S3({
    accessKeyId: awsKey.access_key_id,
    secretAccessKey: awsKey.secret_access_key
});
var crypto = require('crypto');
var moment = require('moment');
var ffmpeg = require('fluent-ffmpeg');


var app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://peeple-7d3de.firebaseio.com",
    projectId: "peeple-7d3de",
    uid:"transcoder"
});


router.get('/test', function(req, res) {
    res.send(JSON.stringify({ret_code:0}));
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
        const tempFilePath = './temp/'+name;
        fs.writeFileSync(tempFilePath, result.data);
        console.log('local saved');


        ffmpeg.ffprobe(tempFilePath, (err, metadata)=>{
           if(err){
               console.log(err);
               res.send(JSON.stringify({ret_code:1, msg:'metadata load failed'}));
           }
           else{
               console.log('laod metadata');
               console.log(metadata.format);
               let key = crypto.randomBytes(32).toString('hex');

               const outputFileName = moment().valueOf()+'_'+key+'.mp4';
               const outputFilePath = './temp/'+outputFileName;

               ffmpeg(tempFilePath).on('codecData', (data)=>{
                   console.log(data);
               }).on('start',()=>{
                   console.log('processing start');

               }).on('end',(stdout, stderr)=>{
                   console.log('end');

                   fs.readFile(outputFilePath, (err, data) => {
                       if(err){
                           console.log(err);
                           res.send(JSON.stringify({ret_code:1, msg:'ouputFile read failed'}));
                       }
                       else{
                           const params = {
                               Bucket: 'peeple-video', // pass your bucket name
                               Key: outputFileName, // file will be saved as testBucket/contacts.csv
                               Body: JSON.stringify(data, null, 2)
                           };
                           console.log("start upload");
                           s3.upload(params, function(s3Err, data) {
                               if (s3Err){
                                   console.log(s3Err);
                                   res.send(JSON.stringify({ret_code:1, msg:'s3 upload failed'}));
                                   throw s3Err;

                               }
                               console.log('File uploaded successfully at '+ data.Location);
                               fs.unlinkSync(outputFilePath);
                               fs.unlinkSync(tempFilePath);
                               res.send(JSON.stringify({ret_code:0}));
                           });

                       }
                   });

               }).on('error', (err)=>{
                   console.log("error occured:"+err.message);
                   res.send(JSON.stringify({ret_code:1, msg:'transcoding failed'}));
               }).output(outputFilePath).run();
           }

        });


    });

});

module.exports = router;

var express = require('express');
var router = express.Router();
var admin = require("firebase-admin");

var axios = require('axios');
var fs = require('fs');

const AWS = require('aws-sdk');

var crypto = require('crypto');
var moment = require('moment');
var ffmpeg = require('fluent-ffmpeg');

var config = require('config');

var logger = require('../common/logger');
const retCode = require('../common/retCode');

const s3 = new AWS.S3({
    accessKeyId: config.awsKey.access_key_id,
    secretAccessKey: config.awsKey.secret_access_key
});


var app = admin.initializeApp({
    credential: admin.credential.cert(config.serviceAccountKey),
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
    const secretKey = req.body.secret_key;
    logger.info('input data: '+ JSON.stringify(req.body));

    if(secretKey != config.serviceAccountKey.private_key_id){
        res.send(JSON.stringify({ret_code:retCode.WRONG_SECRET_KEY, msg:'Permission Denied'}));
        throw 'permission denied';
    }

    if(!url || !name){
        res.send(JSON.stringify({ret_code:retCode.ERROR, msg:'Invalid Input'}));
        throw 'input error';
    }



    axios.request({
        responseType:'arraybuffer',
        url:url,
        method:'get'
    }).then((result)=>{
        const tempFilePath = './temp/'+name;
        fs.writeFileSync(tempFilePath, result.data);
        logger.info('local temp file saved: '+tempFilePath);


        ffmpeg.ffprobe(tempFilePath, (err, metadata)=>{
           if(err){
               logger.error('metadata load fail');
               res.send(JSON.stringify({ret_code:retCode.FAIL_LOAD_METADATA, msg:'metadata load failed'}));
           }
           else{
               logger.info('metadata:'+JSON.stringify(metadata.format));

               let key = crypto.randomBytes(32).toString('hex');

               const outputFileName = moment().valueOf()+'_'+key+'.mp4';
               const outputFilePath = './temp/'+outputFileName;

               ffmpeg(tempFilePath).on('codecData', (data)=>{
                   logger.info('format:' + data.format +', video:'+data.video +', audio:'+data.audio+' , duration:'+data.duration);
               }).on('start',()=>{
                   logger.info('processing start');
               }).on('end',(stdout, stderr)=>{
                   logger.info('processing finish');

                   fs.readFile(outputFilePath, (err, data) => {
                       if(err){
                           logger.error('outputFile read failed');
                           res.send(JSON.stringify({ret_code:retCode.FAIL_READ_OUTPUT_FILE, msg:'ouputFile read failed'}));
                       }
                       else{

                           const params = {
                               Bucket: config.s3.bucket,
                               Key: outputFileName,
                               ContentType: 'video/mp4',
                               Body: data
                           };
                           logger.info("start upload file");
                           s3.upload(params, function(s3Err, result) {
                               if (s3Err){
                                   logger.error('s3 upload failed');
                                   res.send(JSON.stringify({ret_code:retCode.FAIL_UPLOAD_TO_S3, msg:'s3 upload failed'}));
                               }
                               else{
                                   logger.info('File uploaded successfully at '+ result.Location);
                                   //fs.unlinkSync(outputFilePath);
                                   fs.unlinkSync(tempFilePath);
                                   res.send(JSON.stringify({ret_code:0, file_key:outputFileName, bucket:config.s3.bucket, location:data.Location}));
                               }
                           });
                       }
                   });
               }).on('error', (err)=>{
                   logger.error('transcoding failed :' +err.message);
                   res.send(JSON.stringify({ret_code:retCode.FAIL_TRANSCODING, msg:'transcoding failed'}));
               }).output(outputFilePath).run();
           }
        });


    });

});

module.exports = router;

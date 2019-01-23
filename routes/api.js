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
    secretAccessKey: config.awsKey.secret_access_key,
    region:'ap-northeast-2'
});


var app = admin.initializeApp({
    credential: admin.credential.cert(config.firebase.serviceAccountKey),
    databaseURL: config.firebase.database,
    projectId: config.firebase.project_id,
    storageBucket: config.firebase.storage,
    databaseAuthVariableOverride: {
        uid: "transcoder"
    }
});


var bucket = admin.storage().bucket();


/* GET users listing. */
router.post('/notify/upload', function(req, res) {
    const path = req.body.path;
    const name = req.body.name;
    const secretKey = req.body.secret_key;
    logger.info('input data: '+ JSON.stringify(req.body));

    if(secretKey != config.firebase.serviceAccountKey.private_key_id){
        res.send(JSON.stringify({ret_code:retCode.WRONG_SECRET_KEY, msg:'Permission Denied'}));
        throw 'permission denied';
    }

    if(!path || !name){
        res.send(JSON.stringify({ret_code:retCode.ERROR, msg:'Invalid Input'}));
        throw 'input error';
    }

    const tempFilePath = './temp/'+name;

    bucket.file(path).download({destination: tempFilePath}).then(()=>{
        ffmpeg.ffprobe(tempFilePath, (err, metadata)=>{
            if(err){
                logger.error('metadata load fail');
                res.send(JSON.stringify({ret_code:retCode.FAIL_LOAD_METADATA, msg:'metadata load failed'}));
                throw 'metadata load failed';
            }

            //TODO : metadata 정보에 따른 분기 처리

            logger.info('metadata:'+JSON.stringify(metadata.format));

            let key = crypto.randomBytes(32).toString('hex');

            const outputFileName = moment().valueOf()+'_'+key+'.mp4';
            const outputFilePath = './temp/'+outputFileName;
            //const thumbnailName = moment().valueOf()+'_'+key+'.png';
            const thumbnailName = moment().valueOf()+'_'+key+'.png';
            const thumbnailPath = './temp/'+thumbnailName;

            let duration = Math.floor(metadata.format.duration / 2);
            ffmpeg(tempFilePath).on('codecData', (data)=>{
                logger.info('format:' + data.format +', video:'+data.video +', audio:'+data.audio+' , duration:'+data.duration);
            }).on('start',()=>{
                logger.info('processing start : ' + outputFileName);
            }).on('end',(stdout, stderr)=>{
                logger.info('processing finish : '+outputFileName);

                fs.readFile(outputFilePath, (err, data) => {
                    if(err){
                        logger.error('outputFile read failed');
                        res.send(JSON.stringify({ret_code:retCode.FAIL_READ_OUTPUT_FILE, msg:'ouputFile read failed'}));
                        throw 'outputFile read failed';
                    }

                    logger.info("start upload file :" + outputFileName);

                    s3.upload( {
                        Bucket: config.s3.bucket,
                        Key: outputFileName,
                        ContentType: 'video/mp4',
                        Body: data
                    }, (err, result)=> {
                        if (err){
                            logger.error('s3 upload failed:'+outputFileName);
                            res.send(JSON.stringify({ret_code:retCode.FAIL_UPLOAD_TO_S3, msg:'s3 upload failed'}));
                            throw 's3 upload failed';
                        }

                        logger.info('File uploaded successfully at '+ result.Location);
                        fs.unlinkSync(outputFilePath);
                        fs.unlinkSync(tempFilePath);

                        fs.readFile(thumbnailPath, (err, data) => {
                            if(err){
                                logger.error('outputFile read failed');
                                res.send(JSON.stringify({ret_code:retCode.FAIL_READ_OUTPUT_FILE, msg:'ouputFile read failed'}));
                                throw 'outputFile read failed';
                            }

                            logger.info("start upload file :" + thumbnailName);

                            s3.upload( {
                                Bucket: config.s3.bucket,
                                Key: thumbnailName,
                                ContentType: 'image/png',
                                Body: data
                            }, (err, result)=> {
                                if (err){
                                    logger.error('s3 upload failed:'+thumbnailName);
                                    res.send(JSON.stringify({ret_code:retCode.FAIL_UPLOAD_TO_S3, msg:'s3 upload failed'}));
                                    throw 's3 upload failed';
                                }

                                logger.info('File uploaded successfully at '+ result.Location);
                                fs.unlinkSync(thumbnailPath);

                                res.send(JSON.stringify({ret_code:0, file_key:outputFileName, thumbnail_key:thumbnailName, bucket:config.s3.bucket}));

                            });
                        });
                    });

                });
            }).on('error', (err)=>{
                logger.error('transcoding failed :' +err.message);
                res.send(JSON.stringify({ret_code:retCode.FAIL_TRANSCODING, msg:'transcoding failed'}));
            }).output(outputFilePath).audioCodec('aac').output(thumbnailPath).outputOptions('-frames', '1').noAudio().seek(duration).run();
        });


    }).catch((err)=>{
        logger.error(err);
        res.send(JSON.stringify({ret_code:retCode.ERROR, msg:err}));
    });

});

module.exports = router;

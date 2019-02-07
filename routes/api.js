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

var Jimp = require('jimp');
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

const RET_CODE = {
    SUCCESS: 0,
    ERROR:1,
    FAIL_LOAD_METADATA: 1000,
    FAIL_READ_OUTPUT_FILE : 1001,
    FAIL_UPLOAD_TO_S3 :1002,
    FAIL_TRANSCODING : 1003,
    WRONG_SECRET_KEY : 1004,
    FAIL_DOWNLOAD_FILE : 1005,

};

const TRNAS_PHRASE = {
    LOAD_METADATA: 1,
    START_TRANSCODING:2,
    FINISH_TRANSCODING:3,
    UPLOAD_VIDEO_FILE:4,
    UPLOAD_THUMBNAIL_FILE:5,
    COMPLETE:6

};


var bucket = admin.storage().bucket();

router.post('/upload/image', function(req, res) {
    const path = req.body.path;
    const name = req.body.name;

    const secretKey = req.body.secret_key;
    logger.info('input image data: '+ JSON.stringify(req.body));

    if(secretKey != config.firebase.serviceAccountKey.private_key_id){
        res.send(JSON.stringify({ret_code:RET_CODE.WRONG_SECRET_KEY, msg:'Permission Denied'}));
        throw 'permission denied';
    }

    if(!path || !name){
        res.send(JSON.stringify({ret_code:RET_CODE.ERROR, msg:'Invalid Input'}));
        throw 'input error';
    }

    const tempFilePath = './temp/'+name;
    console.log(tempFilePath);
    let key = crypto.randomBytes(32).toString('hex');
    const outputFileName = moment().valueOf()+'_'+key+'.png';
    const outputFilePath = './temp/'+outputFileName;
    console.log(outputFilePath);
    bucket.file(path).download({destination: tempFilePath}).then(()=> {
        return Jimp.read(tempFilePath);

    }).then((image)=>{
        return image.write(outputFilePath);

    }).then(()=>{
        fs.readFile(outputFilePath, (err, data) => {
            if(err){
                logger.error('outputFile read failed');
                res.send(JSON.stringify({ret_code:RET_CODE.FAIL_READ_OUTPUT_FILE, msg:'ouputFile read failed'}));
                throw 'outputFile read failed';
            }

            logger.info("start upload file :" + outputFileName);

            s3.upload( {
                Bucket: config.s3.bucket,
                Key: outputFileName,
                ContentType: 'image/png',
                Body: data
            }, (err, result)=> {
                if (err){
                    logger.error('s3 upload failed:'+outputFileName);
                    res.send(JSON.stringify({ret_code:RET_CODE.FAIL_UPLOAD_TO_S3, msg:'s3 upload failed'}));
                    throw 's3 upload failed';
                }

                logger.info('File uploaded successfully at '+ result.Location);
                fs.unlinkSync(outputFilePath);
                fs.unlinkSync(tempFilePath);
                res.send(JSON.stringify({ret_code:0, file_key:outputFileName, bucket:config.s3.bucket}));
            });

        });

    }).catch((err)=>{
        console.log(err);
    });
});

/* GET users listing. */
router.post('/upload/video', (req, res) => {
    const path = req.body.path;
    const name = req.body.name;
    const uid = req.body.uid;
    const videoKey = req.body.video_key;
    const topicKey = req.body.topic_key;

    const secretKey = req.body.secret_key;
    logger.info('input data: '+ JSON.stringify(req.body));

    if(secretKey != config.firebase.serviceAccountKey.private_key_id){
        res.send(JSON.stringify({ret_code:RET_CODE.WRONG_SECRET_KEY, msg:'Permission Denied'}));
        throw 'permission denied';
    }

    if(!path || !name || !topicKey || !videoKey){
        res.send(JSON.stringify({ret_code:RET_CODE.ERROR, msg:'Invalid Input'}));
        throw 'input error';
    }

    res.send(JSON.stringify({ret_code:0}));

    const tempFilePath = './temp/'+name;

    bucket.file(path).download({destination: tempFilePath}).then(()=>{
        ffmpeg.ffprobe(tempFilePath, (err, metadata)=>{
            if(err){
                logger.error('metadata load fail');
                app.database().ref('/request/video/'+uid+'/'+videoKey+'/result').set(RET_CODE.FAIL_LOAD_METADATA);
                throw 'metadata load failed';
            }

            //TODO : metadata 정보에 따른 분기 처리

            logger.info('metadata:'+JSON.stringify(metadata.format));
            app.database().ref('/request/video/'+uid+'/'+videoKey+'/phrase').set(TRNAS_PHRASE.LOAD_METADATA);


            let key = crypto.randomBytes(32).toString('hex');

            const outputFileName = moment().valueOf()+'_'+key+'.mp4';
            const outputFilePath = './temp/'+outputFileName;
            //const thumbnailName = moment().valueOf()+'_'+key+'.png';
            const thumbnailName = moment().valueOf()+'_'+key+'.png';
            const thumbnailPath = './temp/'+thumbnailName;

            const previewName = moment().valueOf()+'_'+key+'_preview.png';
            const previewPath = './temp/'+previewName;


            const thumbnailPos = req.body.thumbnail_pos ? req.body.thumbnail_pos : Math.floor(metadata.format.duration / 2);
            ffmpeg(tempFilePath).on('codecData', (data)=>{
                logger.info('format:' + data.format +', video:'+data.video +', audio:'+data.audio+' , duration:'+data.duration);
            }).on('start',()=>{
                logger.info('processing start : ' + outputFileName);
                app.database().ref('/request/video/'+uid+'/'+videoKey+'/phrase').set(TRNAS_PHRASE.START_TRANSCODING);
            }).on('end',(stdout, stderr)=>{
                logger.info('processing finish : '+outputFileName);
                app.database().ref('/request/video/'+uid+'/'+videoKey+'/phrase').set(TRNAS_PHRASE.FINISH_TRANSCODING);
                fs.readFile(outputFilePath, (err, data) => {
                    if(err){
                        logger.error('outputFile read failed');
                        app.database().ref('/request/video/'+uid+'/'+videoKey+'/result').set(RET_CODE.FAIL_READ_OUTPUT_FILE);
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
                            res.send(JSON.stringify({ret_code:RET_CODE.FAIL_UPLOAD_TO_S3, msg:'s3 upload failed'}));
                            throw 's3 upload failed';
                        }

                        logger.info('File uploaded successfully at '+ result.Location);
                        fs.unlinkSync(outputFilePath);
                        fs.unlinkSync(tempFilePath);
                        app.database().ref('/request/video/'+uid+'/'+videoKey+'/phrase').set(TRNAS_PHRASE.UPLOAD_VIDEO_FILE);
                        fs.readFile(thumbnailPath, (err, data) => {
                            if(err){
                                logger.error('outputFile read failed');
                                app.database().ref('/request/video/'+uid+'/'+videoKey+'/result').set(RET_CODE.FAIL_DOWNLOAD_FILE);
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
                                    app.database().ref('/request/video/'+uid+'/'+videoKey+'/result').set(RET_CODE.FAIL_UPLOAD_TO_S3);
                                    throw 's3 upload failed';
                                }

                                logger.info('File uploaded successfully at '+ result.Location);
                                fs.unlinkSync(thumbnailPath);
                                app.database().ref('/request/video/'+uid+'/'+videoKey+'/phrase').set(TRNAS_PHRASE.UPLOAD_THUMBNAIL_FILE);
                                fs.readFile(previewPath, (err, data) => {
                                    if(err){
                                        logger.error('outputFile read failed');
                                        app.database().ref('/request/video/'+uid+'/'+videoKey+'/result').set(RET_CODE.FAIL_DOWNLOAD_FILE);
                                        throw 'outputFile read failed';
                                    }

                                    logger.info("start upload file :" + previewName);

                                    s3.upload( {
                                        Bucket: config.s3.bucket,
                                        Key: previewName,
                                        ContentType: 'image/png',
                                        Body: data
                                    }, (err, result)=> {
                                        if (err){
                                            logger.error('s3 upload failed:'+previewName);
                                            app.database().ref('/request/video/'+uid+'/'+videoKey+'/result').set(RET_CODE.FAIL_UPLOAD_TO_S3);
                                            throw 's3 upload failed';
                                        }

                                        logger.info('File uploaded successfully at '+ result.Location);
                                        fs.unlinkSync(previewPath);

                                        let now = moment().valueOf();
                                        let updates = {};

                                        const streaming_url = 'http://ec2-13-125-219-151.ap-northeast-2.compute.amazonaws.com:3001/streaming/'+config.s3.bucket+'/'+outputFileName;
                                        const thumbnail_url = 'http://ec2-13-125-219-151.ap-northeast-2.compute.amazonaws.com:3001/image/'+config.s3.bucket+'/'+thumbnailName;
                                        const preview_url = 'http://ec2-13-125-219-151.ap-northeast-2.compute.amazonaws.com:3001/image/'+config.s3.bucket+'/'+previewName;

                                        const video = {
                                            create_time : now,
                                            streaming_url : streaming_url,
                                            thumbnail_url : thumbnail_url,
                                            preview_url:preview_url,
                                            title : name,
                                            topic_key:topicKey,
                                            uid : context.params.uid
                                        };

                                        updates['/video/'+videoKey] = video;
                                        updates['/request/video/'+uid+'/'+videoKey+'/complete_time'] = now;
                                        updates['/request/video/'+uid+'/'+videoKey+'/phrase'] = TRNAS_PHRASE.COMPLETE;


                                        const notification = {
                                            code: 'UPLOAD_COMPLETE',
                                            payload: '{"KEY":"' + videoKey + '"}'
                                        };

                                        let notiKey = app.database().ref('/notification/'+uid).push().key;



                                        updates['/notification/'+uid+'/'+notiKey] = notification;


                                        app.database().ref().update(updates);
                                        //res.send(JSON.stringify({ret_code:0, file_key:outputFileName, thumbnail_key:thumbnailName, preview_key:previewName, bucket:config.s3.bucket}));

                                    });
                                });


                            });
                        });
                    });

                });
            }).on('error', (err)=>{
                logger.error('transcoding failed :' +err.message);
                app.database().ref('/request/video/'+uid+'/'+videoKey+'/result').set(constant.RET_CODE.FAIL_TRANSCODING);
            }).output(outputFilePath).audioCodec('aac').videoCodec('libx264').output(thumbnailPath).outputOptions('-frames', '1').noAudio().seek(thumbnailPos).output(previewPath).outputOptions('-frames', '1').noAudio().seek(0).run();
        });
    }).catch((err)=>{
        logger.error(err);
        app.database().ref('/request/video/'+uid+'/'+videoKey+'/result').set(constant.RET_CODE.FAIL_DOWNLOAD_FILE);
    });

});

module.exports = router;

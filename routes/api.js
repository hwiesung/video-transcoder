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
    region:config.s3.region
});

let app = admin.initializeApp({
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
    RUNNING_TIME : 1006

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
                let image_url = 'http://ec2-13-125-237-174.ap-northeast-2.compute.amazonaws.com:3001/image/'+config.s3.bucket+'/'+outputFileName;
                res.send(JSON.stringify({ret_code:0, image_url:image_url}));
            });

        });

    }).catch((err)=>{
        console.log(err);
    });
});


async function transcodingJob(uid, type, key, name, path, thumbnailPos){
    const tempFilePath = './temp/'+name;

    try{
        await bucket.file(path).download({destination: tempFilePath});
    }catch(err){
        logger.error(err);
        app.database().ref('/request/'+type+'/'+uid+'/'+key+'/result').set(RET_CODE.FAIL_DOWNLOAD_FILE);
    }

    await new Promise( (resolve, reject)=>{
        ffmpeg.ffprobe(tempFilePath, (err, metadata)=>{
            if(err){
                logger.error('metadata load fail');
                app.database().ref('/request/'+type+'/'+uid+'/'+key+'/result').set(RET_CODE.FAIL_LOAD_METADATA);
                reject(new Error('metadata load failed'));
            }

            //TODO : metadata 정보에 따른 분기 처리

            logger.info('metadata:'+JSON.stringify(metadata.format));
            app.database().ref('/request/'+type+'/'+uid+'/'+key+'/phrase').set(TRNAS_PHRASE.LOAD_METADATA);

            let fileKey = crypto.randomBytes(32).toString('hex');

            const outputFileName = moment().valueOf()+'_'+fileKey+'.mp4';
            const outputFilePath = './temp/'+outputFileName;

            const thumbnailName = moment().valueOf()+'_'+fileKey+'.png';
            const thumbnailPath = './temp/'+thumbnailName;

            const previewName = moment().valueOf()+'_'+fileKey+'_preview.png';
            const previewPath = './temp/'+previewName;

            const shortVideoName = moment().valueOf()+'_'+fileKey+'_short.mp4';
            const shortVideoPath = './temp/'+shortVideoName;

            if(metadata.format.duration < 3 || metadata.format.duration > 60){
                logger.error('metadata load fail');
                app.database().ref('/request/'+type+'/'+uid+'/'+key+'/result').set(RET_CODE.RUNNING_TIME);
                reject(new Error('running time error'));
            }


            thumbnailPos = thumbnailPos ? thumbnailPos : 1;
            console.log(metadata.format.duration);
            console.log(thumbnailPos);
            let shortPos = (thumbnailPos + 1) > metadata.format.duration ? (metadata.format.duration-1) : thumbnailPos;

            ffmpeg(tempFilePath).on('codecData', (data)=>{
                logger.info('format:' + data.format +', video:'+data.video +', audio:'+data.audio+' , duration:'+data.duration);
            }).on('start',()=>{
                logger.info('processing start : ' + outputFileName);
                app.database().ref('/request/'+type+'/'+uid+'/'+key+'/phrase').set(TRNAS_PHRASE.START_TRANSCODING);
            }).on('end',(stdout, stderr)=>{
                logger.info('processing finish : '+outputFileName);
                app.database().ref('/request/'+type+'/'+uid+'/'+key+'/phrase').set(TRNAS_PHRASE.FINISH_TRANSCODING);
                fs.readFile(outputFilePath, (err, data) => {
                    if(err){
                        logger.error('outputFile read failed');
                        app.database().ref('/request/'+type+'/'+uid+'/'+key+'/result').set(RET_CODE.FAIL_READ_OUTPUT_FILE);
                        reject(new Error( 'outputFile read failed'));
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
                            app.database().ref('/request/'+type+'/'+uid+'/'+key+'/result').set(RET_CODE.FAIL_UPLOAD_TO_S3);
                            reject(new Error( 's3 upload failed'));
                        }

                        logger.info('File uploaded successfully at '+ result.Location);
                        fs.unlinkSync(outputFilePath);
                        fs.unlinkSync(tempFilePath);
                        app.database().ref('/request/'+type+'/'+uid+'/'+key+'/phrase').set(TRNAS_PHRASE.UPLOAD_VIDEO_FILE);
                        fs.readFile(thumbnailPath, (err, data) => {
                            if(err){
                                logger.error('thumb read failed');
                                app.database().ref('/request/'+type+'/'+uid+'/'+key+'/result').set(RET_CODE.FAIL_DOWNLOAD_FILE);
                                reject(new Error( 'outputFile read failed'));
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
                                    app.database().ref('/request/'+type+'/'+uid+'/'+key+'/result').set(RET_CODE.FAIL_UPLOAD_TO_S3);
                                    reject(new Error( 's3 upload failed'));
                                }

                                logger.info('File uploaded successfully at '+ result.Location);
                                fs.unlinkSync(thumbnailPath);
                                app.database().ref('/request/'+type+'/'+uid+'/'+key+'/phrase').set(TRNAS_PHRASE.UPLOAD_THUMBNAIL_FILE);
                                fs.readFile(previewPath, (err, data) => {
                                    if(err){
                                        logger.error('outputFile read failed');
                                        app.database().ref('/request/'+type+'/'+uid+'/'+key+'/result').set(RET_CODE.FAIL_DOWNLOAD_FILE);
                                        reject(new Error( 'outputFile read failed'));
                                    }

                                    logger.info("start upload file :" + previewName);

                                    s3.upload( {
                                        Bucket: config.s3.bucket,
                                        Key: previewName,
                                        ContentType: 'image/png',
                                        Body: data
                                    }, async (err, result)=> {
                                        if (err){
                                            logger.error('s3 upload failed:'+previewName);
                                            await app.database().ref('/request/'+type+'/'+uid+'/'+key+'/result').set(RET_CODE.FAIL_UPLOAD_TO_S3);
                                            reject(new Error( 's3 upload failed'));
                                        }

                                        logger.info('File uploaded successfully at '+ result.Location);
                                        fs.unlinkSync(previewPath);

                                        fs.readFile(shortVideoPath, (err, data) => {
                                            if(err){
                                                logger.error('outputFile read failed');
                                                app.database().ref('/request/'+type+'/'+uid+'/'+key+'/result').set(RET_CODE.FAIL_DOWNLOAD_FILE);
                                                reject(new Error( 'outputFile read failed'));
                                            }

                                            logger.info("start upload file :" + shortVideoName);

                                            s3.upload( {
                                                Bucket: config.s3.bucket,
                                                Key: shortVideoName,
                                                ContentType: 'video/mp4',
                                                Body: data
                                            }, async (err, result)=> {
                                                if (err){
                                                    logger.error('s3 upload failed:'+previewName);
                                                    await app.database().ref('/request/'+type+'/'+uid+'/'+key+'/result').set(RET_CODE.FAIL_UPLOAD_TO_S3);
                                                    reject(new Error( 's3 upload failed'));
                                                }

                                                logger.info('File uploaded successfully at '+ result.Location);
                                                fs.unlinkSync(shortVideoPath);

                                                let updates = {};

                                                const streaming_url = 'http://ec2-13-125-237-174.ap-northeast-2.compute.amazonaws.com:3001/streaming/'+config.s3.bucket+'/'+outputFileName;
                                                const short_url = 'http://ec2-13-125-237-174.ap-northeast-2.compute.amazonaws.com:3001/streaming/'+config.s3.bucket+'/'+shortVideoName;
                                                const thumbnail_url = 'http://ec2-13-125-237-174.ap-northeast-2.compute.amazonaws.com:3001/image/'+config.s3.bucket+'/'+thumbnailName;
                                                const preview_url = 'http://ec2-13-125-237-174.ap-northeast-2.compute.amazonaws.com:3001/image/'+config.s3.bucket+'/'+previewName;

                                                updates['/request/'+type+'/'+uid+'/'+key+'/video_url'] = streaming_url;
                                                updates['/request/'+type+'/'+uid+'/'+key+'/thumbnail_url'] = thumbnail_url;
                                                updates['/request/'+type+'/'+uid+'/'+key+'/preview_url'] = preview_url;
                                                updates['/request/'+type+'/'+uid+'/'+key+'/short_video_url'] = short_url;
                                                updates['/request/'+type+'/'+uid+'/'+key+'/complete_time'] = moment().valueOf();
                                                updates['/request/'+type+'/'+uid+'/'+key+'/phrase'] = TRNAS_PHRASE.COMPLETE;
                                                updates['/request/'+type+'/'+uid+'/'+key+'/result'] = RET_CODE.SUCCESS;

                                                logger.info(JSON.stringify(updates));

                                                try{
                                                    await app.database().ref().update(updates);
                                                    logger.info('video updated');
                                                }catch(err){
                                                    logger.error(err);
                                                }

                                                resolve();
                                            });
                                        });
                                    });
                                });


                            });
                        });
                    });

                });
            }).on('error', (err)=>{
                logger.error('transcoding failed :' +err.message);
                app.database().ref('/request/video/'+uid+'/'+key+'/result').set(RET_CODE.FAIL_TRANSCODING);
            }).output(outputFilePath).audioCodec('aac').videoCodec('libx264').output(shortVideoPath).size('640x?').autopad().noAudio().seekInput(shortPos).seek(shortPos+1).output(thumbnailPath).outputOptions('-frames', '1').noAudio().seek(thumbnailPos).output(previewPath).outputOptions('-frames', '1').noAudio().seek(0).run();
        });
    });

}

/* GET users listing. */
router.post('/upload/video', (req, res) => {
    const path = req.body.path;
    const name = req.body.name;
    const type = req.body.type;
    const key = req.body.key;
    const uid = req.body.uid;

    const secretKey = req.body.secret_key;
    logger.info('input data: '+ JSON.stringify(req.body));

    if(secretKey != config.firebase.serviceAccountKey.private_key_id){
        res.send(JSON.stringify({ret_code:RET_CODE.WRONG_SECRET_KEY, msg:'Permission Denied'}));
        throw 'permission denied';
    }

    if(!path || !name || !key ){
        res.send(JSON.stringify({ret_code:RET_CODE.ERROR, msg:'Invalid Input'}));
        throw 'input error';
    }

    res.send(JSON.stringify({ret_code:0}));

    return transcodingJob(uid, type, key, name, path, req.body.thumbnail_pos).then(()=>{
        logger.info('done:'+key);
    });
});

module.exports = router;

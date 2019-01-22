
const retCode = {
    SUCCESS: 0,
    ERROR:1,
    FAIL_LOAD_METADATA: 1000,
    FAIL_READ_OUTPUT_FILE : 1001,
    FAIL_UPLOAD_TO_S3 :1002,
    FAIL_TRANSCODING : 1003,
    WRONG_SECRET_KEY : 1004

}

module.exports = retCode;
const winston = require('winston');
var moment = require('moment-timezone');
const myFormat =winston.format.printf((info)=>{
    info.timestamp = moment().tz('Asia/Seoul').format('YYYY-MM-DD HH:mm:ss');
    return JSON.stringify(info);
});
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(myFormat),
    transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' })
    ]
});

if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.simple()
    }));
}

module.exports = logger;
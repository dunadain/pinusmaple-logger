"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setPinusLogLevel = exports.configure = exports.getLogger = void 0;
const log4js = require("log4js");
const fs = require("fs");
const util = require("util");
let funcs = {
    'env': doEnv,
    'args': doArgs,
    'opts': doOpts
};
// 0 log  1 debug, 2 info, 3 warn, 4 error
let logLevel = 0;
// 支持动态更改日志级别
function setPinusLogLevel(newLevel) {
    console.warn('change pinus log level:', newLevel, 'oldLevel:', logLevel);
    logLevel = newLevel;
}
exports.setPinusLogLevel = setPinusLogLevel;
let log4jspause = false;
process.on('log4js:pause', (val) => {
    log4jspause = val;
});
function getLogger(...args) {
    let categoryName = args[0];
    let prefix = '';
    for (let i = 1; i < args.length; i++) {
        if (i !== args.length - 1)
            prefix = prefix + args[i] + '] [';
        else
            prefix = prefix + args[i];
    }
    if (typeof categoryName === 'string') {
        // category name is __filename then cut the prefix path
        categoryName = categoryName.replace(process.cwd(), '');
    }
    let logger = log4js.getLogger(categoryName);
    let pLogger = {};
    Object.setPrototypeOf(pLogger, logger);
    for (let key in logger) {
        pLogger[key] = logger[key];
    }
    ['log', 'debug', 'info', 'warn', 'error', 'trace', 'fatal'].forEach((item, idx) => {
        pLogger[item] = function () {
            // 从根源过滤日志级别
            if (idx < logLevel || log4jspause) {
                return;
            }
            let p = '';
            if (!process.env.RAW_MESSAGE) {
                if (process.env.LOGGER_PREFIX) {
                    if (args.length > 1) {
                        p = '[' + process.env.LOGGER_PREFIX + prefix + '] ';
                    }
                    else if (process.env.LOGGER_PREFIX) {
                        p = '[' + process.env.LOGGER_PREFIX + '] ';
                    }
                }
                else if (args.length > 1) {
                    p = '[' + prefix + '] ';
                }
                if (args.length && process.env.LOGGER_LINE) {
                    p = getLine() + ': ' + p;
                }
            }
            if (args.length) {
                arguments[0] = p + arguments[0];
            }
            if (item === 'error' && process.env.ERROR_STACK) {
                arguments[0] += (new Error()).stack;
            }
            logger[item].apply(logger, arguments);
        };
    });
    return pLogger;
}
exports.getLogger = getLogger;
let configState = {};
function initReloadConfiguration(filename, reloadSecs) {
    if (configState.timerId) {
        clearInterval(configState.timerId);
        delete configState.timerId;
    }
    configState.filename = filename;
    configState.lastMTime = getMTime(filename);
    configState.timerId = setInterval(reloadConfiguration, reloadSecs * 1000);
}
function getMTime(filename) {
    let mtime;
    try {
        mtime = fs.statSync(filename).mtime;
    }
    catch (e) {
        throw new Error('Cannot find file with given path: ' + filename);
    }
    return mtime;
}
function loadConfigurationFile(filename) {
    if (filename) {
        return JSON.parse(fs.readFileSync(filename, 'utf8'));
    }
    return undefined;
}
function reloadConfiguration() {
    let mtime = getMTime(configState.filename);
    if (!mtime) {
        return;
    }
    if (configState.lastMTime && (mtime.getTime() > configState.lastMTime.getTime())) {
        configureOnceOff(loadConfigurationFile(configState.filename));
    }
    configState.lastMTime = mtime;
}
function replaceConsole() {
    const logger = getLogger('logger', 'console');
    console.debug = logger.debug.bind(logger);
    console.log = logger.info.bind(logger);
    console.warn = logger.warn.bind(logger);
    console.error = logger.error.bind(logger);
    console.trace = logger.trace.bind(logger);
}
function configureOnceOff(config) {
    if (config) {
        try {
            configureLevels(config.categories);
            if (config.replaceConsole) {
                replaceConsole();
            }
        }
        catch (e) {
            const err = e;
            throw new Error('Problem reading log4js config ' + util.inspect(config) +
                '. Error was "' + err.message + '" (' + err.stack + ')');
        }
    }
}
function configureLevels(levels) {
    if (levels) {
        for (let category in levels) {
            if (levels.hasOwnProperty(category)) {
                log4js.getLogger(category).level = levels[category].level;
            }
        }
    }
}
function configure(configOrFilename, opts) {
    let filename = configOrFilename;
    configOrFilename = configOrFilename || process.env.LOG4JS_CONFIG;
    opts = opts || {};
    let config;
    if (typeof configOrFilename === 'string') {
        // modified by sw
        config = require(configOrFilename);
        //    config = JSON.parse(fs.readFileSync(configOrFilename, 'utf8')) as Config;
    }
    else {
        config = configOrFilename;
    }
    if (config) {
        config = replaceProperties(config, opts);
    }
    if (config && config.errorStack) {
        process.env.ERROR_STACK = 'true';
    }
    if (config && config.prefix) {
        process.env.LOGGER_PREFIX = config.prefix;
    }
    if (config && config.lineDebug) {
        process.env.LOGGER_LINE = 'true';
    }
    if (config && config.rawMessage) {
        process.env.RAW_MESSAGE = 'true';
    }
    if (filename && config && config.reloadSecs) {
        initReloadConfiguration(filename, config.reloadSecs);
    }
    // config object could not turn on the auto reload configure file in log4js
    log4js.configure(config);
    if (config.replaceConsole) {
        replaceConsole();
    }
}
exports.configure = configure;
function replaceProperties(configObj, opts) {
    if (configObj instanceof Array) {
        for (let i = 0, l = configObj.length; i < l; i++) {
            configObj[i] = replaceProperties(configObj[i], opts);
        }
    }
    else if (typeof configObj === 'object') {
        let field;
        for (let f in configObj) {
            if (!configObj.hasOwnProperty(f)) {
                continue;
            }
            field = configObj[f];
            if (typeof field === 'string') {
                configObj[f] = doReplace(field, opts);
            }
            else if (typeof field === 'object') {
                configObj[f] = replaceProperties(field, opts);
            }
        }
    }
    return configObj;
}
function doReplace(src, opts) {
    if (!src) {
        return src;
    }
    let ptn = /\$\{(.*?)\}/g;
    let m, pro, ts, scope, name, defaultValue, func, res = '', lastIndex = 0;
    while ((m = ptn.exec(src))) {
        pro = m[1];
        ts = pro.split(':');
        if (ts.length !== 2 && ts.length !== 3) {
            res += pro;
            continue;
        }
        scope = ts[0];
        name = ts[1];
        if (ts.length === 3) {
            defaultValue = ts[2];
        }
        func = funcs[scope];
        if (!func && typeof func !== 'function') {
            res += pro;
            continue;
        }
        res += src.substring(lastIndex, m.index);
        lastIndex = ptn.lastIndex;
        res += (func(name, opts) || defaultValue);
    }
    if (lastIndex < src.length) {
        res += src.substring(lastIndex);
    }
    return res;
}
function doEnv(name, opts) {
    return process.env[name];
}
function doArgs(name, opts) {
    return process.argv[Number(name)];
}
function doOpts(name, opts) {
    return opts ? opts[name] : undefined;
}
function getLine() {
    var _a, _b;
    let e = new Error();
    // now magic will happen: get line number from callstack
    if (process.platform === 'win32') {
        return (_a = e.stack) === null || _a === void 0 ? void 0 : _a.split('\n')[3].split(':')[2];
    }
    return (_b = e.stack) === null || _b === void 0 ? void 0 : _b.split('\n')[3].split(':')[1];
}
//# sourceMappingURL=logger.js.map
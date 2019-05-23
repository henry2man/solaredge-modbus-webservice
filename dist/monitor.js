"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const SolarEdgeModbusClient2 = require("solaredge-modbus-client2");
const express_1 = __importDefault(require("express"));
const url_1 = __importDefault(require("url"));
const winston_1 = __importDefault(require("winston"));
const consoleTransport = new winston_1.default.transports.Console();
const myWinstonOptions = {
    transports: [consoleTransport],
};
const logger = winston_1.default.createLogger(myWinstonOptions);
const RELEVANT_DATA = [
    "INV_I_AC_Power",
    "INV_I_AC_Power_SF",
    "INV_I_AC_Energy_WH",
    "INV_I_AC_Energy_WH_SF",
    "INV_I_Temp_Sink",
    "INV_I_Temp_SF",
    "INV_I_Status",
    "INV_I_Status_Vendor",
    "MET_M_AC_Power",
    "MET_M_AC_Power_SF",
    "MET_M_Exported",
    "MET_M_Imported",
    "MET_M_Energy_W_SF"
];
const INFO_DATA = [
    "CM_C_Manufacturer",
    "CM_C_Model",
    "CM_C_Version",
    "CM_C_SerialNumber",
    "MET_C_Manufacturer",
    "MET_C_Model",
    "MET_C_Version",
    "MET_C_SerialNumber",
];
const MONITOR_PORT = process.env.PORT !== undefined ? parseInt(process.env.PORT, 0) : 8080;
const MONITOR_HOST = process.env.HOST || "0.0.0.0";
const MONITOR_API_KEY = process.env.API_KEY || "";
const MONITOR_TCP_HOST = process.env.TCP_HOST || "";
const MONITOR_TCP_PORT = process.env.TCP_PORT || "502";
logger.debug("Connecting to remote server on " + MONITOR_TCP_HOST
    + ":" + MONITOR_TCP_PORT + " using modbus TCP");
const app = express_1.default();
app.use((req, res, next) => {
    logger.debug(req.url);
    next();
});
app.use((error, req, res, next) => {
    logger.error(error);
    next();
});
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Authorization, X-API-KEY, Origin, X-Requested-With, Content-Type, Accept, Access-Control-Allow-Request-Method");
    res.header("Access-Control-Allow-Methods", "GET");
    res.header("Allow", "GET");
    next();
});
const ERROR_CODE_FORBIDDEN = "403";
const ERROR_CODE_INTERNAL_SERVER_ERROR = "500";
app.get("/data", (req, res) => __awaiter(this, void 0, void 0, function* () {
    try {
        res.status(200).json(yield dataHandler(req, MONITOR_API_KEY, RELEVANT_DATA));
    }
    catch (error) {
        processError(req, res, error);
    }
})).get("/info", (req, res) => __awaiter(this, void 0, void 0, function* () {
    try {
        res.status(200).json(yield infoHandler(req, MONITOR_API_KEY, INFO_DATA));
    }
    catch (error) {
        processError(req, res, error);
    }
}));
const server = app.listen(MONITOR_PORT, MONITOR_HOST, () => {
    logger.info("Server running on port " + MONITOR_PORT);
});
function processError(req, res, error) {
    logger.debug(error);
    if (error.message === ERROR_CODE_FORBIDDEN) {
        logger.warn(`Forbidden request: ${req.url}`);
        res.status(403).send({ errorCode: ERROR_CODE_FORBIDDEN, errorMessage: "Forbidden" });
    }
    else {
        logger.error(`Internal error. Request: ${req.url}`);
        res.status(500).send({ errorCode: ERROR_CODE_INTERNAL_SERVER_ERROR, errorMessage: "Internal Server Error" });
    }
}
function readRegisters(registersToBeRead, parseDataFn) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const solar = new SolarEdgeModbusClient2({
                host: MONITOR_TCP_HOST,
                port: MONITOR_TCP_PORT
            });
            logger.debug("Requesting data...");
            const data = yield solar.getData(registersToBeRead);
            solar.socket.destroy();
            logger.debug("Winter is comming!");
            const outputData = {};
            data.map((result) => {
                logger.debug("* Reading: " + result.name);
                outputData[result.name] = parseDataFn(result.value);
            });
            return outputData;
        }
        catch (error) {
            throw new Error(error);
        }
    });
}
function dataHandler(req, apiKey, dataToRead) {
    return __awaiter(this, void 0, void 0, function* () {
        if (checkKey(req, apiKey)) {
            return readRegisters(dataToRead, (input) => {
                return Number(cleanNullChars(input));
            }).then((results) => {
                const o = {};
                o.Production_AC_Power_Net_WH = parseFloat(((results.INV_I_AC_Power
                    * Math.pow(10, results.INV_I_AC_Power_SF) * 100) / 100).toFixed(0));
                o.Production_AC_Power_Lifetime_WH =
                    results.INV_I_AC_Energy_WH * Math.pow(10, results.INV_I_AC_Energy_WH_SF);
                o.Consumption_AC_Power_Meter =
                    parseFloat(((results.MET_M_AC_Power
                        * Math.pow(10, results.MET_M_AC_Power_SF) * 100) / 100).toFixed(0));
                o.Consumption_AC_Power_Net_WH =
                    o.Consumption_AC_Power_Meter -
                        o.Production_AC_Power_Net_WH;
                o.Consumption_AC_Power_Lifetime_WH =
                    results.MET_M_Imported * Math.pow(10, results.MET_M_Energy_W_SF)
                        +
                            results.INV_I_AC_Energy_WH * Math.pow(10, results.INV_I_AC_Energy_WH_SF)
                        - results.MET_M_Exported * Math.pow(10, results.MET_M_Energy_W_SF);
                o.Temperature_C =
                    parseFloat(((results.INV_I_Temp_Sink
                        * Math.pow(10, results.INV_I_Temp_SF) * 100) / 100).toFixed(2));
                o.Inverter_Status_N = results.INV_I_Status;
                o.Inverter_Status_Vendor_N = results.INV_I_Status_Vendor;
                return o;
            }).catch((error) => {
                throw Error(error);
            });
        }
        else {
            throw Error(ERROR_CODE_FORBIDDEN);
        }
    });
}
function infoHandler(req, apiKey, dataToRead) {
    return __awaiter(this, void 0, void 0, function* () {
        if (checkKey(req, apiKey)) {
            return yield readRegisters(dataToRead, cleanNullChars);
        }
        else {
            throw Error(ERROR_CODE_FORBIDDEN);
        }
    });
}
function checkKey(req, apiKey) {
    return url_1.default.parse(req.url, true).query.k === apiKey;
}
function cleanNullChars(data) {
    return data !== null ? data.replace(/\0/g, "") : "";
}
//# sourceMappingURL=monitor.js.map
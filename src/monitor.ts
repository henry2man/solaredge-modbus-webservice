"use strict";

// tslint:disable-next-line: no-var-requires
const SolarEdgeModbusClient2 = require("solaredge-modbus-client2");
import express, { Request, Response } from "express";
import url from "url";
import winston, { Logger } from "winston";
import process from 'process';

process.on('uncaughtException', err => {
    console.error('There was an uncaught error', err.message)
})

const consoleTransport = new winston.transports.Console();

const myWinstonOptions = {
    transports: [consoleTransport],
};

const logger: Logger = winston.createLogger(myWinstonOptions);

// monitoring
const RELEVANT_DATA = [
    "INV_I_AC_Power",
    "INV_I_AC_Power_SF",
    "INV_I_Temp_Sink",
    "INV_I_Temp_SF",
    "INV_I_Status",
    "MET_M_AC_Power",
    "MET_M_AC_Power_SF",
];

// info data
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

// get run configuration
const MONITOR_PORT = process.env.PORT !== undefined ? parseInt(process.env.PORT, 0) : 8080;
const MONITOR_HOST = process.env.HOST || "0.0.0.0";
const MONITOR_API_KEY = process.env.API_KEY || "";
const MONITOR_TCP_HOST = process.env.TCP_HOST || "";
const MONITOR_TCP_PORT = process.env.TCP_PORT || "502";
const CONNECT_TIMEOUT = Number(process.env.CONNECT_TIMEOUT) || 2000;

logger.debug("Connecting to remote server on " + MONITOR_TCP_HOST
    + ":" + MONITOR_TCP_PORT + " using modbus TCP");

// Loading app
const app = express();

// loging urls
app.use(
    (req: Request, res: Response, next: () => void) => {
        logger.debug(req.url);
        next();
    }
);
// logging errors
app.use((error: string, req: Request, res: Response, next: () => void) => {
    logger.error(error);
    next();
});
// Cors
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers",
        // tslint:disable-next-line: max-line-length
        "Authorization, X-API-KEY, Origin, X-Requested-With, Content-Type, Accept, Access-Control-Allow-Request-Method");
    res.header("Access-Control-Allow-Methods", "GET");
    res.header("Allow", "GET");
    next();
});

const ERROR_CODE_FORBIDDEN = "403";
const ERROR_CODE_INTERNAL_SERVER_ERROR = "500";

app.get("/data", async (req, res) => {
    try {
        let data = await dataHandler(req, MONITOR_API_KEY, RELEVANT_DATA);
        res.status(200).json(data);
    } catch (error) {
        processError(req, res, error);
    }
}).get("/info", async (req, res) => {
    try {
        let infoData = await infoHandler(req, MONITOR_API_KEY, INFO_DATA);
        res.status(200).json(infoData);
    } catch (error) {
        processError(req, res, error);
    }
});

const server = app.listen(MONITOR_PORT, MONITOR_HOST, () => {
    // the server object listens on port ${PORT}
    logger.info("Server running on port " + MONITOR_PORT);
});

function processError(req: Request, res: Response, error: any) {
    if (error.message === ERROR_CODE_FORBIDDEN) {
        logger.warn(`Forbidden request: ${req.url}`);
        res.status(403).send({ errorCode: ERROR_CODE_FORBIDDEN, errorMessage: "Forbidden" });
    } else {
        logger.error(`Internal error: ${error.message}, Request: ${req.url}`);
        res.status(500).send({ errorCode: ERROR_CODE_INTERNAL_SERVER_ERROR, errorMessage: "Internal Server Error" });
    }
}

/**
 * Async function that read registers and extracts a object with data
 * @param  {string[]} registersToBeRead
 * @param  {Function} parseDataFn
 * @returns {Promise<{ [s: string]: any }>}
 */
async function readRegisters(registersToBeRead: string[], parseDataFn: (input: string) => string | number)
    : Promise<{ [s: string]: any }> {

    // Acquire connection...
    const solar = new SolarEdgeModbusClient2({
        host: MONITOR_TCP_HOST,
        port: MONITOR_TCP_PORT
    });

    logger.debug("Requesting data...");

    var promiseTimeout = new Promise(function (fulfill, reject) {
        // Rejects as soon as the timeout kicks in
        setTimeout(() => {
            reject({ 'error': 'timeout exceded' });
        }
            , CONNECT_TIMEOUT);
    });

    const data = await Promise.race([promiseTimeout, solar.getData(registersToBeRead)]);

    // Release socket
    solar.socket.destroy();

    logger.debug("Socket closed!");
    const outputData: { [s: string]: string | number; } = {};

    data.map((result: { name: string, value: string }) => {
        logger.debug("* Reading: " + result.name);
        outputData[result.name] = parseDataFn(result.value);
    });
    return outputData;
}

/**
 * @param  {Request} req
 * @param  {string} apiKey
 * @param  {string[]} dataToRead
 * @returns {Promise<{ [s: string]: any }>}
 */
async function dataHandler(req: Request, apiKey: string, dataToRead: string[]): Promise<{ [s: string]: any }> {

    if (checkKey(req, apiKey)) {
        return readRegisters(dataToRead,
            // parsing fn
            (input: string) => {
                return Number(cleanNullChars(input));
            }).then((results) => {

                // Parse results into something more readable...
                const o: { [s: string]: any } = {};

                // Production
                o.Production_AC_Power_Net_WH = parseFloat(((
                    results.INV_I_AC_Power
                    * Math.pow(10, results.INV_I_AC_Power_SF) * 100) / 100).toFixed(0));

                // External Consumption
                o.Consumption_AC_Power_Meter =
                    // + Imported
                    parseFloat(((results.MET_M_AC_Power
                        * Math.pow(10, results.MET_M_AC_Power_SF) * 100) / 100).toFixed(0))
                    ;

                // consumption = inverter + meter
                o.Consumption_AC_Power_Net_WH =
                    o.Consumption_AC_Power_Meter -
                    // + produced
                    o.Production_AC_Power_Net_WH;

                // Temperature (fixed 2 decimals)
                o.Temperature_C =
                    parseFloat(((results.INV_I_Temp_Sink
                        * Math.pow(10, results.INV_I_Temp_SF) * 100) / 100).toFixed(2));

                // Inverter Status
                o.Inverter_Status_N = results.INV_I_Status;

                return o;
            }).catch((error) => {
                throw Error(error);
            });
    } else {
        throw Error(ERROR_CODE_FORBIDDEN);
    }

}

async function infoHandler(req: Request, apiKey: string, dataToRead: string[]): Promise<{ [s: string]: any }> {
    if (checkKey(req, apiKey)) {
        return await readRegisters(dataToRead, cleanNullChars);
    } else {
        throw Error(ERROR_CODE_FORBIDDEN);
    }
}

function checkKey(req: Request, apiKey: string): boolean {
    return url.parse(req.url, true).query.k === apiKey;
}

/**
 * Clean null \0 chars from data.
 * @param  {string} data
 */
function cleanNullChars(data: string): string {
    // Parses null bytes from response
    return data !== null ? data.replace(/\0/g, "") : "";
}

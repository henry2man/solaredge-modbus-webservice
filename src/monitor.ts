"use strict";

// tslint:disable-next-line: no-var-requires
const SolarEdgeModbusClient2 = require("solaredge-modbus-client2");
import express, { Request, Response } from "express";
import url from "url";
import winston, { Logger } from "winston";

const consoleTransport = new winston.transports.Console();

const myWinstonOptions = {
    transports: [consoleTransport],
};

const logger: Logger = winston.createLogger(myWinstonOptions);

// monitoring
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

// get parameters
const args = process.argv.slice(2);

if (args.length !== 3) {
    logger.error("Invalid number of arguments. Usage: \n" +
        "node monitor.js <MONITOR_APIKEY> <MODBUS_TCP_HOST> <MODBUS_TCP_PORT>");
    process.exit(1);
}
// get run configuration
const MONITOR_PORT = process.env.PORT || 8081;
const MONITOR_API_KEY = args[0];
const MONITOR_TCP_HOST = args[1];
const MONITOR_TCP_PORT = args[2];

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
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
    res.header("Allow", "GET, POST, OPTIONS, PUT, DELETE");
    next();
});

const ERROR_CODE_FORBIDDEN = "403";
const ERROR_CODE_INTERNAL_SERVER_ERROR = "500";

app.get("/data", async (req, res) => {
    try {
        res.status(200).json(await dataHandler(req, MONITOR_API_KEY, RELEVANT_DATA));
    } catch (error) {
        processError(req, res, error);
    }
}).get("/info", async (req, res) => {
    try {
        res.status(200).json(await infoHandler(req, MONITOR_API_KEY, INFO_DATA));
    } catch (error) {
        processError(req, res, error);
    }
});

const server = app.listen(MONITOR_PORT, () => {
    // the server object listens on port ${PORT}
    logger.info("Server running on port " + MONITOR_PORT);
});

function processError(req: Request, res: Response, error: any) {
    logger.debug(error);
    if (error.message === ERROR_CODE_FORBIDDEN) {
        logger.warn(`Forbidden request: ${req.url}`);
        res.status(403).send({ errorCode: ERROR_CODE_FORBIDDEN, errorMessage: "Forbidden" });
    } else {
        logger.error(`Internal error. Request: ${req.url}`);
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

    try {
        // Acquire connection...
        const solar = new SolarEdgeModbusClient2({
            host: MONITOR_TCP_HOST,
            port: MONITOR_TCP_PORT
        });

        logger.debug("Requesting data...");
        const data = await solar.getData(registersToBeRead);

        // Release socket
        solar.socket.destroy();

        logger.debug("Winter is comming!");
        const outputData: { [s: string]: string | number; } = {};

        data.map((result: { name: string, value: string }) => {
            logger.debug("* Reading: " + result.name);
            outputData[result.name] = parseDataFn(result.value);
        });
        return outputData;
    } catch (error) {
        throw new Error(error);
    }
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

                // Lifetime Production
                o.Production_AC_Power_Lifetime_WH =
                    results.INV_I_AC_Energy_WH * Math.pow(10, results.INV_I_AC_Energy_WH_SF);

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

                // lifetime consumption = imported + produced - exported
                o.Consumption_AC_Power_Lifetime_WH =
                    // + Imported
                    results.MET_M_Imported * Math.pow(10, results.MET_M_Energy_W_SF)
                    +
                    // + produced
                    results.INV_I_AC_Energy_WH * Math.pow(10, results.INV_I_AC_Energy_WH_SF)
                    // - exported
                    - results.MET_M_Exported * Math.pow(10, results.MET_M_Energy_W_SF);

                // Temperature (fixed 2 decimals)
                o.Temperature_C =
                    parseFloat(((results.INV_I_Temp_Sink
                        * Math.pow(10, results.INV_I_Temp_SF) * 100) / 100).toFixed(2));

                // Inverter Status
                o.Inverter_Status_N = results.INV_I_Status;
                o.Inverter_Status_Vendor_N = results.INV_I_Status_Vendor;

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

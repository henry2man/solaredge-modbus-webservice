'use strict'

const SolarEdgeModbusClient2 = require('solaredge-modbus-client2')
const url = require('url');
const express = require('express');

const args = process.argv.slice(2)

if (args.length != 4) {
    console.log("Invalid number of arguments. Usage: \n" +
        "node monitor.js <PORT> <MONITOR_APIKEY> <MODBUS_TCP_HOST> <MODBUS_TCP_PORT>");
    process.exit(1);
} else {

    // run configuration
    const PORT = args[0];
    const MONITOR_APIKEY = args[1];
    const MODBUS_TCP_HOST = args[2];
    const MODBUS_TCP_PORT = args[3];

    // console.debug("Connecting to remote server on " + host + ":" + port + " using modbus TCP");

    var solar = new SolarEdgeModbusClient2({
        host: MODBUS_TCP_HOST,
        port: MODBUS_TCP_PORT
    })


    // Loading app
    const app = express();

    app.get('/data', (req, res) => {

        if (checkKey(req), MONITOR_APIKEY) {
            // monitoring
            const RELEVANT_DATA = [
                'INV_I_AC_Power',
                'INV_I_AC_Power_SF',
                'INV_I_AC_Energy_WH',
                'INV_I_AC_Energy_WH_SF',
                'INV_I_Temp_Sink',
                'INV_I_Temp_SF',
                'INV_I_Status',
                'INV_I_Status_Vendor',
                'MET_M_AC_Power',
                'MET_M_AC_Power_SF',
                'MET_M_Exported',
                'MET_M_Imported',
                'MET_M_Energy_W_SF'
            ];

            readRegisters(MODBUS_TCP_HOST, MODBUS_TCP_PORT, req, res, RELEVANT_DATA);
        } else {
            console.error("FORBIDDEN: Specified apiKey is invalid: '" + q.k + "'");
            res.status(403).end();
        }
    }).get('/info', (req, res) => {
        if (checkKey(req), MONITOR_APIKEY) {

            // monitoring
            const INFO_DATA = [
                'CM_C_Manufacturer',
                'CM_C_Model',
                'CM_C_Version',
                'CM_C_SerialNumber',
                'MET_C_Manufacturer',
                'MET_C_Model',
                'MET_C_Version',
                'MET_C_SerialNumber',
            ];

            readRegisters(MODBUS_TCP_HOST, MODBUS_TCP_PORT, req, res, INFO_DATA);
        } else {
            console.error("FORBIDDEN: Specified apiKey is invalid: '" + q.k + "'");
            res.status(403).end();
        }
    });

    const server = app.listen(PORT, () => {
        //the server object listens on port ${PORT}
        console.log("Server running on port " + PORT);
    });
}

const exitProcesser = (code) => {
    console.log("About to exit with code: ${code}");
    // Release socket 
    solar.socket.destroy();
    process.exit();
};

process.on('SIGINT', exitProcesser).on('exit', exitProcesser);

function parseResponse(data) {
    // Parses null bytes from response
    return data !== null ? data.replace(/\0/g, '') : null;
}

function checkKey(req, apiKey) {
    return url.parse(req.url, true).query.k === apiKey;
}

function readRegisters(host, port, req, res, registersToBeRead) {

    // console.trace("Requesting data...");
    solar.getData(registersToBeRead).then((data) => {
        // console.trace("Winter is comming!");
        let outputData = {};

        data.map(result => {
            // console.trace("* Reading: " + result.name);
            outputData[result.name] = parseResponse(result.value);

            // TODO review this...
            // // consumption = inverter + meter
            // outputData['H_Consumption_Power'] =
            //     // + Imported
            //     outputData["MET_M_AC_Power"] * Math.pow(10, outputData["MET_M_AC_Power_SF"])
            //     +
            //     // + produced
            //     outputData["INV_I_AC_Power"] * Math.pow(10, outputData["INV_I_AC_Power_SF"])
            //     ;

            // // consumption = inverter + meter
            // outputData['H_Consumption_Lifetime_WH'] =
            //     // + Imported
            //     outputData["MET_M_Imported"] * Math.pow(10, outputData["MET_M_Energy_W_SF"])
            //     +
            //     // + produced
            //     outputData["INV_I_AC_Energy_WH"] * Math.pow(10, outputData["INV_I_AC_Energy_WH_SF"])
            //     -
            //     // - exported
            //     outputData["MET_M_Exported"] * Math.pow(10, outputData["MET_M_Energy_W_SF"]);
            // ;
        });

        res.status(200).json(outputData);
    });
}

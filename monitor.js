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

    // Loading app
    const app = express();

    app.get('/', (req, res) => {
        var urlParsed = url.parse(req.url, true);
        var q = urlParsed.query;

        if (q.k === MONITOR_APIKEY) {

            let solar = new SolarEdgeModbusClient2({
                host: MODBUS_TCP_HOST,
                port: MODBUS_TCP_PORT
            })
            // console.log("Requesting data...");
            solar.getData(RELEVANT_DATA).then((data) => {
                // console.log("Data is comming!");
                let outputData = {};

                data.map(result => {
                    // console.log("* Reading: " + result.name );
                    outputData[result.name] = parseResponse(result.value);
                })

                // consumption = inverter + meter
                outputData['H_Consumption_Power'] =
                    // + Imported
                    outputData["MET_M_AC_Power"] * Math.pow(10, outputData["MET_M_AC_Power_SF"])
                    +
                    // + produced
                    outputData["INV_I_AC_Power"] * Math.pow(10, outputData["INV_I_AC_Power_SF"])
                    ;

                // consumption = inverter + meter
                outputData['H_Consumption_Lifetime_WH'] =
                    // + Imported
                    outputData["MET_M_Imported"] * Math.pow(10, outputData["MET_M_Energy_W_SF"])
                    +
                    // + produced
                    outputData["INV_I_AC_Energy_WH"] * Math.pow(10, outputData["INV_I_AC_Energy_WH_SF"])
                    -
                    // - exported
                    outputData["MET_M_Exported"] * Math.pow(10, outputData["MET_M_Energy_W_SF"]);
                ;
                // Release socket 
                solar.socket.destroy();

                res.status(200).json(outputData);
            });
        } else {
            console.log("FORBIDDEN: Specified apiKey is invalid: '" + q.k + "'");
            res.status(403).end();
        }
    });

    const server = app.listen(PORT, () => {
        //the server object listens on port ${PORT}
        console.log("Server running on port " + PORT);
        console.log("Connecting to remote server on " + MODBUS_TCP_HOST + ":" + MODBUS_TCP_PORT + " using modbus TCP");
    });
}

function parseResponse(data) {
    // Parses null bytes from response
    return data!== null ? data.replace(/\0/g, '') : null;
}

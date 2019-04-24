'use strict'

const SolarEdgeModbusClient = require('solaredge-modbus-client')
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
        // 'C_SunSpec_DID', 
        // 'C_Version',
        // 'C_SerialNumber',
        // 'I_AC_Current',
        // 'I_AC_Current_SF',
        // 'I_AC_CurrentA',
        // 'I_AC_CurrentB',
        // 'I_AC_CurrentC',
        // 'I_AC_VoltageAB',
        'I_AC_Power',
        'I_AC_Power_SF',
        'I_AC_Energy_WH',
        'I_AC_Energy_WH_SF',
        // 'I_DC_Current',
        // 'I_DC_Voltage',
        // 'I_DC_Power',
        // 'I_AC_VA', 
        // 'I_AC_VA_SF', 
        // 'I_AC_VAR', 
        // 'I_AC_VAR_SF',
        // 'I_AC_PF',
        // 'I_AC_PF_SF',
        'I_Temp_Sink',
        'I_Temp_SF',
        'I_Status',
        'I_Status_Vendor',
        'M_AC_Power',
        'M_AC_Power_SF',
        'M_Exported',
        'M_Exported_A',
        'M_Exported_B',
        'M_Exported_C',
        'M_Imported',
        'M_Imported_A',
        'M_Imported_B',
        'M_Imported_C',
        'M_Energy_W_SF'
    ];

    // Loading app
    const app = express();

    app.get('/', (req, res) => {
        var urlParsed = url.parse(req.url, true);
        var q = urlParsed.query;

        if (q.k === MONITOR_APIKEY) {

            let solar = new SolarEdgeModbusClient({
                host: MODBUS_TCP_HOST,
                port: MODBUS_TCP_PORT
            })
            console.log("Requesting data...");
            solar.getData().then((data) => {
                console.log("Data is comming!");
                let outputData = {};

                data.map(result => {
                    // console.log("* Reading: " + result.name );
                    if (RELEVANT_DATA.indexOf(result.name) != -1) {
                        // outputData += "\n\"" + result.name + "\":\"" +  + "\","; //write a response to the client
                        outputData[result.name] = parseResponse(result.value);
                    }
                })

                // consumption = inverter + meter
                outputData['H_Consumption_Power'] =
                    outputData["M_AC_Power"] * Math.pow(10, outputData["M_AC_Power_SF"])
                    +
                    outputData["I_AC_Power"] * Math.pow(10, outputData["I_AC_Power_SF"]);

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
    return data.replace(/\0/g, '');
}

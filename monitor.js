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
        'I_Status',
        'I_Status_Vendor',
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
        'I_AC_PF',
        'I_AC_PF_SF',
        'I_Temp_Sink', 
        // 'I_Temp_SF'
    ];

    console.log("Connecting to remote server on " + MODBUS_TCP_HOST + ":" + MODBUS_TCP_PORT + " using modbus TCP");

    let solar = new SolarEdgeModbusClient({
        host: MODBUS_TCP_HOST,
        port: MODBUS_TCP_PORT
    })

    // Loading app
    const app = express();

    app.get('/', (req, res) => {
        var urlParsed = url.parse(req.url, true);
        var q = urlParsed.query;

        if (q.apiKey === MONITOR_APIKEY) {
            solar.getData().then((data) => {
                let outputData = {};
                data.map(result => {
                    // console.log("* Reading: " + result.name );
                    if (RELEVANT_DATA.indexOf(result.name) != -1) {
                        // outputData += "\n\"" + result.name + "\":\"" +  + "\","; //write a response to the client
                        outputData[result.name] = parseResponse(result.value);
                    }
                })
                res.status(200).json(outputData);
            });
        } else {
            console.log("FORBIDDEN: Specified apiKey is invalid: '" + q.apiKey + "'");
            res.status(403).end();
        }
    });

    const server = app.listen(PORT, () => { 
        //the server object listens on port ${PORT}
        console.log("Server running on port " + PORT);
    });

    // ***** FIXME Pending Graceful shutdown

    process.on('SIGTERM', () => {
        console.log("Disconnecting from inverter...");
        solar.socket.destroy();
        console.log("Disconnected from inverter");

        server.close((err) => {
            if (err) {
                console.error(err)
                process.exit(1);
            }
            process.exit(0);
        })
    })
}

function parseResponse(data) {
    // Parses null bytes from response
    return data.replace(/\0/g, '');
}
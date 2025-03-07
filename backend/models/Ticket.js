const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    ticketNumber: { type: String, required: true },
    position: { type: Number, required: true },
    status: { type: String, enum: ['Waiting', 'Being Served', 'Completed'], required: true },
    issuedAt: { type: Date, default: Date.now }
});

const Ticket = mongoose.model('Ticket', ticketSchema);
module.exports = Ticket;

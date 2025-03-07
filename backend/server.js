const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const Ticket = require('./models/Ticket');
require('dotenv').config(); // To manage environment variables
const User = require("./models/user"); // Ensure this model exists and is correctly defined

const app = express();
app.use(express.json());
app.use(cors());

// MongoDB connection
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('MongoDB connected'))
.catch((err) => console.error('MongoDB connection error:', err));

// Signup route
app.post("/api/signup", async (req, res) => {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !role) {
        return res.status(400).json({ message: "All fields are required" });
    }
    if (!["user", "employee"].includes(role)) {
        return res.status(400).json({ message: "Invalid role" });
    }
    try {
        const userExists = await User.findOne({ email });
        if (userExists) {
            return res.status(400).json({ message: "Email already in use" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ name, email, password: hashedPassword, role });
        await user.save();

        res.status(201).json({ message: "User registered successfully" });
    } catch (err) {
        console.error("Error registering user:", err);
        res.status(500).json({ message: "Internal server error" });
    }
});

// Signin route
app.post("/api/signin", async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: "Invalid email or password" });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(400).json({ message: "Invalid email or password" });
        }

        const token = jwt.sign(
            { id: user._id, email: user.email, name: user.name, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: "1h" }
        );

        res.json({ token, role: user.role, message: "Signin successful" });
    } catch (error) {
        console.error("Error during signin:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// Get user data route
app.get('/api/user', (req, res) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token provided' });

    jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
        if (err) return res.status(403).json({ message: 'Invalid token' });

        try {
            const user = await User.findById(decoded.id);
            if (!user) return res.status(404).json({ message: 'User not found' });
            res.json({ id: user._id, name: user.name, email: user.email });
        } catch (err) {
            console.error("Error fetching user data:", err);
            res.status(500).json({ message: "Internal server error" });
        }
    });
});

// Function to generate ticket number
function generateTicketNumber() {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let ticketNumber = '';
    for (let i = 0; i < 6; i++) {
        ticketNumber += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return ticketNumber;
}

// Issue ticket with proper position
app.post('/api/ticket', async (req, res) => {
    const { userId, issuedBy } = req.body;  // Ensure 'issuedBy' is passed

    if (!userId || !issuedBy) {
        return res.status(400).json({ message: "User ID and Issued By are required." });
    }

    try {
        // Get the latest ticket count in "Waiting" status to calculate position
        const position = await Ticket.countDocuments({ status: 'Waiting' }) + 1;
        const ticketNumber = generateTicketNumber();

        const newTicket = new Ticket({
            userId,
            ticketNumber,
            position,
            status: 'Waiting',
            issuedBy, // Save the person issuing the ticket
        });

        await newTicket.save();

        // Update positions of all other tickets after adding a new ticket
        await Ticket.updateMany(
            { position: { $gte: position }, status: 'Waiting' },
            { $inc: { position: 1 } }
        );

        res.status(201).json({
            message: 'Ticket issued successfully',
            ticket: {
                number: newTicket.ticketNumber,
                position: newTicket.position
            }
        });
    } catch (error) {
        console.error('Error issuing ticket:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Fetch Queue Route
app.get('/api/queue', async (req, res) => {
    try {
        const queue = await Ticket.find({ status: { $in: ['Waiting', 'Being Served'] } })
            .populate('userId', 'name')  // Populate the userId with 'name'
            .sort({ issuedAt: 1 }); // Ensures order by issue time

        // Recalculate positions dynamically
        const formattedQueue = queue.map((ticket, index) => ({
            _id: ticket._id,
            ticketNumber: ticket.ticketNumber,
            name: ticket.userId?.name || "Unknown",
            issuedBy: ticket.issuedBy || "Unknown", // Ensure issuedBy is correctly populated
            status: ticket.status,
            position: index + 1 // Recalculate positions dynamically
        }));

        res.json(formattedQueue);
    } catch (error) {
        console.error('Error fetching queue:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Serve ticket: change status to 'Being Served'
app.put('/api/ticket/:ticketId', async (req, res) => {
    try {
        const { ticketId } = req.params;
        const { status } = req.body;
        const ticket = await Ticket.findById(ticketId);

        if (!ticket) {
            return res.status(404).json({ message: 'Ticket not found' });
        }

        ticket.status = status;
        await ticket.save();
        res.json(ticket);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// Complete ticket: change status to 'Completed'
app.put('/api/complete-ticket/:ticketId', async (req, res) => {
    const { ticketId } = req.params;

    try {
        const ticket = await Ticket.findById(ticketId);
        if (!ticket || ticket.status !== 'Being Served') {
            return res.status(400).json({ message: 'Ticket cannot be marked as completed.' });
        }

        // Change the status to 'Completed'
        ticket.status = 'Completed';
        await ticket.save();

        // Recalculate positions of the remaining tickets
        const remainingTickets = await Ticket.find({ status: 'Being Served' }).sort({ position: 1 });
        remainingTickets.forEach(async (ticket, index) => {
            ticket.position = index + 1;
            await ticket.save();
        });

        res.status(200).json({ message: 'Ticket has been completed.' });
    } catch (error) {
        console.error('Error completing ticket:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

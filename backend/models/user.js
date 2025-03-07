const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["user", "employee"], required: true }
});

// ✅ Fix: Use `mongoose.models.User` if it already exists, otherwise create it
const User = mongoose.models.User || mongoose.model("User", userSchema);

module.exports = User;

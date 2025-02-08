require('dotenv').config();  
const express = require("express");
const { allRoute } = require('./global/allRoute');
const { updateCnrDetailsRoute } = require('./routes/updateCnrDetails.route');

const app = express();
app.use(express.json());

app.get('/health', (req, res) => {
    return res.status(200).json({ status: "Ok", message: "Server is Working fine." });
});

app.use("/api", allRoute)
app.use("/api", updateCnrDetailsRoute)

const port = process.env.PORT;

app.listen(port, () => {
    console.log(`Server is running on ${port}`);
});



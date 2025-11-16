const express = require('express')
const { MongoClient, ServerApiVersion } = require('mongodb');
const cors = require('cors')
const app = express()
const port = 3000

// middle ware 
require('dotenv').config()
app.use(cors())
app.use(express.json())

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@elevator.nxjbawz.mongodb.net/?appName=elevator`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();
        const usersCollection = client.db('elevator-server').collection('users')
        const subscriptionCollection = client.db('elevator-server').collection('subscriptions')

        // POST /users → create new user
        app.post("/users", async (req, res) => {
            try {
                const {
                    userId,
                    name,
                    email,
                    role,
                    isSubscribed,
                    createdAt,
                    updatedAt,
                } = req.body;

                console.log(req.body)

                //  Required fields
                if (!userId || !name || !email) {
                    return res.status(400).json({ message: "Missing required fields: userId, name, email" });
                }

                // Check if user exists
                const existingUser = await usersCollection.findOne({ userId });
                if (existingUser) {
                    return res.status(200).json({ message: "User already exists", user: existingUser });
                }

                // Create new user object with defaults
                const newUser = {
                    userId,
                    name,
                    email,
                    role,
                    isSubscribed,
                    createdAt,
                    updatedAt,
                };

                //  Insert into MongoDB
                const result = await usersCollection.insertOne(newUser);
                res.status(201).json({
                    message: "User created successfully",
                    user: newUser,
                    insertedId: result.insertedId,
                });
            } catch (error) {
                console.error("Error creating user:", error);
                res.status(500).json({ message: "Internal server error" });
            }
        });


        // GET all users or filter by query
        app.get("/users", async (req, res) => {
            try {
                const { email } = req.query;


                let query = {};

                // console.log("emailllll",req.query)
                // Apply filters if provided
                if (email) query.email = email;

                const users = await usersCollection.find(query).toArray();

                if (users.length === 0) {
                    return res.status(404).json({ message: "No users found" });
                }

                res.status(200).json({
                    message: "Users retrieved successfully",
                    count: users.length,
                    users,
                });
            } catch (error) {
                console.error("Error fetching users:", error);
                res.status(500).json({ message: "Internal server error" });
            }
        });

        // Subscripton stat post api for subscription 
        // FREE PLAN SUBSCRIPTION API
        app.post("/free", async (req, res) => {
            try {
                const { title, planId, period, email, buyingDate, expireDate } = req.body;


                // Basic validation
                if (!title || !planId || !period || !email || !buyingDate || !expireDate) {
                    return res.status(400).json({ message: "Missing required fields" });
                }

                // Check if this user already has an active free plan
                const existing = await subscriptionCollection.findOne({
                    email,
                    planId: "0001",
                });

                if (existing) {
                    return res.status(409).json({
                        message: "You already have an active free plan."
                    });
                }

                // Insert new subscription
                const newSubscription = {
                    title,
                    planId,
                    period,
                    amount: "N/A",
                    email,
                    buyingDate,
                    expireDate,
                    createdAt: new Date().toISOString(),
                    status: "active",
                    transactionID: "N/A",

                };

                const result = await subscriptionCollection.insertOne(newSubscription);

                // -----------------------------------------
                //  SEND TO GOOGLE SHEET 
                // -----------------------------------------
                await fetch("https://script.google.com/macros/s/AKfycbzrlzWNKXh78Ke3nPMwPVPlwQfwsi7zxakamZ0NplJ1hCJN-8kaih-hUYG8RRMMMEUCtA/exec", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(newSubscription)
                });

                return res.status(200).json({
                    message: "Free plan activated successfully",
                    insertedId: result.insertedId
                });

            } catch (err) {
                console.error("Subscription error:", err);
                res.status(500).json({ message: "Internal server error" });
            }
        });




        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);



app.get('/', (req, res) => {
    res.send('Elevator is working')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})

const express = require('express')
const { MongoClient, ServerApiVersion } = require('mongodb');
const cors = require('cors');
var admin = require("firebase-admin");
const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_CREDENTIALS);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const app = express()
const port = 3000


// middle ware 
require('dotenv').config()
const allowedOrigin =
  process.env.NODE_ENV === "production"
    ? "https://elevator-backend.vercel.app/"
    : "http://localhost:5173";

app.use(cors({ origin: allowedOrigin }));

// only parse JSON for routes that are NOT /webhook
app.use((req, res, next) => {
  if (req.originalUrl === "/webhook") return next();
  express.json()(req, res, next);
});

const verifyFirebaseToken = async (req, res, next) => {
    const idToken = req.headers.authorization?.split('Bearer ')[1];

    if (!idToken) {
        console.log("token not found");
        return res.status(401).send({ error: 'Unauthorized: No token provided.' });
    }

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        
        req.user = decodedToken; 
        
        next();
    } catch (error) {
        console.error("Error verifying Firebase token:", error);
        return res.status(401).send({ error: 'Unauthorized: Invalid token.' });
    }
};

const stripe = require("stripe")(process.env.STRIPE_SK)

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@elevator.nxjbawz.mongodb.net/?appName=elevator`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

function calculateExpireDate(period) {
    const now = new Date();
    const [amount, unit] = period.split(" ");
    const num = parseInt(amount);

    switch (unit.toLowerCase()) {
    case "day":
    case "days":
        now.setDate(now.getDate() + num);
        break;
    case "week":
    case "weeks":
        now.setDate(now.getDate() + num * 7);
        break;
    case "month":
    case "months":
        now.setMonth(now.getMonth() + num);
        break;
    case "year":
    case "years":
        now.setFullYear(now.getFullYear() + num);
        break;
    default:
        throw new Error("Invalid period format");
    }

    return now.toISOString();
}

async function run() {

    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();
        const usersCollection = client.db('elevator-server').collection('users')
        const subscriptionCollection = client.db('elevator-server').collection('subscriptions')
        const plansCollection = client.db('elevator-server').collection('plans')

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

        // GET: Get a single plan by planId
        app.get("/plans/:planId", async (req, res) => {
            const planId = req.params.planId;

            try {
                const plan = await plansCollection.findOne({ planId });

                if (!plan) {
                    return res.status(404).json({ message: "Plan not found" });
                }

                res.json(plan);

            } catch (error) {
                console.error("Error fetching plan:", error);
                res.status(500).json({ message: "Server error" });
            }
        });

        // get patment intent 
        app.post("/api/create-payment-intent", verifyFirebaseToken, async (req, res) => {
            const { planId } = req.body

            const userEmail = req.user.email;

            const plan = await plansCollection.findOne({ planId });
            if (!plan) {
                return res.status(400).send({
                    success: false,
                    error: "invalid plan"
                });
            }

            const planPriceORE = Math.round(parseFloat(plan.price) * 100); 

            const paymentIntent = await stripe.paymentIntents.create({
                amount: planPriceORE,
                currency: "dkk",
                metadata: { userEmail, planId },
            });

            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });

        // webhook for strpe to get payment info
        app.post('/webhook', express.raw({type: 'application/json'}), async(req, res) => {
            let event = req.body;
            
            const endpointSecret = process.env.STRIPE_WEBHOOK_KEY;

            if (endpointSecret) {
                const signature = req.headers['stripe-signature'];
                try {
                event = stripe.webhooks.constructEvent(
                    req.body,
                    signature,
                    endpointSecret
                );
                } catch (err) {
                console.log(`Webhook signature verification failed.`, err.message);
                return res.sendStatus(400);
                }
            }

            if (event.type === 'payment_intent.succeeded') {
                const paymentIntent = event.data.object;

                const transactionID = paymentIntent.id;
                const existingSubscription = await subscriptionCollection.findOne({ transactionID: transactionID });

                if (existingSubscription) {
                    console.log(`[Idempotency Check] Payment Intent ${transactionID} already processed. Skipping fulfillment.`);
                    
                    return res.status(200).send({ received: true }); 
                }

                const planId = paymentIntent.metadata.planId;

                const plan = await plansCollection.findOne({ planId });

                const {title, period} = plan
                
                const newSubscription = {
                    title,
                    planId,
                    period,
                    amount: paymentIntent.amount,
                    email: paymentIntent.metadata.userEmail,
                    buyingDate: new Date().toISOString(),
                    expireDate: calculateExpireDate(period),
                    createdAt: new Date().toISOString(),
                    status: "active",
                    transactionID
                };

                const result = await subscriptionCollection.insertOne(newSubscription);

                // Send to Google Apps Script
                fetch("https://script.google.com/macros/s/AKfycbzrlzWNKXh78Ke3nPMwPVPlwQfwsi7zxakamZ0NplJ1hCJN-8kaih-hUYG8RRMMMEUCtA/exec", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(newSubscription)
                })
                .then(res => console.log("Saved to Google Sheet"))
                .catch(err => console.error("Error saving to Google Sheet:", err));

            }else{
                console.log(`Unhandled event type ${event.type}.`);
            }
            
            res.send();

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

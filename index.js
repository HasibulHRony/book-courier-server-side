const express = require('express')
const cors = require('cors')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express()
require('dotenv').config();
const crypto = require('crypto');
const port = process.env.PORT || 3000
const uri = `${process.env.MONGODB_URI}`;
const stripe = require('stripe')(process.env.STRIPE_SECRET_ID);


const admin = require("firebase-admin");

const serviceAccount = require("./book_courier_sdk_secrate.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});




//middleware
app.use(express.json());
app.use(cors());

const verifyFBToken = async (req, res, next) => {
    const token = req.headers.authorization;
    if (!token) {
        return res.status(401).send({ message: 'unauthorized access' })
    }
    try {
        const idToken = token.split(' ')[1];
        const decoded = await admin.auth().verifyIdToken(idToken);
        console.log('decoded in the token', decoded);
        req.decoded_email = decoded.email;
        next();
    }
    catch (err) {
        return res.status(401).send({ message: 'unauthorized access' })
    }
}


// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
})

function generateTrackingId() {
    const prefix = "PRCL";
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const random = crypto.randomBytes(3).toString("hex").toUpperCase();

    return `${prefix}-${date}-${random}`;
}


async function run() {
    try {
        await client.connect();
        const db = client.db('bookCourierDb')
        const usersCollection = db.collection('users')
        const booksCollection = db.collection('books')
        const ordersCollection = db.collection('orders')
        const paymentCollection = db.collection('payments')

        app.post('/users', async (req, res) => {
            const user = req.body;
            user.role = 'user';
            user.createdAt = new Date();
            const email = user.email;
            const existedUser = await usersCollection.findOne({ email })

            if (existedUser) {
                return res.send({ message: 'user is already existed' })
            }

            const result = await usersCollection.insertOne(user);
            res.send(result);
        })

        //books related api

        app.post('/books', async (req, res) => {
            const book = req.body;
            book.createdAt = new Date()
            const result = await booksCollection.insertOne(book)
            res.send(result)
        })

        app.patch('/books/:id', async (req, res) => {
            const id = req.params.id
            const query = { _id: new ObjectId(id) }
            const updatedInfo = req.body;
            const result = await booksCollection.updateOne(query, { $set: updatedInfo })
            res.send(result)
        })

        app.get('/books', async (req, res) => {
            const email = req.query.email;
            let query = {}
            if (email) {
                query = { librarianEmail: email }
            }

            const result = await booksCollection.find(query).toArray()
            res.send(result)

        })

        app.get('/books/:_id', async (req, res) => {
            const id = req.params._id;
            const query = { _id: new ObjectId(id) }
            const result = await booksCollection.findOne(query)
            res.send(result)
        })


        // payment related api
        app.post('/confirming-payment-session', async (req, res) => {
            const paymentInfo = req.body;
            const amount = parseInt(paymentInfo.price) * 100;
            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        price_data: {
                            currency: 'usd',
                            unit_amount: amount,
                            product_data: {
                                name: `You are paying for: ${paymentInfo.bookName}`
                            }
                        },
                        quantity: 1,
                    },
                ],
                mode: 'payment',
                metadata: {
                    bookId: paymentInfo.bookId,
                    orderId: paymentInfo.orderId,
                },
                customer_email: paymentInfo.customerEmail,
                success_url: `${process.env.BASE_SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.BASE_SITE_DOMAIN}/dashboard/payment-cancelled`,
            })

            res.send({ url: session.url })
        })


        //success message related api
        app.patch('/payment-success', async (req, res) => {
            const sessionId = req.query.session_id;

            const session = await stripe.checkout.sessions.retrieve(sessionId);

            // console.log('session retrieve', session)

            const transactionId = session.payment_intent;
            const query = { transactionId: transactionId }

            const paymentExist = await paymentCollection.findOne(query);
            console.log(paymentExist);
            if (paymentExist) {

                return res.send({
                    message: 'already exists',
                    transactionId,
                    trackingId: paymentExist.trackingId
                })
            }



            const trackingId = generateTrackingId()

            if (session.payment_status === 'paid') {
                const id = session.metadata.orderId;
                const query = { _id: new ObjectId(id) }
                const update = {
                    $set: {
                        paymentStatus: 'paid',
                        trackingId: trackingId
                    }
                }

                const result = await ordersCollection.updateOne(query, update);

                const payment = {
                    amount: session.amount_total / 100,
                    currency: session.currency,
                    customerEmail: session.customer_email,
                    // parcelId: session.metadata.parcelId,
                    // parcelName: session.metadata.parcelName,
                    bookId: session.metadata.bookId,
                    transactionId: session.payment_intent,
                    paymentStatus: session.payment_status,
                    paidAt: new Date(),
                    trackingId: trackingId
                }

                if (session.payment_status === 'paid') {
                    const resultPayment = await paymentCollection.insertOne(payment)

                    return res.send({
                        success: true,
                        modifyParcel: result,
                        trackingId: trackingId,
                        transactionId: session.payment_intent,
                        paymentInfo: resultPayment
                    })
                }

            }

            return res.send({ success: false })
        })


        //orders related apis
        app.post('/orders', async (req, res) => {
            const order = req.body
            order.createdAt = new Date()
            const result = await ordersCollection.insertOne(order)
            res.send(result)
        })

        app.get('/orders', async (req, res) => {
            const result = await ordersCollection.find().toArray();
            res.send(result);
        })


        app.patch('/orders/:id', async (req, res) => {
            const id = req.params.id;
            const { orderStatus, isCanceled } = req.body;

            const query = { _id: new ObjectId(id) };
            const updateDoc = { $set: {} };

            // ----- Task 1: Update Status -----
            if (orderStatus) {
                const allowedStatus = ["Pending", "Shifted", "Delivered"];

                if (!allowedStatus.includes(orderStatus)) {
                    return res.status(400).send({ message: "Invalid status value" });
                }

                updateDoc.$set.orderStatus = orderStatus;
            }

            // ----- Task 2: Cancel Order -----
            if (isCanceled === true) {
                updateDoc.$set.isCanceled = true;
                updateDoc.$set.orderStatus = "Cancelled";
            }

            // Prevent empty update
            if (Object.keys(updateDoc.$set).length === 0) {
                return res.status(400).send({ message: "No valid update field provided" });
            }

            updateDoc.$set.updatedAt = new Date();

            const result = await ordersCollection.updateOne(query, updateDoc);
            res.send(result);
        });



        app.get('/orders/:email', verifyFBToken, async (req, res) => {
            const email = req.params.email;

            if (email !== req.decoded_email) {
                return res.status(403).send({ message: 'forbidden access' })
            }

            const query = { customerEmail: email }

            const result = await ordersCollection.find(query).toArray()
            res.send(result)
        })


        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})

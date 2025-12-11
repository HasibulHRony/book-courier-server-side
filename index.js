const express = require('express')
const cors = require('cors')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express()
require('dotenv').config();
const port = process.env.PORT || 3000
const uri = `${process.env.MONGODB_URI}`;

//middleware
app.use(express.json());
app.use(cors());

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
})

async function run() {
    try {
        await client.connect();
        const db = client.db('bookCourierDb')
        const usersCollection = db.collection('users')
        const booksCollection = db.collection('books')
        const ordersCollection = db.collection('orders')

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



        //orders related apis
        app.post('/orders', async (req, res)=>{
            const order = req.body
            order.createdAt= new Date()
            const result = await ordersCollection.insertOne(order)
            res.send(result)
        })

        app.get('/orders/:email', async(req, res)=>{
            const email = req.params.email;
            const query = {customerEmail: email}
            
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

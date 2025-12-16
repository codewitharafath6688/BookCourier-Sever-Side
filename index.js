const express = require("express");
const app = express();
const port = process.env.PORT || 3000;
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");

const serviceAccount = require("./bookcourier-auth-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// middlewear
app.use(express.json());
app.use(cors());

// Verify Firebase Token
const verifyFBToken = async (req, res, next) => {
  // console.log("in the middlewaer", req.headers.authorization);
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log(decoded);
    req.decoded_email = decoded.email;
  } catch (error) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  next();
};

const uri = `mongodb+srv://${process.env.DB_User}:${process.env.DB_Pass}@cluster0.60jbasw.mongodb.net/?appName=Cluster0`;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

app.get("/", (req, res) => {
  res.send("BookCourier Server Side is active, now");
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    const db = client.db("bookCourier_db");
    const userCollection = db.collection("users");
    const librarianCollection = db.collection("librarians");

    // user related api

    app.get("/users", (req, res) => {});

    app.post("/users", async (req, res) => {
      const user = req.body;
      (user.role = "user"), (user.createdAt = new Date());
      const email = user.email;
      const userExist = await userCollection.findOne({ email });
      if (userExist) {
        return res.send({ message: "user already exist" });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    // librarian related api

    app.get("/librarians", async (req, res) => {
      const query = {};
      if (req.query.status) {
        query.status = req.query.status;
      }
      const cursor = librarianCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.post("/librarians", async (req, res) => {
      const librarian = req.body;
      const email = librarian.email;
      const existLibrarianEmail = await librarianCollection.findOne({ email });
      if (existLibrarianEmail) {
        return res.status(409).send({ message: "Already applied" });
      }
      librarian.status = "pending";
      librarian.createdAt = new Date();
      const result = await librarianCollection.insertOne(librarian);
      res.send(result);
    });

    app.patch("/librarians/:id",verifyFBToken , async (req, res) => {
      const status = req.body.status;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          status: status,
        },
      };
      const result = await librarianCollection.updateOne(query, updateDoc);
      if (status === "approved") {
        const email = req.decoded_email;
        const userQuery = { email };
        const updateUser = {
          $set: {
            role: "librarian",
          },
        };
        const userResult = await userCollection.updateOne(
          userQuery,
          updateUser
        );
        console.log(
          "User role update:",
          userResult.matchedCount,
          "matched,",
          userResult.modifiedCount,
          "modified"
        );
      }
      res.send(result);
    });

    app.delete("/librarians/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await librarianCollection.deleteOne(query);
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log("Back-End is active, now");
});

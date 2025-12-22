const express = require("express");
const app = express();
const port = process.env.PORT || 3000;
const cors = require("cors");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_Key);
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");

const serviceAccount = require("./bookcourier-auth-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

function generateTrackingId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `TRK-${date}-${rand}`;
}

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
    const addBookCollection = db.collection("books");
    const orderCollection = db.collection("orders");
    const paymentCollection = db.collection("payment");

    // middlewear for admin route

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await userCollection.findOne(query);
      if (!user || user?.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    const verifyLibrarian = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await userCollection.findOne(query);
      if (!user || user?.role !== "librarian") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // user related api

    app.get("/users", verifyFBToken, async (req, res) => {
      const cursor = userCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await userCollection.findOne(query);
      res.send({ role: user?.role || "user" });
    });

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

    app.patch("/users/:id", verifyFBToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const updateRole = req.body.role;
      const updateDoc = {
        $set: {
          role: updateRole,
        },
      };
      const result = await userCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    // user self order cancel

    app.patch("/user/order-cancel/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          deliveryStatus: "cancelled (yourself)",
        },
      };
      const orderCancel = await orderCollection.updateOne(query, updateDoc);
      res.send(orderCancel);
    });

    // user deleted order

    app.patch("/user/order-deleted/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const deletedOrder = await orderCollection.updateOne(query, {
        $set: { userOrderStatus: "deleted" },
      });
      res.send(deletedOrder);
    });

    // librarian related api

    app.get("/librarians", verifyFBToken, async (req, res) => {
      const query = {};
      if (req.query.status) {
        query.status = req.query.status;
      }
      const cursor = librarianCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/librarins/orders", verifyFBToken, async (req, res) => {
      const librarianEmail = req.query.email;
      const query = {
        librarianEmail,
        paymentStatus: "paid",
      };
      const orders = await orderCollection.find(query).toArray();
      res.send(orders);
    });

    app.post("/librarians", verifyFBToken, async (req, res) => {
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

    app.patch(
      "/librarians/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const status = req.body.status;
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const librarian = await librarianCollection.findOne(query);
        const updateDoc = {
          $set: {
            status: status,
          },
        };
        const result = await librarianCollection.updateOne(query, updateDoc);
        if (status === "approved") {
          const email = librarian.email;
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
      }
    );

    app.delete(
      "/librarians/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await librarianCollection.deleteOne(query);
        res.send(result);
      }
    );

    app.patch(
      "/librarians/user-order-remove/:id",
      verifyFBToken,
      verifyLibrarian,
      async (req, res) => {
        const id = req.params.id;
        const remove = await orderCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { librarianOrderStatus: "deleted" } }
        );
        res.send(remove);
      }
    );

    // addBook related api

    app.get("/add-book", async (req, res) => {
      const librarianEmail = req.query.email;
      const query = { librarianEmail };
      const cursor = addBookCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.post("/add-book", verifyFBToken, verifyLibrarian, async (req, res) => {
      const addBook = req.body;
      if (addBook.price) {
        addBook.price = parseFloat(addBook.price);
      }
      addBook.createdAt = new Date();
      const result = await addBookCollection.insertOne(addBook);
      res.send(result);
    });

    app.patch(
      "/add-book/:id",
      verifyFBToken,
      verifyLibrarian,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const fullInfo = req.body;
        const updateDoc = {
          $set: fullInfo,
        };
        const result = await addBookCollection.updateOne(query, updateDoc);
        res.send(result);
      }
    );

    // books show (for users)

    app.get("/books", verifyFBToken, async (req, res) => {
      const bookStatus = "published";
      const bookQuery = { bookStatus };
      const books = addBookCollection.find(bookQuery);
      const result = await books.toArray();
      res.send(result);
    });

    app.get("/books/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const books = await addBookCollection.findOne(query);
      res.send(books);
    });

    // orders related api

    app.get("/orders", verifyFBToken, async (req, res) => {
      const userEmail = req.decoded_email;
      const myOrders = await orderCollection.find({ userEmail }).toArray();
      res.send(myOrders);
    });

    app.post("/orders/:bookId", verifyFBToken, async (req, res) => {
      const { address } = req.body;
      const bookId = req.params.bookId;
      const userEmail = req.decoded_email;
      const query = { _id: new ObjectId(bookId) };
      const book = await addBookCollection.findOne(query);
      if (book.bookStatus === "published") {
        const order = {
          bookId,
          userEmail,
          address,
          bookName: book?.bookName,
          librarianEmail: book?.librarianEmail,
          price: book?.price,
          createdAt: new Date(),
          deliveryStatus: "pending",
          userOrderStatus: "",
          librarianOrderStatus: "",
        };
        const orderResult = await orderCollection.insertOne(order);
        return res.send(orderResult);
      }
      res.send({ message: "not available" });
    });

    app.patch("/orders/:id/status", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const deliveryStatus = req.body.deliveryStatus;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          deliveryStatus: deliveryStatus,
        },
      };
      const orders = await orderCollection.updateOne(query, updateDoc);
      res.send(orders);
    });

    // payment history

    app.get("/payment-history", verifyFBToken, async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.customerEmail = email;
      }
      const result = await paymentCollection.find(query).toArray();
      res.send(result);
    });

    // payment history deleted

    app.delete(
      "/payment-history/delete/:id",
      verifyFBToken,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const deletedPayment = await paymentCollection.deleteOne(query);
        res.send(deletedPayment);
      }
    );

    // payment related api

    app.get("/payment/:id", verifyFBToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await orderCollection.findOne(query);
      res.send(result);
    });

    app.post("/create-checkout-session", verifyFBToken, async (req, res) => {
      const paymentInfo = req.body;
      const amount = parseInt(paymentInfo.price) * 100;
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            // Provide the exact Price ID (for example, price_1234) of the product you want to sell
            price_data: {
              currency: "USD",
              unit_amount: amount,
              product_data: {
                name: paymentInfo.bookName,
                images: [paymentInfo.bookImageUrl],
              },
            },
            quantity: 1,
          },
        ],
        customer_email: req.decoded_email,
        mode: "payment",
        metadata: {
          orderId: paymentInfo.orderId,
          bookName: paymentInfo.bookName,
        },
        success_url: `${process.env.SITE_Domain}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_Domain}/dashboard/payment-cancelled`,
      });

      console.log(session);
      res.send({ url: session.url });
    });

    app.patch("/payment-success", verifyFBToken, async (req, res) => {
      const sessionId = req.query.session_id;
      // console.log(sessionId);
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      console.log("session retrieve", session);
      // const transactionId = session.payment_intent;
      // const query = { transactionId: transactionId };

      const paymentExist = await paymentCollection.findOne({
        sessionId: session.id,
      });
      if (paymentExist) {
        return res.send({
          message: "already exist",
          transactionId,
          trackingId: paymentExist.trackingId,
        });
      }
      const trackingId = generateTrackingId();
      if (session.payment_status === "paid") {
        const id = session.metadata.orderId;
        const query = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            paymentStatus: "paid",
            deliveryStatus: "awaiting_pickup",
            trackingId: trackingId,
          },
        };
        const result = await orderCollection.updateOne(query, updateDoc);

        const payment = {
          sessionId: session.id,
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          orderId: session.metadata.orderId,
          bookName: session.metadata.bookName,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId,
        };

        const paymentResult = await paymentCollection.insertOne(payment);

        return res.send({
          modifiedResult: result,
          trackingId: trackingId,
          transactionId: session.payment_intent,
          paymentInfo: paymentResult,
        });
      }
      res.send({ success: false });
    });

    // admin related api (control api)

    app.get(
      "/librarian-books",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const books = await addBookCollection.find().toArray();
        res.send(books);
      }
    );

    app.patch(
      "/librarian-books/:id/status",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const { bookStatus } = req.body;
        const updateDoc = {
          $set: {
            bookStatus: bookStatus,
          },
        };
        const result = await addBookCollection.updateOne(query, updateDoc);
        if (bookStatus === "unpublished") {
          const updateDoc1 = {
            $set: {
              deliveryStatus: "cancelled (refund)",
            },
          };
          const orderResult = await orderCollection.updateMany(
            { bookId: id },
            updateDoc1
          );
          return res.send(orderResult);
        }
        res.send(result);
      }
    );

    app.delete(
      "/admin/librarian-book/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const deleteBook = await addBookCollection.deleteOne(query);
        const updateDoc = {
          $set: {
            deliveryStatus: "cancelled (refund)",
          },
        };
        const cancelOrders = await orderCollection.updateMany(
          { bookId: id },
          updateDoc
        );
        res.send({ deleteBook: deleteBook, cancelOrders: cancelOrders });
      }
    );

    // admin deleted user

    app.delete(
      "/admin/user-delete/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const userDeleted = await userCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(userDeleted);
      }
    );

    // librarian dashboard

     app.get("/librarian/order/state", async (req, res) => {
      const pipeline = [
        {
          $group: {
            _id: "$librarianOrderStatus",
            count: { $sum: 1 },
          },
        },
        {
          $addFields: {
            label: {
              $switch: {
                branches: [
                  {
                    case: { $eq: ["$_id", "deleted"] },
                    then: "Librarian Cancel Orders",
                  },
                  {
                    case: { $eq: ["$_id", ""] },
                    then: "Active Orders",
                  },
                ],
                default: "Other Orders",
              },
            },
          },
        },
      ];
      const result = await orderCollection.aggregate(pipeline).toArray();
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

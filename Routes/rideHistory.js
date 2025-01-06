import express from "express";
import { rideHistory, users } from "../config/mongoCollection.js";
import { ObjectId } from "mongodb";

const router = express.Router();

const ensureAuthenticated = (req, res, next) => {
  if (req.session?.user) {
    next();
  } else {
    res.redirect("/login");
  }
};

router.get("/", ensureAuthenticated, async (req, res) => {
  try {
    const rideHistoryCollection = await rideHistory();
    const currentUser = req.session.user.username;

    const rides = await rideHistoryCollection
      .find({
        $or: [{ driver: currentUser }, { rider: currentUser }],
      })
      .sort({ archivedAt: -1 })
      .toArray();

    res.render("rideHistory", {
      rides,
      user: req.session?.user,
      stars: [1, 2, 3, 4, 5],
      showNav: true,
    });
  } catch (error) {
    console.error("Error fetching ride history:", error);
    res.status(500).send("Internal Server Error");
  }
});

router.post("/rateUser", ensureAuthenticated, async (req, res) => {
  try {
    const { rideId, userId, role, rating } = req.body;

    // Validate incoming data
    if (!rideId || !userId || !role || !rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "Invalid data provided" });
    }

    const rideHistoryCollection = await rideHistory();
    const usersCollection = await users();

    // Find the ride history document
    const ride = await rideHistoryCollection.findOne({
      _id: new ObjectId(rideId),
    });

    if (!ride) {
      return res.status(404).json({ error: "Ride not found" });
    }

    // Check if the rating has already been submitted
    if (
      (role === "driver" && ride.driverRated) ||
      (role === "rider" && ride.riderRated)
    ) {
      const alertMessage =
        role === "driver"
          ? `You have already rated the rider: ${ride.rider}`
          : `You have already rated the driver: ${ride.driver}`;
      return res.status(400).json({ error: alertMessage });
    }

    // Find the user to update
    const userToUpdate = await usersCollection.findOne({ username: userId });

    if (!userToUpdate) {
      return res.status(404).json({ error: "User not found" });
    }

    // Determine which field to update in the user's document
    const fieldToUpdate = role === "driver" ? "driver_review" : "rider_review";
    const reviewCountField =
      role === "driver" ? "driver_review_count" : "rider_review_count";

    // Calculate the updated rating
    const existingRating = userToUpdate[fieldToUpdate] || 0;
    const existingCount = userToUpdate[reviewCountField] || 0;

    const updatedRating =
      (existingRating * existingCount + rating) / (existingCount + 1);

    // Update the user's collection
    await usersCollection.updateOne(
      { username: userId },
      {
        $set: { [fieldToUpdate]: updatedRating.toFixed(1) }, // Update rating
        $inc: { [reviewCountField]: 1 }, // Increment review count
      }
    );

    // Mark the ride as rated
    const rideUpdateField = role === "driver" ? "driverRated" : "riderRated";
    await rideHistoryCollection.updateOne(
      { _id: new ObjectId(rideId) },
      { $set: { [rideUpdateField]: true } }
    );

    res
      .status(200)
      .json({ success: true, message: "Rating submitted successfully!" });
  } catch (error) {
    console.error("Error submitting rating:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/reportUser", ensureAuthenticated, async (req, res) => {
  try {
    const { rideId, userId } = req.body;
    const reportingUser = req.session.user.username;

    if (!rideId || !userId) {
      return res.status(400).json({ error: "Invalid data provided" });
    }

    const rideHistoryCollection = await rideHistory();
    const ride = await rideHistoryCollection.findOne({
      _id: new ObjectId(rideId),
    });

    if (!ride) {
      return res.status(404).json({ error: "Ride not found" });
    }

    if (ride.reportedBy?.includes(reportingUser)) {
      return res
        .status(400)
        .json({ error: "You have already reported this user." });
    }

    const usersCollection = await users();
    const reportedUser = await usersCollection.findOne({ username: userId });

    if (!reportedUser) {
      return res.status(404).json({ error: "User not found" });
    }

    await usersCollection.updateOne(
      { username: userId },
      { $inc: { number_of_reports_made: 1 } }
    );

    if ((reportedUser.number_of_reports_made || 0) + 1 > 3) {
      await usersCollection.deleteOne({ username: userId });
    }

    await rideHistoryCollection.updateOne(
      { _id: new ObjectId(rideId) },
      { $addToSet: { reportedBy: reportingUser } }
    );

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error reporting user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

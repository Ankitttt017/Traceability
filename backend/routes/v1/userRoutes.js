const express = require("express");
const userController = require("../../controllers/userController");
const { verifyToken, isAdmin } = require("../../middleware/authMiddleware");

const router = express.Router();

router.use(verifyToken, isAdmin);
router.get("/", userController.getUsers);
router.post("/", userController.createUser);
router.put("/:id", userController.updateUser);
router.delete("/:id", userController.deleteUser);

module.exports = router;

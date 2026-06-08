const express = require("express");
const userController = require("../../controllers/userController");
const { verifyToken } = require("../../middleware/authMiddleware");
const { requireModuleAccess } = require("../../middleware/roleAccessMiddleware");

const router = express.Router();

router.get("/", verifyToken, requireModuleAccess("users", "view"), userController.getUsers);
router.post("/", verifyToken, requireModuleAccess("users", "edit"), userController.createUser);
router.put("/:id", verifyToken, requireModuleAccess("users", "edit"), userController.updateUser);
router.delete("/:id", verifyToken, requireModuleAccess("users", "edit"), userController.deleteUser);

module.exports = router;

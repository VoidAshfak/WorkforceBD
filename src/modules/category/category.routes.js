import { Router } from "express";
import authenticate from "../../middleware/authenticate.js";
import * as categoryController from "./category.controller.js";

const router = Router();

// categories are reference data — readable by any authenticated role
router.use(authenticate);

router.get("/", categoryController.listCategories);

export default router;

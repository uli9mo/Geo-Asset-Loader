import { Router, type IRouter } from "express";
import healthRouter from "./health";
import countriesRouter from "./countries";

const router: IRouter = Router();

router.use(healthRouter);
router.use(countriesRouter);

export default router;

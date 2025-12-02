
import { Router } from "express";
import speechRoutes from "./routes/speech";
import quizRoutes from "./routes/quiz";

const router = Router();
router.use("/speech", speechRoutes);
router.use("/", quizRoutes);
export default router;

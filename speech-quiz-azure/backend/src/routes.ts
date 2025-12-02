
import { Router } from "express";
import speechRoutes from "./routes/speech";
import quizRoutes from "./routes/quiz";
import openaiTtsRoutes from "./routes/openai-tts";

const router = Router();
router.use("/speech", speechRoutes);
router.use("/openai", openaiTtsRoutes);
router.use("/", quizRoutes);
export default router;

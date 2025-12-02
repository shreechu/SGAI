
import { Router } from "express";
import speechRoutes from "./routes/speech";
import quizRoutes from "./routes/quiz";
import openaiTtsRoutes from "./routes/openai-tts";
import sessionsRoutes from "./routes/sessions";

const router = Router();
router.use("/speech", speechRoutes);
router.use("/openai", openaiTtsRoutes);
router.use("/api", sessionsRoutes);
router.use("/", quizRoutes);
export default router;

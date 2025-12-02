

import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import path from "path";
import collectRoutes from "./routes";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(morgan("dev"));

app.use("/api", collectRoutes);

// Serve frontend static files
const frontendDist = path.join(__dirname, "../../frontend/dist");
app.use(express.static(frontendDist));

// Fallback to index.html for React routing
app.get("*", (req, res) => {
  res.sendFile(path.join(frontendDist, "index.html"));
});

const port = process.env.PORT || 7071;
app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});

// Simple health endpoint for readiness checks
app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

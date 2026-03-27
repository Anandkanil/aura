import app from "./app.js";
import { env } from "./config/env.js";

const PORT = process.env.PORT || env.port || 4000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

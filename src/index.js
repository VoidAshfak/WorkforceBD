import "dotenv/config";
import app from "./app.js";
import { prisma } from "./db/index.js";

const PORT = process.env.PORT || 3000;

async function main() {
  const categories = await prisma.categories.findMany();
  console.log("Categories:", categories);

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { prisma } from "./index.js";

const categories = [
  "Medical Assistant",
  "Restaurant Staff",
  "Waiter",
  "Food Runner",
  "Event Staff",
  "Event Helper",
  "Retail Promoter",
  "Brand Activation Crew",
  "Production Assistant",
  "Cleaning Support",
  "Corporate Support",
];

const skills = [
  { name: "Waiter / Food Runner",       category: "Restaurant Staff" },
  { name: "Bartender",                  category: "Restaurant Staff" },
  { name: "Promoter / Activation Crew", category: "Brand Activation Crew" },
  { name: "Event Support Staff",        category: "Event Staff" },
  { name: "Production Assistant",       category: "Production Assistant" },
  { name: "Cleaning & Support Helper",  category: "Cleaning Support" },
  { name: "Security Staff",             category: "Event Staff" },
  { name: "Receptionist / Host",        category: "Corporate Support" },
];

async function seed() {
  console.log("Seeding categories...");
  for (const name of categories) {
    await prisma.categories.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log(`${categories.length} categories done.`);

  console.log("Seeding skills...");
  for (const { name, category } of skills) {
    const cat = await prisma.categories.findUnique({ where: { name: category } });
    await prisma.skills.upsert({
      where: { name },
      update: {},
      create: { name, category_id: cat?.id },
    });
  }
  console.log(`${skills.length} skills done.`);
}

seed()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

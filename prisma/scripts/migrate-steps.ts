import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrateSteps() {
  console.log('Starting step migration...');

  const testCases = await prisma.testCase.findMany({
    where: {
      steps: { not: null } as any,      deleted_at: null,
    },
    select: { id: true, steps: true },
  });

  console.log(`Found ${testCases.length} test cases with steps`);

  let totalSteps = 0;
  let successCount = 0;
  let errorCount = 0;

  for (const tc of testCases) {
    try {
      const stepsJson = tc.steps as any[];

      if (!Array.isArray(stepsJson)) {
        console.log(`Skipping ${tc.id}: steps is not an array`);
        continue;
      }

      for (let i = 0; i < stepsJson.length; i++) {
        const step = stepsJson[i];
        const order = step.order ?? step.Order ?? i + 1;
        const description = step.description ?? step.step ?? step.Description ?? '';
        const expectedResult = step.expectedResult ?? step.expected_result ?? step.ExpectedResult ?? '';
        const needsUpdate = step.needsUpdate ?? step.needs_update ?? false;

        await prisma.testCaseStep.create({
          data: {
            test_case_id: tc.id,
            reusable_step_id: null,
            order,
            step: description,
            expected_result: expectedResult || null,
            is_outdated: needsUpdate,
          },
        });
        totalSteps++;
      }
      successCount++;
    } catch (error) {
      console.error(`Error migrating steps for ${tc.id}:`, error);
      errorCount++;
    }
  }

  console.log(`Migration complete:`);
  console.log(`  Test cases processed: ${successCount}`);
  console.log(`  Test cases failed: ${errorCount}`);
  console.log(`  Total steps created: ${totalSteps}`);

  await prisma.$disconnect();
}

migrateSteps().catch((e) => {
  console.error('Migration failed:', e);
  process.exit(1);
});
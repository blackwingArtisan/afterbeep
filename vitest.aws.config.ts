import { defineConfig } from 'vitest/config';

/** Live AWS checks, kept out of `npm test`. Each file skips itself unless AFTERBEEP_AWS_TEST=1. */
export default defineConfig({
  test: {
    include: ['tests/aws/**/*.aws.test.ts'],
    environment: 'node',
  },
});

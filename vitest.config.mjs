export default {
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.mjs'],
    exclude: ['tests/e2e/**', 'test-results/**'],
    globals: true,
  },
};

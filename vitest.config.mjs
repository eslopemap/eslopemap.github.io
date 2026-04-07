export default {
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.mjs'],
    exclude: ['tests/e2e/**', 'test-results/**'],
    globals: true,
    coverage: {
      provider: 'v8',
      include: ['app/js/**/*.js'],
      exclude: ['app/vendor/**'],
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
    },
  },
};

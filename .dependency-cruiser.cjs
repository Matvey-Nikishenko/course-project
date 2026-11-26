module.exports = {
  forbidden: [
    {
      name: 'catalog-does-not-import-orders',
      severity: 'error',
      from: { path: '(^|/)(src/catalog|fixtures/gates/catalog)/' },
      to: { path: '(^|/)src/orders/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
  },
};

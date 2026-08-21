/**
 * Self-tests for the `require-openapi-tag` ESLint rule.
 *
 * Lives in coverage-dashboard rather than server, for the reason given in
 * eslintNoWorkItemIdInComment.test.ts: server/vitest.config.ts wires a globalSetup
 * that refuses to run without DB_PORT, which would couple an AST-only rule test to
 * the Docker Postgres stack.
 *
 * Assertions are on finding COUNT and message content, not exit status — a guard whose
 * only failure mode is silence has to prove it speaks. The must-NOT-flag cases matter
 * most: the rule sits one glob away from every route file in the repo.
 */
import { RuleTester } from 'eslint';
import rule from '../../../eslint-plugins/require-openapi-tag.mjs';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

const OPENAPI_BLOCK = '/**\n * @openapi\n * /things:\n *   get:\n *     summary: List\n */';

// RuleTester.run registers describe/it itself, so it must be called at module top level.
ruleTester.run('require-openapi-tag', rule, {
  valid: [
    // The shape every documented route uses: annotation, then the registration.
    { code: `${OPENAPI_BLOCK}\nrouter.get('/things', authenticate, asyncHandler(list));` },
    // A second router identifier — routes/ai.ts registers on aiUserRouter too.
    { code: `${OPENAPI_BLOCK}\naiUserRouter.post('/chat', asyncHandler(chat));` },
    // Every method the rule covers.
    { code: `${OPENAPI_BLOCK}\nrouter.patch('/x/:id', asyncHandler(update));` },
    { code: `${OPENAPI_BLOCK}\nrouter.delete('/x/:id', asyncHandler(remove));` },
    { code: `${OPENAPI_BLOCK}\nrouter.put('/x/:id', asyncHandler(replace));` },
    // Non-routes sharing the method names. The rule discriminates on call shape —
    // string-literal path plus a handler — so these stay clean regardless of the
    // object's name, and a router named anything at all is still covered.
    { code: 'cache.delete(key);' },
    { code: 'map.get(key);' },
    { code: 'emitter.post(message);' },
    { code: "store.get('some-key');" },
    { code: "app.use('/api/v1/things', thingRoutes);" },
    // Router mounting is not handler registration.
    { code: "router.use('/nested', nestedRouter);" },
  ],
  invalid: [
    // No JSDoc at all.
    {
      code: "router.get('/things', authenticate, asyncHandler(list));",
      errors: [{ messageId: 'missingOpenapiTag', data: { method: 'GET', path: '/things' } }],
    },
    // A JSDoc block that describes the handler but carries no tag — the gap that let
    // 49 handlers pass lint while being absent from the generated spec.
    {
      code: "/** Returns every thing. */\nrouter.get('/things', asyncHandler(list));",
      errors: [{ messageId: 'missingOpenapiTag', data: { method: 'GET', path: '/things' } }],
    },
    // A line comment is not a JSDoc block.
    {
      code: "// lists things\nrouter.post('/things', asyncHandler(create));",
      errors: [{ messageId: 'missingOpenapiTag', data: { method: 'POST', path: '/things' } }],
    },
    // Two undocumented registrations report twice, not once.
    {
      code: "router.get('/a', asyncHandler(a));\nrouter.post('/b', asyncHandler(b));",
      errors: [
        { messageId: 'missingOpenapiTag', data: { method: 'GET', path: '/a' } },
        { messageId: 'missingOpenapiTag', data: { method: 'POST', path: '/b' } },
      ],
    },
    // A docblock that only mentions the tag in prose is ordinary commentary — the
    // routes/{sso,teams,mfa}.ts file headers do exactly this, and matching the tag
    // anywhere would silence the rule for every handler beneath them.
    {
      code: "/** Route declarations + @openapi JSDoc only. */\nrouter.get('/x', asyncHandler(l));",
      errors: [{ messageId: 'missingOpenapiTag', data: { method: 'GET', path: '/x' } }],
    },
    // Registration shapes that must not escape by how they are written or what the
    // router is called. A rule that only matched `router.`/`ExpressionStatement` went
    // quiet on every one of these.
    {
      code: "v1Router.get('/a', asyncHandler(l));",
      errors: [{ messageId: 'missingOpenapiTag', data: { method: 'GET', path: '/a' } }],
    },
    {
      code: "this.router.get('/a', asyncHandler(l));",
      errors: [{ messageId: 'missingOpenapiTag', data: { method: 'GET', path: '/a' } }],
    },
    {
      code: "const registered = router.get('/a', asyncHandler(l));",
      errors: [{ messageId: 'missingOpenapiTag', data: { method: 'GET', path: '/a' } }],
    },
    {
      code: "export default router.get('/a', asyncHandler(l));",
      errors: [{ messageId: 'missingOpenapiTag', data: { method: 'GET', path: '/a' } }],
    },
    // .route() carries the path, so the chained .get() sees only a handler.
    {
      code: "router.route('/a').get(asyncHandler(l));",
      errors: [{ messageId: 'missingOpenapiTag', data: { method: 'GET', path: '/a' } }],
    },
    // Every link of a chain reports, not just the first.
    {
      code: "router.route('/a').get(g).post(p);",
      errors: [
        { messageId: 'missingOpenapiTag', data: { method: 'POST', path: '/a' } },
        { messageId: 'missingOpenapiTag', data: { method: 'GET', path: '/a' } },
      ],
    },
    // One JSDoc block documents one operation: it covers the innermost link only, so
    // the later methods of a chain still report. Otherwise one block hides the rest.
    {
      code: "/**\n * @openapi\n */\nrouter.route('/a').get(g).post(p);",
      errors: [{ messageId: 'missingOpenapiTag', data: { method: 'POST', path: '/a' } }],
    },
    // .all registers every method, so it needs a spec entry more than the others.
    {
      code: "router.all('/a', asyncHandler(l));",
      errors: [{ messageId: 'missingOpenapiTag', data: { method: 'ALL', path: '/a' } }],
    },
  ],
});

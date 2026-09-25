// Preserve each approved function's existing CORS response contract.
// Source-hash verification is performed by the deployer before this smoke check.
export function healthyEdgeOptions(functionName, status, actualSha, expectedSha, hasStamp) {
  const expectedStatus = functionName === 'render-wall-view' ? 204
    : functionName === 'production-panel-proof' ? 200 : null;
  if (expectedStatus === null || status !== expectedStatus || !/^[0-9a-f]{40}$/.test(expectedSha || '')) return false;
  return hasStamp === false || (hasStamp === true && actualSha === expectedSha);
}

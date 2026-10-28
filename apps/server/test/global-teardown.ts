export default async function globalTeardown() {
  await globalThis.__GT_PG__?.stop()
}

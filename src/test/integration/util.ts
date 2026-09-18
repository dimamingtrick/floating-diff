export async function waitFor(condition: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
	const start = Date.now();
	while (!condition()) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(`Timed out waiting for: ${what}`);
		}
		await new Promise(resolve => setTimeout(resolve, 50));
	}
}

// Validate before importing/initializing any Firebase SDK. Never echo environment values.
// Storage suites must pass { requireStorage: true } as the third argument.
// Import SDKs inside initialize; its Firestore connection arguments stay unchanged.
export async function withEmulatorSafety(
	env,
	initialize,
	{ requireStorage = false } = {},
) {
	const projectId = "demo-fincontrol";
	const unsafe = () => {
		throw new Error("Unsafe emulator environment");
	};
	if (
		env.GCLOUD_PROJECT !== projectId ||
		env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080"
	)
		unsafe();
	if (requireStorage && env.FIREBASE_STORAGE_EMULATOR_HOST !== "127.0.0.1:9199")
		unsafe();
	for (const key of Object.keys(env)) {
		if (
			/^(VITE_FIREBASE_|GOOGLE_APPLICATION_CREDENTIALS$|GOOGLE_OAUTH_ACCESS_TOKEN$|FIREBASE_TOKEN$|FIREBASE_SERVICE_ACCOUNT|CLOUDSDK_AUTH_)/.test(
				key,
			)
		)
			unsafe();
	}
	if (
		env.GOOGLE_CLOUD_PROJECT !== undefined &&
		env.GOOGLE_CLOUD_PROJECT !== projectId
	)
		unsafe();
	if (env.FIREBASE_CONFIG !== undefined) {
		let config;
		try {
			config = JSON.parse(env.FIREBASE_CONFIG);
		} catch {
			unsafe();
		}
		if (config?.projectId !== projectId) unsafe();
		if (
			config.databaseURL &&
			config.databaseURL !== `https://${projectId}.firebaseio.com`
		)
			unsafe();
		if (
			config.storageBucket &&
			![`${projectId}.appspot.com`, `${projectId}.firebasestorage.app`].includes(
				config.storageBucket,
			)
		)
			unsafe();
	}
	return initialize({ projectId, host: "127.0.0.1", port: 8080 });
}

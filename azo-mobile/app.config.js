const fs = require("node:fs");
const path = require("node:path");
const appJson = require("./app.json");

const expo = appJson.expo;
const localGoogleServicesFile = expo.android.googleServicesFile;
const android = { ...expo.android };
delete android.googleServicesFile;
const googleServicesFile =
  process.env.GOOGLE_SERVICES_JSON ??
  (localGoogleServicesFile &&
  fs.existsSync(path.resolve(__dirname, localGoogleServicesFile))
    ? localGoogleServicesFile
    : undefined);

if (process.env.EAS_BUILD && !googleServicesFile) {
  throw new Error(
    "GOOGLE_SERVICES_JSON is missing. Add the Firebase google-services.json as a file environment variable for this EAS environment.",
  );
}

module.exports = {
  ...expo,
  android: {
    ...android,
    ...(googleServicesFile ? { googleServicesFile } : {}),
  },
};

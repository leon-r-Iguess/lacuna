// Called by `npm version <x>`: copies the new version into manifest.json and versions.json.
import { readFileSync, writeFileSync } from "fs";

const target = process.env.npm_package_version;
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = target;
writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n");

const versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[target] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, 2) + "\n");

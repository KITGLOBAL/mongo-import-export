# mongo-import-export

![npm](https://img.shields.io/npm/v/@kitapp-developers/mongo-import-export?color=brightgreen&label=npm%20package)
[![downloads](https://img.shields.io/npm/dw/@kitapp-developers/mongo-import-export.svg?label=downloads)](https://www.npmjs.com/package/@kitapp-developers/mongo-import-export)
![Node.js](https://img.shields.io/badge/node-%3E=20.0.0-blue)
![License](https://img.shields.io/npm/l/@kitapp-developers/mongo-import-export?color=blue)
![Build](https://img.shields.io/badge/build-passing-brightgreen)
![Platform](https://img.shields.io/badge/platform-cli-lightgrey)

🚀 mongo-import-export

A modern and powerful CLI tool to import and export MongoDB collections to and from JSON and CSV files. Perfect for backups, migrations, and local development.

## ✨ Features & Key Advantages
This tool was built to make MongoDB data management as simple and effective as possible.

1. Interactive & User-Friendly: A step-by-step interactive prompt guides you through the entire import or export process with simple questions.

2. Multiple Format Support: Export your data to JSON for full data fidelity (including MongoDB-specific types like ObjectId and Date) or to CSV for easy use in spreadsheet editors.

3. Data Integrity Guarantee: During export, a manifest.sha256 file with checksums is automatically created. During import, these checksums are verified to ensure your files have not been corrupted or modified, giving you peace of mind.

4. High Performance with Streaming: Thanks to stream processing for JSON files, the utility can handle very large datasets (many gigabytes) without consuming excessive memory. This is perfect for large-scale backups and migrations.

5. Intelligent Database Selection: If a database is not specified in your connection string, the tool will automatically fetch a list of available databases on the server and let you choose the one you need.

6. Advanced Conflict Resolution: Gain full control over your data during imports with multiple strategies for handling duplicate documents:
```bash
upsert: Replaces existing documents or inserts new ones if they don't exist.
```
```bash
skip: Ignores (skips) documents that already exist in the collection.
```
```bash
insert: The default mode, which fails if a duplicate _id is found.
```
7. Data Integrity Verification: During export, a manifest.sha256 file is created with checksums for all files. During import, these checksums are verified to ensure your data has not been corrupted.

8. Clear Progress Indicators: Watch the export or import process in real-time with clean and informative progress bars for each collection.

9. Configuration via .env: Configure your settings once using a .env file to avoid re-entering your connection details every time.


## 📦 Installation

Global (recommended for CLI usage)
```bash
npm install -g @kitapp-developers/mongo-import-export@latest
```
Local (as project dependency)
```bash
npm install @kitapp-developers/mongo-import-export@latest
```
## 🛠️ Usage

Run the CLI:

```bash
mongo-import-export
```
```bash
npx mongo-import-export
```
An interactive prompt will guide you through:

1. Select Action: Choose between Export and Import.

2. Enter MongoDB URI: Provide the connection string to your MongoDB server.
```bash
mongodb://user:password@host:port/
```
3. Select Format: Choose between json and csv.

4. Database Selection (for Export):

5. If your URI included a database name (e.g., .../my-database), it will be used automatically.

6. If not, the tool will present a list of available databases for you to choose from.

Database & Strategy (for Import):

1. Enter the name of the target database.

2. Decide if you want to clear the collections before importing.

3. If not clearing, choose a conflict resolution strategy (Upsert, Skip, or Insert).

## 🧑‍💻 Example Workflow
```bash
? Select action: Import data into a database
? Enter MongoDB connection URI: mongodb://localhost:27017
? Select data format: json
? Enter database name to import to: myNewDatabase
? Clear collections before importing? Yes
```
## 🎬 Demo

![CLI demo](./assets/demo.gif)

## 👀 Configuration
You can optionally create a .env file in your project to set default values for the CLI prompts. Example:

```bash
MONGO_URI=mongodb://localhost:27017
# Default database name (optional)
DB_NAME=MyDatabase
# Folder for exported JSON files
DATA_FOLDER=./data
# Number of documents per import batch
BATCH_SIZE=1000
# Logging level (e.g., debug, info, warn, error)
LOG_LEVEL=info
# Log file path
LOG_FILE=mongo_script_log.txt
```
Place the .env file in the same directory where you run the CLI.

## ⚙️ Requirements
1. Node.js v20 or higher
2. MongoDB server accessible via the provided connection URL
3. Your smile

## 📖 License
MIT


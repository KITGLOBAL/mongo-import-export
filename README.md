# mongo-import-export

![npm](https://img.shields.io/npm/v/@kitapp-developers/mongo-import-export?color=brightgreen&label=npm%20package)
![Node.js](https://img.shields.io/badge/node-%3E=20.0.0-blue)
![License](https://img.shields.io/npm/l/@kitapp-developers/mongo-import-export?color=blue)
![Build](https://img.shields.io/badge/build-passing-brightgreen)
![Platform](https://img.shields.io/badge/platform-cli-lightgrey)

A powerful and easy-to-use CLI tool to import/export MongoDB collections to/from JSON and CSV files. Perfect for quick backups, migrations, and local development.

## Features
Interactive & User-Friendly: A step-by-step interactive prompt guides you through the entire process.

Multiple Formats: Supports both JSON for full data fidelity and CSV for compatibility with spreadsheets and other tools.

Intelligent Database Selection: If a database is not specified in your connection string, the tool will automatically fetch a list of available databases and let you choose one for export.

Advanced Conflict Resolution: Take full control of your data during imports with multiple strategies for handling duplicate documents:

Upsert: Replaces existing documents or inserts them if they are new.

Skip: Ignores documents that already exist in the collection.

Insert: The default mode, which will fail if a duplicate _id is found.

Progress Indicators: See what's happening during long operations with a clean and clear progress spinner.

Environment Configuration: Pre-configure your settings like connection URI and default database name using a .env file.

## Installation

Global (recommended for CLI usage)
```bash
npm install -g @kitapp-developers/mongo-import-export
```
Local (as project dependency)
```bash
npm install @kitapp-developers/mongo-import-export
```
## Usage

Run the CLI:

```bash
mongo-import-export
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

## Example
```bash
? Select action (0 - Export, 1 - Import): 1 - Import
? Enter MongoDB connection URL: mongodb://user:password@host:port/
? Select data format: json
? Enter database name to import to: newDatabase
? Clear collections before importing? (This will ignore conflict strategy) Yes
2025-06-30T09:32:12.192Z [INFO]: Connected to MongoDB
⠋ Starting import...2025-06-30T09:32:12.259Z [INFO]: Collection admins cleared
✔ Successfully processed 2 documents for collection admins
2025-06-30T09:32:12.371Z [INFO]: Collection products cleared
✔ Successfully processed 2 documents for collection products
2025-06-30T09:32:12.469Z [INFO]: Collection reports cleared
✔ Successfully processed 1 documents for collection reports
2025-06-30T09:32:12.577Z [INFO]: Collection setInfos cleared
✔ Successfully processed 16 documents for collection setInfos
2025-06-30T09:32:12.734Z [INFO]: Collection settings cleared
✔ Successfully processed 1 documents for collection settings
2025-06-30T09:32:12.842Z [INFO]: Collection themes cleared
✔ Successfully processed 168 documents for collection themes
2025-06-30T09:32:12.952Z [INFO]: Collection userSessions cleared
✔ Successfully processed 1 documents for collection userSessions
2025-06-30T09:32:13.037Z [INFO]: Collection users cleared
✔ Successfully processed 1 documents for collection users
2025-06-30T09:32:13.094Z [INFO]: Import completed
2025-06-30T09:32:13.099Z [INFO]: MongoDB connection closed
```

## Configuration
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

## Requirements
1. Node.js v20 or higher
2. MongoDB server accessible via the provided connection URL
3. Your smile

## License
MIT


# mongo-import-export

A powerful and easy-to-use CLI tool to import/export MongoDB collections to/from JSON files. Perfect for quick backups, migrations, and local development.

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

1. Choose an action (0 - Export, 1 - Import).
2. Specify the MongoDB connection URL.
3. For imports: Specify the database name and whether to clear collections.
4. For exports: Specify whether to clear the export folder.

## Example
```bash
mongo-import-export
```
Example walkthrough:

1. Select Import or Export
2. Enter MongoDB URI:
mongodb://user:password@host:port/db?authSource=admin
3. Confirm creation of new database if needed
4. Enter database name (e.g. MyDatabase)
5. Decide whether to clear existing collections before importing


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
LOG_LEVEL=debug
# Log file path
LOG_FILE=mongo_script_log.txt
```
Place the .env file in the same directory where you run the CLI.

## Requirements
1. Node.js v20 or higher
2. MongoDB server accessible via the provided connection URL

## License
MIT


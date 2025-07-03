# mongo-import-export

![npm](https://img.shields.io/npm/v/@kitapp-developers/mongo-import-export?color=brightgreen&label=npm%20package)
[![downloads](https://img.shields.io/npm/dw/@kitapp-developers/mongo-import-export.svg?label=downloads)](https://www.npmjs.com/package/@kitapp-developers/mongo-import-export)
![Node.js](https://img.shields.io/badge/node-%3E=20.0.0-blue)
![License](https://img.shields.io/npm/l/@kitapp-developers/mongo-import-export?color=blue)
![Build](https://img.shields.io/badge/build-passing-brightgreen)
![Platform](https://img.shields.io/badge/platform-cli-lightgrey)

## 🚀 mongo-import-export

A modern and powerful CLI tool to import and export MongoDB collections to and from JSON and CSV files. Perfect for backups, migrations, and local development.

---

## ✨ Features & Key Advantages

This tool was built to make MongoDB data management as simple and effective as possible:

### 1. 🎛️ Interactive & User-Friendly

- A step-by-step **interactive prompt** guides you through the entire import or export process with clear questions — no need to remember complex commands.

### 2. 📄 Multiple Format Support

- **JSON** — preserves full MongoDB fidelity (e.g., `ObjectId`, `Date`)
- **CSV** — ideal for spreadsheets like Excel or Google Sheets

### 3. 🛡️ Data Integrity Guarantee

- Each export includes a `manifest.sha256` with checksums
- During import, checksums are verified
- Ensures files haven’t been corrupted or tampered with

### 4. ⚡ High Performance with Streaming

- Stream-based processing for JSON files
- Handles datasets of **many gigabytes**
- Keeps memory usage minimal — perfect for large-scale backups/migrations

### 5. 🧠 Intelligent Database Selection

- If no database is specified in your connection string:
  - Connects to MongoDB server
  - Lists all available databases
  - Lets you choose interactively

### 6. 🔄 Advanced Conflict Resolution (During Import)

- `upsert`: Replace if exists, insert if not
- `skip`: Ignore documents that already exist
- `insert` *(default)*: Fail on duplicate `_id`

### 7. 📊 Clear Progress Indicators

- Real-time progress bars per collection
- Clean and informative CLI output
- Helpful for long-running operations

### 8. ⚙️ Configurable via `.env` File

Set default values and skip repetitive input:

```env
DATA_FOLDER=./data
BATCH_SIZE=1000
LOG_LEVEL=debug
LOG_FILE=mongo_script_log.txt
```

---

## 📦 Installation

**Global (recommended for CLI usage):**

```bash
npm install -g @kitapp-developers/mongo-import-export@latest
```

**Local (as project dependency):**

```bash
npm install @kitapp-developers/mongo-import-export@latest
```

---

## 🛠️ Usage

Run the CLI:

```bash
mongo-import-export
```

Or use without global install:

```bash
npx mongo-import-export
```

The CLI will guide you through:

1. **Select Action:** Import or Export
2. **MongoDB URI:**

```bash
mongodb://user:password@host:port/
```

3. **Select Format:** `json` or `csv`
4. **Database Selection:**
   - If URI includes a DB, it's used
   - Otherwise, select from list

**For Import:**

- Enter target DB name
- Choose whether to clear collections
- Choose conflict resolution strategy: Upsert / Skip / Insert

---

## 🧑‍💻 Example Workflow

```bash
? Select action: Import data into a database
? Enter MongoDB connection URI: mongodb://localhost:27017
? Select data format: json
? Enter database name to import to: myNewDatabase
? Clear collections before importing? Yes
```

---

## 🎬 Demo

![CLI demo](./assets/demo.gif)

## 👀 Configuration

Optional `.env` file for defaults:

```env
DATA_FOLDER=./data
BATCH_SIZE=1000
LOG_LEVEL=info
LOG_FILE=mongo_script_log.txt
```

Place `.env` in the same directory where you run the CLI.

---

## ⚙️ Requirements

1. Node.js v20 or higher
2. MongoDB server accessible via the provided connection URL
3. Your smile 😊

---

## 📖 License

MIT License


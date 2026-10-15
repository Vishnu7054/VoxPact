import express from 'express';
import cors from 'cors';
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { seedLiveMongo } from '../scripts/seedMongo.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
let currentMongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/voxpact';
let mongoClient = null;
let isConnected = false;
let dbInstance = null;

app.use(cors());
app.use(express.json());

// Helper to connect to MongoDB
async function connectToMongo(uri) {
  try {
    if (mongoClient) {
      await mongoClient.close();
    }
    mongoClient = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await mongoClient.connect();
    isConnected = true;
    currentMongoUri = uri;
    dbInstance = mongoClient.db();
    console.log(`✅ [MongoDB API] Connected to database: ${dbInstance.databaseName}`);
    return { success: true, dbName: dbInstance.databaseName };
  } catch (err) {
    isConnected = false;
    dbInstance = null;
    console.warn(`⚠️ [MongoDB API] Connection failed for ${uri}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// Initial connection attempt
connectToMongo(currentMongoUri);

// 1. Health & Connection Status
app.get('/api/status', async (req, res) => {
  let stats = {
    connected: isConnected,
    uri: currentMongoUri.replace(/\/\/[^@]+@/, '//***:***@'),
    database: isConnected && dbInstance ? dbInstance.databaseName : 'voxpact',
    counts: { campaigns: 4, vendors: 7, call_records: 7, evidence: 9 }
  };

  if (isConnected && dbInstance) {
    try {
      stats.counts = {
        campaigns: await dbInstance.collection('campaigns').countDocuments(),
        vendors: await dbInstance.collection('vendors').countDocuments(),
        call_records: await dbInstance.collection('call_records').countDocuments(),
        evidence: await dbInstance.collection('evidence_vault').countDocuments()
      };
    } catch (e) {
      console.warn('Count query failed:', e);
    }
  }

  res.json(stats);
});

// 2. Connect to Arbitrary MongoDB URI (e.g. MongoDB Atlas string from UI)
app.post('/api/connect', async (req, res) => {
  const { uri, autoSeed } = req.body;
  if (!uri) {
    return res.status(400).json({ success: false, error: 'MongoDB connection string (URI) required' });
  }

  const result = await connectToMongo(uri);
  if (result.success && autoSeed !== false) {
    await seedLiveMongo(uri);
  }

  res.json(result);
});

// 3. Trigger Re-Seed / Migration
app.post('/api/seed', async (req, res) => {
  const result = await seedLiveMongo(currentMongoUri);
  res.json(result);
});

// 4. Get Campaigns from MongoDB
app.get('/api/campaigns', async (req, res) => {
  if (isConnected && dbInstance) {
    try {
      const campaigns = await dbInstance.collection('campaigns').find({}).toArray();
      const vendors = await dbInstance.collection('vendors').find({}).toArray();
      // Join vendors
      const enriched = campaigns.map(c => ({
        ...c,
        id: c._id,
        vendors: vendors.filter(v => v.campaignId === c._id).map(v => ({ ...v, id: v._id }))
      }));
      return res.json({ source: 'mongodb', data: enriched });
    } catch (e) {
      console.warn('MongoDB query error:', e);
    }
  }

  // Fallback to local dump
  const dumpPath = path.resolve(__dirname, '../mongodb_dumps/voxpact_full_cluster_dump.json');
  if (fs.existsSync(dumpPath)) {
    const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
    return res.json({ source: 'local_dump', data: dump.collections.campaigns });
  }

  res.status(500).json({ error: 'No data source available' });
});

// 5. Get Archived Records from MongoDB
app.get('/api/records', async (req, res) => {
  if (isConnected && dbInstance) {
    try {
      const records = await dbInstance.collection('call_records').find({}).sort({ dateRecorded: -1 }).toArray();
      return res.json({ source: 'mongodb', data: records.map(r => ({ ...r, id: r._id })) });
    } catch (e) {
      console.warn('MongoDB query error:', e);
    }
  }

  const dumpPath = path.resolve(__dirname, '../mongodb_dumps/call_records.json');
  if (fs.existsSync(dumpPath)) {
    const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
    return res.json({ source: 'local_dump', data: dump });
  }

  res.json({ source: 'memory', data: [] });
});

// 6. Save new Call Record into MongoDB
app.post('/api/records', async (req, res) => {
  const record = req.body;
  if (!record) return res.status(400).json({ error: 'Record data required' });

  record._id = record.id || `rec_${Date.now()}`;
  record.createdAt = new Date().toISOString();

  if (isConnected && dbInstance) {
    try {
      await dbInstance.collection('call_records').insertOne(record);
      return res.json({ success: true, savedTo: 'mongodb', id: record._id });
    } catch (e) {
      console.warn('Could not insert record into MongoDB:', e);
    }
  }

  res.json({ success: true, savedTo: 'local_storage_fallback', id: record._id });
});

// 7. Live MongoDB Document Inspector & JSON Viewer API
app.get('/api/mongo/doc/:collection/:id', async (req, res) => {
  const { collection, id } = req.params;
  const startTime = performance.now();

  if (isConnected && dbInstance) {
    try {
      const col = dbInstance.collection(collection);
      let doc = await col.findOne({ _id: id });
      if (!doc) {
        doc = await col.findOne({ id: id });
      }

      if (doc) {
        const executionTimeMs = +(performance.now() - startTime).toFixed(2);
        return res.json({
          success: true,
          source: 'mongodb_live',
          database: dbInstance.databaseName,
          collection,
          uri: currentMongoUri.replace(/\/\/[^@]+@/, '//***:***@'),
          query: { $or: [{ _id: id }, { id }] },
          executionTimeMs,
          connected: true,
          document: doc
        });
      }
    } catch (e) {
      console.warn(`[MongoDB Inspector] Query failed for ${collection}/${id}:`, e);
    }
  }

  // Fallback to local dump if MongoDB query did not find it or disconnected
  const dumpPath = path.resolve(__dirname, `../mongodb_dumps/${collection}.json`);
  if (fs.existsSync(dumpPath)) {
    try {
      const items = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
      const found = items.find(item => item._id === id || item.id === id);
      if (found) {
        return res.json({
          success: true,
          source: isConnected ? 'mongodb_fallback' : 'local_json_dump',
          database: 'voxpact',
          collection,
          query: { _id: id },
          executionTimeMs: +(performance.now() - startTime).toFixed(2),
          connected: isConnected,
          document: found
        });
      }
    } catch (e) {
      console.warn('Dump read error:', e);
    }
  }

  res.status(404).json({
    success: false,
    error: `Document with ID "${id}" not found in collection "${collection}".`,
    collection,
    id
  });
});

// 8. Download Pre-Generated Full MongoDB Dump File
app.get('/api/download-dump', (req, res) => {
  const dumpPath = path.resolve(__dirname, '../mongodb_dumps/voxpact_full_cluster_dump.json');
  if (fs.existsSync(dumpPath)) {
    res.download(dumpPath, 'voxpact_mongodb_cluster_dump.json');
  } else {
    res.status(404).json({ error: 'Dump file not generated yet' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 [VoxPact Backend API] Listening at http://localhost:${PORT}`);
});

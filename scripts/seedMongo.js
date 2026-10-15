import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { CAMPAIGNS } from '../src/mockData.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default MongoDB URI (supports MongoDB Atlas or local MongoDB)
const MONGODB_URI = process.env.MONGODB_URI || process.argv[2] || 'mongodb://localhost:27017/voxpact';
const DB_NAME = process.env.MONGODB_DB || 'voxpact';

console.log('========================================================================');
console.log('🍃 VOXPACT — MONGODB SEED & EXPORT UTILITY');
console.log('========================================================================');

// 1. Prepare Data Collections
const campaignsCollection = [];
const vendorsCollection = [];
const callRecordsCollection = [];
const evidenceCollection = [];

CAMPAIGNS.forEach(c => {
  const campaignDoc = {
    _id: c.id,
    title: c.title,
    subtitle: c.subtitle,
    category: c.category,
    budgetCeiling: c.budgetCeiling,
    targetPrice: c.targetPrice,
    unit: c.unit,
    termMonths: c.termMonths,
    requirements: c.requirements,
    vendorIds: c.vendors.map(v => v.id),
    createdAt: new Date().toISOString()
  };
  campaignsCollection.push(campaignDoc);

  c.vendors.forEach(v => {
    const vendorDoc = {
      _id: v.id,
      campaignId: c.id,
      name: v.name,
      phone: v.phone,
      rep: v.rep,
      repTitle: v.repTitle,
      initialQuote: v.initialQuote,
      finalOffer: v.finalOffer,
      savings: v.savings,
      savingsPct: v.savingsPct,
      isLoss: v.isLoss || v.savings < 0,
      financialStatus: v.financialStatus || (v.savings >= 0 ? 'PROFIT / SAVINGS (议价盈利)' : 'DEFICIT / LOSS (超支亏损)'),
      netPL: (v.savings || 0) * (c.termMonths || 1),
      sla: v.sla,
      paymentTerms: v.paymentTerms,
      egressPolicy: v.egressPolicy,
      overallScore: v.overallScore,
      recommendationTier: v.recommendationTier,
      stressIndex: v.stressIndex,
      redFlags: v.redFlags || [],
      concessionsWon: v.concessionsWon || [],
      createdAt: new Date().toISOString()
    };
    vendorsCollection.push(vendorDoc);

    const callRecordDoc = {
      _id: `rec_${v.id}`,
      vendorId: v.id,
      vendorName: v.name,
      vendorRep: v.rep,
      vendorPhone: v.phone,
      campaignId: c.id,
      campaignTitle: c.title,
      campaignCategory: c.category,
      callDuration: v.callDuration || '03:15',
      initialQuote: v.initialQuote,
      finalOffer: v.finalOffer,
      savings: v.savings,
      savingsPct: v.savingsPct,
      isLoss: v.isLoss || v.savings < 0,
      financialStatus: v.financialStatus || (v.savings >= 0 ? 'PROFIT / SAVINGS (议价盈利)' : 'DEFICIT / LOSS (超支亏损)'),
      netPL: (v.savings || 0) * (c.termMonths || 1),
      unit: c.unit,
      status: v.status || 'Negotiation Concluded',
      dateRecorded: new Date().toISOString(),
      masterRecordingHash: `e9b4501a4e158d88e0b968a3556cf2d39891823759ad45bceb76814b7e${v.id.substring(2)}`,
      transcript: v.transcript || [],
      concessionsWon: v.concessionsWon || []
    };
    callRecordsCollection.push(callRecordDoc);

    // Extract key evidence points
    (v.transcript || []).filter(t => t.isKeyEvidence).forEach((t, idx) => {
      evidenceCollection.push({
        _id: `ev_${v.id}_${idx}`,
        vendorId: v.id,
        vendorName: v.name,
        campaignId: c.id,
        timestamp: t.time,
        speaker: t.speaker,
        quote: t.text,
        title: t.evidenceTitle || 'Verbal Concession',
        citation: t.evidenceCitation || t.text,
        tactic: t.tactic,
        legalStatus: 'VERBALLY BINDING (99.4%)',
        acousticStress: v.stressIndex
      });
    });
  });
});

// 2. Export Standalone JSON Dumps for MongoDB Compass / mongoimport
const exportDir = path.resolve(__dirname, '../mongodb_dumps');
if (!fs.existsSync(exportDir)) {
  fs.mkdirSync(exportDir, { recursive: true });
}

fs.writeFileSync(path.join(exportDir, 'campaigns.json'), JSON.stringify(campaignsCollection, null, 2));
fs.writeFileSync(path.join(exportDir, 'vendors.json'), JSON.stringify(vendorsCollection, null, 2));
fs.writeFileSync(path.join(exportDir, 'call_records.json'), JSON.stringify(callRecordsCollection, null, 2));
fs.writeFileSync(path.join(exportDir, 'evidence_vault.json'), JSON.stringify(evidenceCollection, null, 2));

const fullDump = {
  database: DB_NAME,
  exportedAt: new Date().toISOString(),
  counts: {
    campaigns: campaignsCollection.length,
    vendors: vendorsCollection.length,
    callRecords: callRecordsCollection.length,
    evidencePoints: evidenceCollection.length
  },
  collections: {
    campaigns: campaignsCollection,
    vendors: vendorsCollection,
    call_records: callRecordsCollection,
    evidence_vault: evidenceCollection
  }
};
fs.writeFileSync(path.join(exportDir, 'voxpact_full_cluster_dump.json'), JSON.stringify(fullDump, null, 2));

console.log(`📁 Standalone MongoDB JSON Dumps generated successfully in: ${exportDir}`);
console.log(`   - campaigns.json (${campaignsCollection.length} documents)`);
console.log(`   - vendors.json (${vendorsCollection.length} documents)`);
console.log(`   - call_records.json (${callRecordsCollection.length} documents)`);
console.log(`   - evidence_vault.json (${evidenceCollection.length} documents)`);
console.log(`   - voxpact_full_cluster_dump.json (all-in-one file)\n`);

// 3. Connect to live MongoDB and insert documents
export async function seedLiveMongo(uri = MONGODB_URI) {
  console.log(`🔗 Connecting to MongoDB cluster at: ${uri.replace(/\/\/[^@]+@/, '//***:***@')} ...`);
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 4000 });

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB successfully!');
    const db = client.db(DB_NAME);

    // Drop and reload collections
    const collections = [
      { name: 'campaigns', data: campaignsCollection },
      { name: 'vendors', data: vendorsCollection },
      { name: 'call_records', data: callRecordsCollection },
      { name: 'evidence_vault', data: evidenceCollection }
    ];

    for (const col of collections) {
      try {
        await db.collection(col.name).drop();
      } catch (err) {
        // collection might not exist yet
      }

      const res = await db.collection(col.name).insertMany(col.data);
      console.log(`   ✓ Seeded [${col.name}] with ${res.insertedCount} documents`);
    }

    // Create Indexes
    await db.collection('call_records').createIndex({ masterRecordingHash: 1 });
    await db.collection('call_records').createIndex({ vendorId: 1 });
    await db.collection('call_records').createIndex({ dateRecorded: -1 });
    await db.collection('vendors').createIndex({ campaignId: 1 });
    console.log('   ✓ Created performance and integrity indexes');

    console.log('\n🎉 MongoDB database "voxpact" is fully loaded and ready for production!');
    await client.close();
    return { success: true, uri, dbName: DB_NAME, counts: fullDump.counts };
  } catch (err) {
    console.log('\nℹ️  Live MongoDB Server Note:');
    console.log(`   Could not connect to ${uri}: ${err.message}`);
    console.log('   (If you have MongoDB Atlas or a remote cluster, provide the URI via MONGODB_URI in .env or run `node scripts/seedMongo.js "<your-atlas-uri>"`)');
    console.log('   The database files in ./mongodb_dumps can also be directly dragged and dropped into MongoDB Compass!');
    return { success: false, error: err.message, dumpsPath: exportDir };
  }
}

// Execute if run from CLI
if (process.argv[1] && process.argv[1].endsWith('seedMongo.js')) {
  seedLiveMongo();
}

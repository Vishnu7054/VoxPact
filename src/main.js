import { negotiationEngine } from './negotiationEngine.js';
import { telephonyAudio } from './audioEngine.js';
import confetti from 'canvas-confetti';

// State references
let currentTab = 'tab-mission';
let spectrogramAnimFrame = null;
let evidenceAudioTimer = null;
let activeEvidenceData = null;
let activeVaultRecord = null;

// Audio Spectrogram Canvas Setup
const canvas = document.getElementById('audio-spectrogram');
const ctx = canvas ? canvas.getContext('2d') : null;

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  initAudioBanner();
  initTabs();
  initCampaignSelector();
  initCallingControls();
  initWhisperCoPilot();
  initEvidenceModal();
  initTranscriptModal();
  initNewCampaignModal();
  initTermSheetActions();
  initSandboxDialer();
  initVaultControls();
  initMongoJsonModal();
  startSpectrogramVisualizer();

  // Subscribe to engine state changes
  negotiationEngine.subscribe((state) => {
    renderUI(state);
  });

  // Initial render
  renderUI(negotiationEngine.getState());
});

// Audio Activation banner
function initAudioBanner() {
  const banner = document.getElementById('audio-init-banner');
  const dismissBtn = document.getElementById('dismiss-banner-btn');

  const enableAudio = () => {
    telephonyAudio.init();
    if (banner) banner.classList.add('hidden');
    window.removeEventListener('click', enableAudio);
  };

  window.addEventListener('click', enableAudio, { once: true });
  if (dismissBtn) dismissBtn.addEventListener('click', enableAudio);

  // Audio toggles in header
  const sfxBtn = document.getElementById('toggle-sound-btn');
  const voiceBtn = document.getElementById('toggle-speech-btn');

  if (sfxBtn) {
    sfxBtn.addEventListener('click', () => {
      telephonyAudio.soundEnabled = !telephonyAudio.soundEnabled;
      sfxBtn.classList.toggle('active', telephonyAudio.soundEnabled);
    });
  }

  if (voiceBtn) {
    voiceBtn.addEventListener('click', () => {
      telephonyAudio.speechEnabled = !telephonyAudio.speechEnabled;
      voiceBtn.classList.toggle('active', telephonyAudio.speechEnabled);
    });
  }
}

// Navigation Tabs
function initTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const targetPane = document.getElementById(tab.dataset.tab);
      if (targetPane) targetPane.classList.add('active');
      currentTab = tab.dataset.tab;
    });
  });

  const jumpToContract = document.getElementById('btn-jump-to-contract');
  if (jumpToContract) {
    jumpToContract.addEventListener('click', () => {
      const contractTab = document.querySelector('[data-tab="tab-contract"]');
      if (contractTab) contractTab.click();
    });
  }
}

// Campaign Switcher
function initCampaignSelector() {
  const select = document.getElementById('campaign-select');
  const state = negotiationEngine.getState();

  select.innerHTML = state.campaigns.map(c => `
    <option value="${c.id}">${c.title}</option>
  `).join('');

  select.addEventListener('change', (e) => {
    negotiationEngine.setActiveCampaign(e.target.value);
  });

  const launchAllBtn = document.getElementById('btn-launch-all-calls');
  if (launchAllBtn) {
    launchAllBtn.addEventListener('click', () => {
      // Switch to calling tab and start call
      const callingTab = document.querySelector('[data-tab="tab-calling"]');
      if (callingTab) callingTab.click();
      negotiationEngine.startCall();
    });
  }
}

// Calling Controls
function initCallingControls() {
  const btnDial = document.getElementById('btn-dial-target');
  const btnHangup = document.getElementById('btn-hangup');
  const btnFastForward = document.getElementById('btn-fast-forward');

  if (btnDial) {
    btnDial.addEventListener('click', () => {
      negotiationEngine.startCall();
    });
  }

  if (btnHangup) {
    btnHangup.addEventListener('click', () => {
      negotiationEngine.stopCall();
    });
  }

  if (btnFastForward) {
    btnFastForward.addEventListener('click', () => {
      negotiationEngine.fastForwardCall();
    });
  }
}

// Live Whispering Co-Pilot
function initWhisperCoPilot() {
  const whisperPresets = document.querySelectorAll('.btn-preset-whisper');
  const whisperInput = document.getElementById('whisper-custom-input');
  const btnSendWhisper = document.getElementById('btn-send-whisper');

  whisperPresets.forEach(btn => {
    btn.addEventListener('click', () => {
      const prompt = btn.dataset.prompt;
      negotiationEngine.sendWhisper(prompt);
      const callingTab = document.querySelector('[data-tab="tab-calling"]');
      if (callingTab && currentTab !== 'tab-calling') callingTab.click();
    });
  });

  const handleCustomWhisper = () => {
    const val = whisperInput.value.trim();
    if (!val) return;
    negotiationEngine.sendWhisper(val);
    whisperInput.value = '';
    const callingTab = document.querySelector('[data-tab="tab-calling"]');
    if (callingTab && currentTab !== 'tab-calling') callingTab.click();
  };

  if (btnSendWhisper) btnSendWhisper.addEventListener('click', handleCustomWhisper);
  if (whisperInput) {
    whisperInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleCustomWhisper();
    });
  }
}

// Evidence Modal & Audio Player
function initEvidenceModal() {
  const modal = document.getElementById('modal-evidence-player');
  const closeBtn = document.getElementById('modal-ev-close');
  const dismissBtn = document.getElementById('modal-ev-dismiss');
  const playBtn = document.getElementById('btn-ev-play-audio');

  const closeModal = () => {
    if (modal) modal.classList.add('hidden');
    if (evidenceAudioTimer) {
      clearInterval(evidenceAudioTimer);
      evidenceAudioTimer = null;
    }
    telephonyAudio.stopSpeech();
  };

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (dismissBtn) dismissBtn.addEventListener('click', closeModal);

  if (playBtn) {
    playBtn.addEventListener('click', () => {
      if (!activeEvidenceData) return;
      playEvidenceAudio(activeEvidenceData);
    });
  }
}

function openEvidenceModal(evidenceData) {
  activeEvidenceData = evidenceData;
  const modal = document.getElementById('modal-evidence-player');
  const title = document.getElementById('modal-ev-title');
  const vendorMeta = document.getElementById('modal-ev-vendor');
  const quote = document.getElementById('modal-ev-quote');

  if (title) title.textContent = evidenceData.title || 'Verbal Concession Recording';
  if (vendorMeta) vendorMeta.textContent = `${evidenceData.vendorName || 'Apex Tensor Cloud'} • ${evidenceData.rep || 'Executive Sales'}`;
  if (quote) quote.textContent = `"${evidenceData.text || evidenceData.citation || 'Confirmed verbal agreement.'}"`;

  drawWaveformSample();
  if (modal) modal.classList.remove('hidden');
}

function drawWaveformSample() {
  const evCanvas = document.getElementById('ev-waveform-canvas');
  if (!evCanvas) return;
  const evCtx = evCanvas.getContext('2d');
  const w = evCanvas.width;
  const h = evCanvas.height;

  evCtx.clearRect(0, 0, w, h);
  const bars = 70;
  const barWidth = w / bars;

  for (let i = 0; i < bars; i++) {
    const x = i * barWidth;
    const progress = i / bars;
    const envelope = Math.sin(progress * Math.PI);
    const randomAmp = Math.random() * 0.7 + 0.3;
    const barHeight = Math.max(4, envelope * randomAmp * (h * 0.85));

    const gradient = evCtx.createLinearGradient(0, (h - barHeight) / 2, 0, (h + barHeight) / 2);
    gradient.addColorStop(0, '#06b6d4');
    gradient.addColorStop(1, '#8b5cf6');

    evCtx.fillStyle = gradient;
    evCtx.fillRect(x, (h - barHeight) / 2, barWidth - 2, barHeight);
  }
}

function playEvidenceAudio(evidenceData) {
  const cursor = document.getElementById('ev-scrub-cursor');
  const timeReadout = document.getElementById('ev-current-time');
  const playIcon = document.getElementById('ev-play-icon');
  const playLabel = document.getElementById('ev-play-label');

  if (playIcon) playIcon.textContent = '⏹';
  if (playLabel) playLabel.textContent = 'Playing Proof Audio...';

  let currentSec = 0;
  const totalSec = 6;

  if (evidenceAudioTimer) clearInterval(evidenceAudioTimer);
  evidenceAudioTimer = setInterval(() => {
    currentSec += 0.1;
    const pct = Math.min(100, (currentSec / totalSec) * 100);
    if (cursor) cursor.style.left = `${pct}%`;
    if (timeReadout) {
      const s = Math.floor(currentSec).toString().padStart(2, '0');
      timeReadout.textContent = `00:${s}`;
    }

    if (currentSec >= totalSec) {
      clearInterval(evidenceAudioTimer);
      evidenceAudioTimer = null;
      if (playIcon) playIcon.textContent = '▶';
      if (playLabel) playLabel.textContent = 'Replay Proof Audio';
      if (cursor) cursor.style.left = '0%';
    }
  }, 100);

  telephonyAudio.speak(evidenceData.text || evidenceData.citation, 'vendor');
}

// Modal 2: Transcript Viewer
function initTranscriptModal() {
  const modal = document.getElementById('modal-transcript-viewer');
  const closeBtn = document.getElementById('modal-trans-close');
  const dismissBtn = document.getElementById('modal-trans-dismiss');
  const exportTxtBtn = document.getElementById('btn-export-trans-modal');

  const closeModal = () => {
    if (modal) modal.classList.add('hidden');
  };

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (dismissBtn) dismissBtn.addEventListener('click', closeModal);

  if (exportTxtBtn) {
    exportTxtBtn.addEventListener('click', () => {
      if (!activeVaultRecord) return;
      downloadTxtTranscript(activeVaultRecord);
    });
  }
}

function openTranscriptModal(record) {
  activeVaultRecord = record;
  const modal = document.getElementById('modal-transcript-viewer');
  const title = document.getElementById('modal-trans-title');
  const subtitle = document.getElementById('modal-trans-subtitle');
  const feed = document.getElementById('modal-trans-feed');

  if (title) title.textContent = `${record.vendorName} — Negotiation Transcript`;
  if (subtitle) subtitle.textContent = `Rep: ${record.vendorRep} • Recorded: ${record.dateRecorded} • SHA-256 Verified`;

  if (feed) {
    feed.innerHTML = record.transcript.map(line => {
      const isAgent = line.speaker === 'agent';
      return `
        <div class="transcript-bubble ${isAgent ? 'bubble-agent' : 'bubble-vendor'}">
          <div class="bubble-header">
            <span class="speaker-badge ${isAgent ? 'agent' : 'vendor'}">
              ${isAgent ? '🤖 VoxPact (Voice Agent)' : `🏢 ${record.vendorName} (${record.vendorRep})`}
            </span>
            <span class="time-chip">${line.time}</span>
          </div>
          <div class="bubble-text">${line.text}</div>
          <div class="bubble-footer">
            <span class="tactic-tag">${line.tactic || 'Exchange'}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  if (modal) modal.classList.remove('hidden');
}

// Modal 4: MongoDB Live Document & JSON Inspector
let currentMongoViewDoc = null;
let currentMongoCollection = 'call_records';
let currentMongoLiveJson = null;

function initMongoJsonModal() {
  const modal = document.getElementById('modal-mongo-json-viewer');
  const closeBtn = document.getElementById('modal-mongo-close');
  const dismissBtn = document.getElementById('modal-mongo-dismiss');
  const copyBtn = document.getElementById('btn-copy-mongo-json');
  const downloadBtn = document.getElementById('btn-download-mongo-json');
  const refreshBtn = document.getElementById('btn-refresh-mongo-doc');
  const reseedBtn = document.getElementById('btn-reseed-mongo-from-modal');
  const colTabs = modal ? modal.querySelectorAll('.mongo-col-tab') : [];

  const closeModal = () => {
    if (modal) modal.classList.add('hidden');
  };

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (dismissBtn) dismissBtn.addEventListener('click', closeModal);

  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      if (!currentMongoLiveJson) return;
      const jsonStr = JSON.stringify(currentMongoLiveJson, null, 2);
      navigator.clipboard.writeText(jsonStr).then(() => {
        const icon = document.getElementById('copy-json-icon');
        const label = document.getElementById('copy-json-label');
        if (icon) icon.textContent = '✅';
        if (label) label.textContent = 'Copied to Clipboard!';
        setTimeout(() => {
          if (icon) icon.textContent = '📋';
          if (label) label.textContent = 'Copy JSON';
        }, 2000);
      });
    });
  }

  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      if (!currentMongoLiveJson) return;
      const jsonStr = JSON.stringify(currentMongoLiveJson, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const id = currentMongoLiveJson._id || currentMongoLiveJson.id || 'document';
      triggerBrowserDownload(blob, `MongoDB_${currentMongoCollection}_${id}.json`);
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      if (currentMongoViewDoc) {
        openMongoJsonViewer(currentMongoViewDoc, currentMongoCollection);
      }
    });
  }

  if (reseedBtn) {
    reseedBtn.addEventListener('click', async () => {
      reseedBtn.disabled = true;
      reseedBtn.textContent = '⏳ Syncing MongoDB...';
      try {
        const res = await fetch('http://localhost:3001/api/seed', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          alert('✅ MongoDB database "voxpact" refreshed and re-seeded successfully!');
          if (currentMongoViewDoc) openMongoJsonViewer(currentMongoViewDoc, currentMongoCollection);
        } else {
          alert('Note: ' + (data.error || 'Seed completed with dump fallback'));
        }
      } catch (e) {
        alert('Could not reach backend API at http://localhost:3001');
      } finally {
        reseedBtn.disabled = false;
        reseedBtn.textContent = '⚡ Seed & Sync MongoDB';
      }
    });
  }

  colTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      colTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const targetCol = tab.dataset.col;
      currentMongoCollection = targetCol;
      if (currentMongoViewDoc) {
        openMongoJsonViewer(currentMongoViewDoc, targetCol);
      }
    });
  });
}

function syntaxHighlightJson(json) {
  if (typeof json !== 'string') {
    json = JSON.stringify(json, null, 2);
  }
  json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
    let cls = 'json-number';
    if (/^"/.test(match)) {
      if (/:$/.test(match)) {
        cls = match.includes('_id') ? 'json-id' : 'json-key';
      } else {
        cls = 'json-string';
      }
    } else if (/true|false/.test(match)) {
      cls = 'json-boolean';
    } else if (/null/.test(match)) {
      cls = 'json-null';
    }
    return `<span class="${cls}">${match}</span>`;
  });
}

async function openMongoJsonViewer(docOrRecord, colName = 'call_records') {
  currentMongoViewDoc = docOrRecord;
  currentMongoCollection = colName;

  const modal = document.getElementById('modal-mongo-json-viewer');
  const title = document.getElementById('modal-mongo-title');
  const subtitle = document.getElementById('modal-mongo-subtitle');
  const liveBadge = document.getElementById('modal-mongo-live-badge');
  const queryText = document.getElementById('mongo-query-text');
  const execTime = document.getElementById('mongo-exec-time');
  const finBadge = document.getElementById('mongo-financial-badge');
  const docIdLabel = document.getElementById('mongo-doc-id-label');
  const codeBlock = document.getElementById('mongo-json-code');
  const compassCmd = document.getElementById('mongo-compass-cmd');

  if (modal) {
    modal.querySelectorAll('.mongo-col-tab').forEach(t => {
      if (t.dataset.col === colName) t.classList.add('active');
      else t.classList.remove('active');
    });
  }

  // Derive target ID for MongoDB
  let targetId = docOrRecord._id || docOrRecord.id;
  if (colName === 'call_records') {
    if (docOrRecord.id && docOrRecord.id.startsWith('rec_')) {
      targetId = docOrRecord.id;
    } else if (docOrRecord.vendorId) {
      targetId = `rec_${docOrRecord.vendorId}`;
    } else if (docOrRecord.id) {
      targetId = `rec_${docOrRecord.id.replace(/^REC-/, '')}`;
    }
  } else if (colName === 'vendors') {
    targetId = docOrRecord.vendorId || (docOrRecord.id ? docOrRecord.id.replace(/^REC-/, '') : 'v-apex');
  } else if (colName === 'campaigns') {
    targetId = docOrRecord.campaignId || negotiationEngine.activeCampaignId;
  } else if (colName === 'evidence_vault') {
    const vId = docOrRecord.vendorId || (docOrRecord.id ? docOrRecord.id.replace(/^REC-/, '') : 'v-skanda');
    targetId = `ev_${vId}_0`;
  }

  const displayName = docOrRecord.vendorName || docOrRecord.name || docOrRecord.title || targetId;
  if (title) title.textContent = `MongoDB Live Document: [${displayName}]`;
  if (subtitle) subtitle.textContent = `Database: voxpact • Collection: ${colName} • Indexed BSON Document`;
  if (docIdLabel) docIdLabel.textContent = `_id: "${targetId}"`;
  if (queryText) queryText.textContent = `db.${colName}.findOne({ "_id": "${targetId}" })`;
  if (compassCmd) compassCmd.textContent = `db.${colName}.findOne({ "_id": "${targetId}" })`;

  if (codeBlock) {
    codeBlock.innerHTML = `<span style="color: #64748b;">// Connecting to MongoDB cluster and querying db.${colName}.findOne({ "_id": "${targetId}" })...</span>`;
  }

  if (modal) modal.classList.remove('hidden');

  try {
    const res = await fetch(`http://localhost:3001/api/mongo/doc/${colName}/${encodeURIComponent(targetId)}`);
    const result = await res.json();

    if (result.success && result.document) {
      currentMongoLiveJson = result.document;
      if (codeBlock) codeBlock.innerHTML = syntaxHighlightJson(result.document);
      if (execTime) execTime.textContent = `⚡ ${result.executionTimeMs}ms`;
      if (liveBadge) {
        liveBadge.textContent = result.source === 'mongodb_live' ? '🟢 LIVE FROM MONGODB' : '📁 LOCAL MONGODB DUMP';
        liveBadge.className = result.source === 'mongodb_live' ? 'badge-tech status-badge-live' : 'badge-tech';
      }

      // Update Financial Badge
      const isLoss = result.document.isLoss || (result.document.savings !== undefined && result.document.savings < 0);
      if (finBadge) {
        if (isLoss) {
          finBadge.className = 'meta-chip status-chip loss';
          const lossAmt = Math.abs(result.document.savings || 0);
          finBadge.textContent = `🔴 DEFICIT / LOSS: -$${lossAmt.toLocaleString()}`;
        } else if (result.document.savings !== undefined) {
          finBadge.className = 'meta-chip status-chip profit';
          finBadge.textContent = `🟢 PROFIT / SAVINGS: +$${result.document.savings.toLocaleString()}`;
        } else {
          finBadge.className = 'meta-chip status-chip';
          finBadge.textContent = 'BSON RECORD';
        }
      }
    } else {
      currentMongoLiveJson = docOrRecord;
      if (codeBlock) codeBlock.innerHTML = syntaxHighlightJson(docOrRecord);
      if (execTime) execTime.textContent = `⚠️ Local Fallback`;
      if (liveBadge) {
        liveBadge.textContent = '📁 LOCAL OBJECT';
        liveBadge.className = 'badge-tech';
      }
    }
  } catch (err) {
    currentMongoLiveJson = docOrRecord;
    if (codeBlock) codeBlock.innerHTML = syntaxHighlightJson(docOrRecord);
    if (execTime) execTime.textContent = `⚠️ Local Fallback`;
    if (liveBadge) {
      liveBadge.textContent = '📁 LOCAL OBJECT';
      liveBadge.className = 'badge-tech';
    }
  }
}

// New Campaign Modal
function initNewCampaignModal() {
  const modal = document.getElementById('modal-new-campaign');
  const btnOpen = document.getElementById('btn-new-campaign');
  const btnClose = document.getElementById('modal-campaign-close');
  const btnCancel = document.getElementById('btn-cancel-campaign');
  const form = document.getElementById('form-new-campaign');

  const closeModal = () => {
    if (modal) modal.classList.add('hidden');
  };

  if (btnOpen) {
    btnOpen.addEventListener('click', () => {
      if (modal) modal.classList.remove('hidden');
    });
  }

  if (btnClose) btnClose.addEventListener('click', closeModal);
  if (btnCancel) btnCancel.addEventListener('click', closeModal);

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = document.getElementById('new-camp-title').value;
      const category = document.getElementById('new-camp-category').value || 'Procurement';
      const ceiling = document.getElementById('new-camp-ceiling').value;
      const target = document.getElementById('new-camp-target').value;
      const v1Str = document.getElementById('new-camp-v1').value;
      const v2Str = document.getElementById('new-camp-v2').value;

      const vendors = [];
      if (v1Str) {
        const parts = v1Str.split(',');
        vendors.push({
          name: parts[0]?.trim() || 'Vendor A',
          phone: parts[1]?.trim() || '+1 (800) 555-0100',
          rep: parts[2]?.trim() || 'Account Executive',
          initialQuote: Number(ceiling),
          finalOffer: Number(target)
        });
      }
      if (v2Str) {
        const parts = v2Str.split(',');
        vendors.push({
          name: parts[0]?.trim() || 'Vendor B',
          phone: parts[1]?.trim() || '+1 (800) 555-0200',
          rep: parts[2]?.trim() || 'Sales Director',
          initialQuote: Number(ceiling) * 1.1,
          finalOffer: Number(target) * 1.05
        });
      }

      negotiationEngine.createCampaign({
        title,
        category,
        budgetCeiling: ceiling,
        targetPrice: target,
        vendors
      });

      initCampaignSelector();
      closeModal();
      form.reset();
    });
  }
}

// Term Sheet Actions & Deal Lock
function initTermSheetActions() {
  const btnPrint = document.getElementById('btn-print-contract');
  const btnSeal = document.getElementById('btn-execute-seal');

  if (btnPrint) {
    btnPrint.addEventListener('click', () => {
      window.print();
    });
  }

  if (btnSeal) {
    btnSeal.addEventListener('click', () => {
      telephonyAudio.playTacticSound('concession');

      confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.6 },
        colors: ['#10b981', '#06b6d4', '#8b5cf6', '#f59e0b']
      });

      const sigBox = document.getElementById('vendor-sig-text');
      if (sigBox) {
        sigBox.textContent = 'COUNTERSIGNED & RECORDING HASH SEALED';
        sigBox.style.color = '#34d399';
        sigBox.style.fontWeight = 'bold';
      }

      btnSeal.innerHTML = '<span>✓ Deal Digitally Sealed</span>';
      btnSeal.style.background = '#059669';
    });
  }
}

// Voice Lab Sandbox Dialer
function initSandboxDialer() {
  const dtmfKeys = document.querySelectorAll('.dtmf-key');
  dtmfKeys.forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      telephonyAudio.playDTMF(key);
    });
  });

  const btnSimulate = document.getElementById('btn-run-sandbox-simulation');
  if (btnSimulate) {
    btnSimulate.addEventListener('click', () => {
      const bizName = document.getElementById('sandbox-biz-name').value || 'Target Vendor';
      const repName = document.getElementById('sandbox-rep-name').value || 'Sales Lead';
      const initial = document.getElementById('sandbox-initial-price').value || '85000';
      const target = document.getElementById('sandbox-target-price').value || '62000';
      const tacticSelect = document.getElementById('sandbox-tactic-select');
      const tacticText = tacticSelect.options[tacticSelect.selectedIndex].text;

      const outputBox = document.getElementById('sandbox-output-box');
      const linesContainer = document.getElementById('sandbox-transcript-lines');
      outputBox.classList.remove('hidden');

      telephonyAudio.playConnectChime();

      linesContainer.innerHTML = `
        <div class="transcript-bubble bubble-agent">
          <div class="bubble-header"><span class="speaker-badge agent">VoxPact Agent</span><span class="time-chip">00:08</span></div>
          <div class="bubble-text">"Good day ${repName}. This is VoxPact autonomous negotiator. We are ready to execute our procurement mandate, but list rate of $${initial} is non-viable. Employing ${tacticText}, our firm target is $${target} flat."</div>
        </div>
      `;

      telephonyAudio.speak(`Good day ${repName}. This is VoxPact autonomous negotiator. We are ready to execute our procurement mandate, but list rate of $${initial} is non-viable. Our firm target is $${target} flat.`, 'agent', () => {
        setTimeout(() => {
          linesContainer.innerHTML += `
            <div class="transcript-bubble bubble-vendor">
              <div class="bubble-header"><span class="speaker-badge vendor">${bizName} (${repName})</span><span class="time-chip">00:22</span></div>
              <div class="bubble-text">"That is an aggressive counter, but we are prepared to meet you at $${target} if we can confirm the annual commitment today."</div>
              <div class="bubble-footer"><span class="tactic-tag">Concession Granted</span></div>
            </div>
          `;
          telephonyAudio.playTacticSound('concession');
          telephonyAudio.speak(`That is an aggressive counter, but we are prepared to meet you at $${target} if we can confirm the annual commitment today.`, 'vendor');
        }, 1200);
      });
    });
  }
}

// TAB 6: Call Records Vault Controls & MongoDB Sync
function initVaultControls() {
  const btnPlay = document.getElementById('btn-vault-play');
  const btnStop = document.getElementById('btn-vault-stop');
  const btnMongoConnect = document.getElementById('btn-mongo-connect');
  const btnMongoExport = document.getElementById('btn-mongo-export-dumps');
  const mongoUriInput = document.getElementById('mongo-uri-input');
  const mongoBadge = document.getElementById('mongo-status-badge');
  const mongoDbName = document.getElementById('mongo-db-name');
  const mongoDocs = document.getElementById('mongo-docs-val');

  // Check initial backend MongoDB status
  const checkMongoStatus = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/status');
      if (res.ok) {
        const data = await res.json();
        if (mongoBadge) {
          if (data.connected) {
            mongoBadge.textContent = '🍃 CONNECTED TO MONGODB';
            mongoBadge.className = 'badge-count status-mongo-badge';
          } else {
            mongoBadge.textContent = '🍃 SERVER READY • READY TO SYNC ATLAS';
            mongoBadge.className = 'badge-count status-mongo-badge offline';
          }
        }
        if (mongoDbName) mongoDbName.textContent = data.database || 'voxpact';
        if (mongoDocs && data.counts) {
          const totalDocs = Object.values(data.counts).reduce((a, b) => a + b, 0);
          mongoDocs.textContent = `${totalDocs} documents`;
        }
      }
    } catch (e) {
      if (mongoBadge) {
        mongoBadge.textContent = '🍃 MONGODB DUMPS READY';
        mongoBadge.className = 'badge-count status-mongo-badge offline';
      }
    }
  };

  checkMongoStatus();

  // Connect to MongoDB (Atlas or Local)
  if (btnMongoConnect) {
    btnMongoConnect.addEventListener('click', async () => {
      const uri = mongoUriInput ? mongoUriInput.value.trim() : '';
      if (!uri) {
        alert('Please enter a MongoDB connection string (e.g. mongodb+srv://... or mongodb://localhost:27017/voxpact)');
        return;
      }

      btnMongoConnect.disabled = true;
      btnMongoConnect.innerHTML = '<span>⏳ Connecting & Seeding...</span>';

      try {
        const res = await fetch('http://localhost:3001/api/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uri, autoSeed: true })
        });
        const result = await res.json();

        if (result.success) {
          if (mongoBadge) {
            mongoBadge.textContent = '🍃 CONNECTED & SYNCED';
            mongoBadge.className = 'badge-count status-mongo-badge';
          }
          alert(`✅ Successfully connected and synced VoxPact database to MongoDB [${result.dbName}]!`);
          checkMongoStatus();
        } else {
          alert(`⚠️ Connection Note:\n${result.error}\n\nTip: You can paste your MongoDB Atlas Cloud URI (mongodb+srv://...) or import the JSON dumps directly using MongoDB Compass.`);
          if (mongoBadge) {
            mongoBadge.textContent = '⚠️ MONGODB OFFLINE';
            mongoBadge.className = 'badge-count status-mongo-badge offline';
          }
        }
      } catch (err) {
        alert(`API Error: Could not reach VoxPact Backend API at http://localhost:3001.\nMake sure 'npm run server' is active.`);
      } finally {
        btnMongoConnect.disabled = false;
        btnMongoConnect.innerHTML = '<span>⚡ Connect & Sync</span>';
      }
    });
  }

  // Export full cluster dump
  if (btnMongoExport) {
    btnMongoExport.addEventListener('click', async () => {
      try {
        window.open('http://localhost:3001/api/download-dump', '_blank');
      } catch (e) {
        alert('Downloaded MongoDB dump from ./mongodb_dumps/voxpact_full_cluster_dump.json');
      }
    });
  }

  if (btnPlay) {
    btnPlay.addEventListener('click', () => {
      if (!activeVaultRecord) return;
      playArchivedCallAudio(activeVaultRecord);
    });
  }

  if (btnStop) {
    btnStop.addEventListener('click', () => {
      telephonyAudio.stopFullCallPlayback();
      const playIcon = document.getElementById('vault-play-icon');
      const playText = document.getElementById('vault-play-text');
      const progressFill = document.getElementById('vault-progress-fill');
      if (playIcon) playIcon.textContent = '▶';
      if (playText) playText.textContent = 'Listen Full Call Recording';
      if (progressFill) progressFill.style.width = '0%';
      if (btnPlay) btnPlay.disabled = false;
      if (btnStop) btnStop.disabled = true;
    });
  }
}

function playArchivedCallAudio(record) {
  const btnPlay = document.getElementById('btn-vault-play');
  const btnStop = document.getElementById('btn-vault-stop');
  const playIcon = document.getElementById('vault-play-icon');
  const playText = document.getElementById('vault-play-text');
  const playerVendor = document.getElementById('vault-player-vendor');
  const playerInfo = document.getElementById('vault-player-info');
  const progressFill = document.getElementById('vault-progress-fill');
  const speakerTag = document.getElementById('vault-active-step-speaker');
  const stepText = document.getElementById('vault-active-step-text');

  if (playerVendor) playerVendor.textContent = `${record.vendorName} (${record.vendorRep})`;
  if (playerInfo) playerInfo.textContent = `Mission: ${record.campaignTitle} • Agreed: $${record.finalOffer.toLocaleString()}/${record.unit} • Hash: ${record.masterRecordingHash.substring(0, 16)}...`;

  if (btnPlay) btnPlay.disabled = true;
  if (btnStop) btnStop.disabled = false;
  if (playIcon) playIcon.textContent = '🔊';
  if (playText) playText.textContent = 'Playing Master Recording...';

  const totalSteps = record.transcript.length;

  telephonyAudio.playFullCallSequence(
    record.transcript,
    (index, step) => {
      const pct = Math.round(((index + 1) / totalSteps) * 100);
      if (progressFill) progressFill.style.width = `${pct}%`;
      if (speakerTag) speakerTag.textContent = step.speaker === 'agent' ? '🤖 VoxPact' : `🏢 ${record.vendorRep}`;
      if (stepText) stepText.textContent = `"${step.text}"`;
    },
    () => {
      // Completed playback
      if (btnPlay) btnPlay.disabled = false;
      if (btnStop) btnStop.disabled = true;
      if (playIcon) playIcon.textContent = '▶';
      if (playText) playText.textContent = 'Replay Call Recording';
      if (progressFill) progressFill.style.width = '100%';
      if (stepText) stepText.textContent = 'Full master recording replay concluded.';
    }
  );
}

// File Exporters for Human Checking & Compliance
function downloadJsonAudit(record) {
  const jsonString = JSON.stringify(record, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  triggerBrowserDownload(blob, `VoxPact_Audit_${record.vendorName.replace(/\s+/g, '_')}_${Date.now()}.json`);
}

function downloadTxtTranscript(record) {
  let content = `========================================================================\n`;
  content += `VOXPACT — OFFICIAL TELEPHONY PROCUREMENT AUDIT RECORD\n`;
  content += `========================================================================\n\n`;
  content += `Mission: ${record.campaignTitle}\n`;
  content += `Target Counterparty: ${record.vendorName}\n`;
  content += `Representative: ${record.vendorRep} (${record.vendorPhone})\n`;
  content += `Timestamp: ${record.dateRecorded}\n`;
  content += `Call Duration: ${record.duration}\n`;
  content += `Standard List Quote: $${record.initialQuote.toLocaleString()}\n`;
  content += `Agreed Locked Price: $${record.finalOffer.toLocaleString()} (${record.savingsPct}% Discount)\n`;
  content += `Net Dollars Saved: $${record.savings.toLocaleString()}\n`;
  content += `Master Recording Hash: ${record.masterRecordingHash}\n\n`;
  content += `------------------------------------------------------------------------\n`;
  content += `VERBATIM TIMESTAMPED TELEPHONY TRANSCRIPT\n`;
  content += `------------------------------------------------------------------------\n\n`;

  record.transcript.forEach(t => {
    const speakerLabel = t.speaker === 'agent' ? 'VOXPACT AI' : record.vendorRep.toUpperCase();
    content += `[${t.time}] ${speakerLabel} (${t.tactic || 'Exchange'}):\n"${t.text}"\n\n`;
  });

  content += `------------------------------------------------------------------------\n`;
  content += `EXECUTED CONCESSIONS & BINDING RIDERS:\n`;
  (record.concessionsWon || []).forEach((c, idx) => {
    content += `${idx + 1}. ${c}\n`;
  });
  content += `\nVerification Standard: Cryptographic Audio Biometric Seal\n`;

  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  triggerBrowserDownload(blob, `VoxPact_Transcript_${record.vendorName.replace(/\s+/g, '_')}.txt`);
}

function downloadWavAudio(record) {
  const wavBlob = telephonyAudio.generateCallWavBlob(record);
  triggerBrowserDownload(wavBlob, `VoxPact_Audio_${record.vendorName.replace(/\s+/g, '_')}.wav`);
}

function triggerBrowserDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Spectrogram Visualizer Animation Loop
function startSpectrogramVisualizer() {
  if (!ctx || !canvas) return;

  const width = canvas.width;
  const height = canvas.height;
  const bars = 48;
  const barWidth = width / bars;

  function renderFrame() {
    ctx.fillStyle = '#020408';
    ctx.fillRect(0, 0, width, height);

    const state = negotiationEngine.getState();
    const isCallActive = state.activeCall.status === 'NEGOTIATING' || state.activeCall.status === 'CONNECTED';
    const isDialing = state.activeCall.status === 'DIALING' || state.activeCall.status === 'RINGING';

    for (let i = 0; i < bars; i++) {
      let amp = 0.05;

      if (isCallActive) {
        const timeFactor = Date.now() * 0.005;
        const wave = Math.sin(i * 0.3 + timeFactor) * Math.cos(i * 0.2 - timeFactor * 0.8);
        amp = Math.max(0.08, Math.abs(wave) * 0.9 * (Math.random() * 0.4 + 0.6));
      } else if (isDialing) {
        const pulse = Math.sin(Date.now() * 0.015);
        amp = pulse > 0 ? 0.4 : 0.05;
      } else {
        amp = 0.06 + Math.sin(i * 0.2 + Date.now() * 0.002) * 0.03;
      }

      const barHeight = amp * height;
      const x = i * barWidth;
      const y = height - barHeight;

      const grad = ctx.createLinearGradient(0, y, 0, height);
      if (isCallActive) {
        grad.addColorStop(0, '#22d3ee');
        grad.addColorStop(0.5, '#06b6d4');
        grad.addColorStop(1, '#0e7490');
      } else {
        grad.addColorStop(0, '#334155');
        grad.addColorStop(1, '#0f172a');
      }

      ctx.fillStyle = grad;
      ctx.fillRect(x + 1, y, barWidth - 2, barHeight);
    }

    spectrogramAnimFrame = requestAnimationFrame(renderFrame);
  }

  renderFrame();
}

// Global UI Renderer
function renderUI(state) {
  const { activeCampaign, activeVendor, activeCall, stats, callArchive } = state;

  // Header P&L Stats (Profit & Loss)
  const statGross = document.getElementById('stat-gross-savings');
  const statLosses = document.getElementById('stat-total-losses');
  const statNet = document.getElementById('stat-net-pl');
  if (statGross) statGross.textContent = `+$${(stats.grossSavings || stats.totalSavings).toLocaleString()}`;
  if (statLosses) statLosses.textContent = `-$${(stats.totalLosses || 0).toLocaleString()}`;
  if (statNet) {
    const netVal = stats.netPL !== undefined ? stats.netPL : stats.totalSavings;
    statNet.textContent = `${netVal >= 0 ? '+' : '-'}$${Math.abs(netVal).toLocaleString()}`;
  }

  // Mission Info
  const missionTitle = document.getElementById('mission-title');
  const missionSub = document.getElementById('mission-subtitle');
  const missionCat = document.getElementById('mission-category');
  const dispCeiling = document.getElementById('display-budget-ceiling');
  const dispTarget = document.getElementById('display-target-price');
  const reqList = document.getElementById('mission-req-list');
  const targetCount = document.getElementById('target-vendors-count');

  if (missionTitle) missionTitle.textContent = activeCampaign.title;
  if (missionSub) missionSub.textContent = activeCampaign.subtitle;
  if (missionCat) missionCat.textContent = activeCampaign.category.toUpperCase();
  if (dispCeiling) dispCeiling.textContent = `$${activeCampaign.budgetCeiling.toLocaleString()}/${activeCampaign.unit}`;
  if (dispTarget) dispTarget.textContent = `$${activeCampaign.targetPrice.toLocaleString()}/${activeCampaign.unit}`;
  if (targetCount) targetCount.textContent = `${activeCampaign.vendors.length} Targets`;

  if (reqList) {
    reqList.innerHTML = (activeCampaign.requirements || []).map(r => `<li>${r}</li>`).join('');
  }

  // Render Target Vendor Roster Cards
  const vendorRosterList = document.getElementById('target-vendors-list');
  if (vendorRosterList) {
    vendorRosterList.innerHTML = activeCampaign.vendors.map((v, i) => {
      const isWinner = v.recommendationTier === 'BEST OVERALL';
      const isLoss = v.isLoss || (v.savings !== undefined && v.savings < 0);
      const isRisk = v.recommendationTier.includes('RISK') || v.recommendationTier.includes('REJECT') || isLoss;
      const tierClass = isLoss ? 'tier-loss' : (isWinner ? 'best' : isRisk ? 'risk' : 'runner');
      const tierLabel = isLoss ? 'DEFICIT / LOSS (超支亏损)' : v.recommendationTier;
      const icon = isLoss ? '🔴' : (isWinner ? '👑' : isRisk ? '⚠️' : '🏢');

      return `
        <div class="roster-card ${isLoss ? 'loss-card' : ''}" data-vendor-id="${v.id}">
          <div class="roster-left">
            <div class="vendor-icon-box">${icon}</div>
            <div>
              <div class="vendor-name-row">
                <span class="roster-vendor-name">${v.name}</span>
                <span class="tier-badge ${tierClass}">${tierLabel}</span>
              </div>
              <div class="roster-vendor-meta">
                <span>${v.phone}</span> • <span>${v.rep} (${v.repTitle})</span>
              </div>
            </div>
          </div>

          <div class="roster-pricing">
            <div class="price-col">
              <span class="price-sub">Initial Rack Quote</span>
              <span class="price-num strikethrough">$${v.initialQuote.toLocaleString()}</span>
            </div>
            <div class="price-col">
              <span class="price-sub">${isLoss ? 'Cost Overrun (Loss)' : 'Final Negotiated'}</span>
              <span class="price-num ${isLoss ? 'danger-text' : 'success-text'}">$${v.finalOffer.toLocaleString()}/${activeCampaign.unit}</span>
            </div>
            <button class="btn-roster-call" data-dial-vendor="${v.id}">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              <span>Call Rep</span>
            </button>
          </div>
        </div>
      `;
    }).join('');

    vendorRosterList.querySelectorAll('[data-dial-vendor]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const vId = btn.dataset.dialVendor;
        const callingTab = document.querySelector('[data-tab="tab-calling"]');
        if (callingTab) callingTab.click();
        negotiationEngine.startCall(vId);
      });
    });
  }

  renderCallHUD(state);
  renderEvidenceVault(state);
  renderTermSheet(state);
  renderCallVault(callArchive);
}

function renderCallHUD(state) {
  const { activeCall, activeVendor } = state;

  const statusDot = document.getElementById('call-status-dot');
  const statusLabel = document.getElementById('call-status-label');
  const timer = document.getElementById('call-timer');
  const callBadge = document.getElementById('live-call-badge');
  const btnDial = document.getElementById('btn-dial-target');
  const btnHangup = document.getElementById('btn-hangup');

  const hudVendor = document.getElementById('hud-vendor-name');
  const hudPhone = document.getElementById('hud-vendor-phone');
  const hudRep = document.getElementById('hud-vendor-rep');
  const activeSpeaker = document.getElementById('audio-active-speaker');

  const tensionPct = document.getElementById('tension-percentage');
  const tensionFill = document.getElementById('tension-fill');
  const tensionDesc = document.getElementById('tension-state-desc');
  const tacticDisplay = document.getElementById('active-tactic-name');

  if (hudVendor) hudVendor.textContent = activeVendor.name;
  if (hudPhone) hudPhone.textContent = activeVendor.phone;
  if (hudRep) hudRep.textContent = `${activeVendor.rep} (${activeVendor.repTitle})`;

  if (statusLabel) statusLabel.textContent = `LINE ${activeCall.status}`;
  if (tacticDisplay) tacticDisplay.textContent = activeCall.currentTactic;

  if (statusDot) {
    statusDot.className = 'status-dot';
    if (activeCall.status === 'DIALING' || activeCall.status === 'RINGING') {
      statusDot.classList.add('active');
    } else if (activeCall.status === 'CONNECTED' || activeCall.status === 'NEGOTIATING') {
      statusDot.classList.add('connected');
    }
  }

  if (activeSpeaker) {
    activeSpeaker.textContent = activeCall.status === 'NEGOTIATING' ? 'VOXPACT SPEAKING' : 'CARRIER STANDBY';
  }

  if (timer) {
    const m = Math.floor(activeCall.durationSeconds / 60).toString().padStart(2, '0');
    const s = (activeCall.durationSeconds % 60).toString().padStart(2, '0');
    timer.textContent = `${m}:${s}`;
  }

  if (callBadge) {
    if (activeCall.isSimulating) callBadge.classList.remove('hidden');
    else callBadge.classList.add('hidden');
  }

  if (btnDial && btnHangup) {
    btnDial.disabled = activeCall.isSimulating;
    btnHangup.disabled = !activeCall.isSimulating;
  }

  if (tensionPct) tensionPct.textContent = `${activeCall.tension}%`;
  if (tensionFill) tensionFill.style.width = `${activeCall.tension}%`;
  if (tensionDesc) {
    if (activeCall.tension > 70) tensionDesc.textContent = 'High Stress • Close to Floor';
    else if (activeCall.tension < 35) tensionDesc.textContent = 'Cooperative • Willing Partner';
    else tensionDesc.textContent = 'Active Posturing / Resistance';
  }

  const feed = document.getElementById('live-transcript-feed');
  const evidenceCountPill = document.getElementById('evidence-found-count');

  if (feed) {
    if (activeCall.transcript.length === 0) {
      feed.innerHTML = `
        <div class="feed-empty-state">
          <div class="empty-icon">📞</div>
          <h4>No Active Call In Progress</h4>
          <p>Click "Dial Target" to start autonomous voice negotiation, or select a vendor from Mission Control.</p>
        </div>
      `;
    } else {
      let evFound = 0;
      feed.innerHTML = activeCall.transcript.map(line => {
        const isAgent = line.speaker === 'agent';
        if (line.isKeyEvidence) evFound++;

        return `
          <div class="transcript-bubble ${isAgent ? 'bubble-agent' : 'bubble-vendor'} ${line.isWhisper ? 'whisper-injected' : ''}">
            <div class="bubble-header">
              <span class="speaker-badge ${isAgent ? 'agent' : 'vendor'}">
                ${isAgent ? '🤖 VoxPact (Voice Agent)' : `🏢 ${activeVendor.name} (${activeVendor.rep})`}
              </span>
              <span class="time-chip">${line.time}</span>
            </div>
            <div class="bubble-text">${line.text}</div>
            <div class="bubble-footer">
              <span class="tactic-tag">${line.tactic || 'Exchange'}</span>
              ${line.isKeyEvidence ? `
                <button class="btn-proof-tag" data-inspect-quote="${encodeURIComponent(line.text)}" data-inspect-title="${encodeURIComponent(line.evidenceTitle || 'Verbal Concession')}">
                  ▶ PROOF EVIDENCE
                </button>
              ` : ''}
            </div>
          </div>
        `;
      }).join('');

      if (evidenceCountPill) evidenceCountPill.textContent = `${evFound} Evidence Points`;
      feed.scrollTop = feed.scrollHeight;

      feed.querySelectorAll('[data-inspect-quote]').forEach(btn => {
        btn.addEventListener('click', () => {
          openEvidenceModal({
            title: decodeURIComponent(btn.dataset.inspectTitle),
            text: decodeURIComponent(btn.dataset.inspectQuote),
            vendorName: activeVendor.name,
            rep: activeVendor.rep
          });
        });
      });
    }
  }
}

function renderEvidenceVault(state) {
  const { activeCampaign } = state;
  const winner = activeCampaign.vendors[0];

  const winTitle = document.getElementById('rec-winner-name');
  const winSummary = document.getElementById('rec-winner-summary');
  const winSavings = document.getElementById('rec-savings-amount');
  const winScore = document.getElementById('rec-composite-score');
  const winBullets = document.getElementById('rec-bullet-proofs');

  if (winTitle) winTitle.textContent = winner.name;
  if (winSavings) {
    const totalAnnSavings = winner.savings * (activeCampaign.termMonths || 1);
    winSavings.textContent = `$${totalAnnSavings.toLocaleString()}`;
  }
  if (winScore) winScore.textContent = `${winner.overallScore} / 100`;

  if (winBullets) {
    winBullets.innerHTML = (winner.concessionsWon || []).map(c => `
      <div class="proof-bullet">${c}</div>
    `).join('');
  }

  const tableBody = document.getElementById('matrix-table-body');
  if (tableBody) {
    tableBody.innerHTML = activeCampaign.vendors.map(v => {
      const isWinner = v.recommendationTier === 'BEST OVERALL';
      const hasDanger = (v.redFlags || []).some(f => f.type === 'danger');

      return `
        <tr>
          <td>
            <div class="vendor-cell">
              <strong>${v.name}</strong>
              <span class="vendor-rep-sub">${v.rep} (${v.phone})</span>
            </div>
          </td>
          <td><span class="table-rate-strike">$${v.initialQuote.toLocaleString()}</span></td>
          <td><span class="table-rate-won ${v.savings < 0 ? 'loss-text' : ''}">$${v.finalOffer.toLocaleString()}/${activeCampaign.unit}</span></td>
          <td><span class="savings-tag ${v.savings < 0 ? 'loss-tag' : ''}">${v.savings >= 0 ? '+' : '-'}$${Math.abs(v.savings).toLocaleString()} (${v.savingsPct > 0 ? '+' : ''}${v.savingsPct}%)</span></td>
          <td>${v.sla}</td>
          <td>${v.paymentTerms}</td>
          <td>
            <span class="risk-pill ${v.isLoss ? 'risk-deficit' : hasDanger ? 'risk-high' : 'risk-low'}">
              ${v.isLoss ? 'DEFICIT / LOSS (超支)' : hasDanger ? 'HIGH HAZARD' : 'AUDITED SAFE'}
            </span>
          </td>
          <td>
            <div class="vault-actions-cell">
              <button class="btn-proof-tag" data-inspect-quote="${encodeURIComponent(v.concessionsWon[0] || v.sla)}" data-inspect-title="${encodeURIComponent(v.name + ' Verified Terms')}" data-vendor="${v.name}" data-rep="${v.rep}">
                ▶ PROOF
              </button>
              <button class="btn-vault-action view-json" data-matrix-json="${v.id}" title="View in MongoDB / JSON">🍃 .JSON</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tableBody.querySelectorAll('[data-inspect-quote]').forEach(btn => {
      btn.addEventListener('click', () => {
        openEvidenceModal({
          title: decodeURIComponent(btn.dataset.inspectTitle),
          text: decodeURIComponent(btn.dataset.inspectQuote),
          vendorName: btn.dataset.vendor,
          rep: btn.dataset.rep
        });
      });
    });

    tableBody.querySelectorAll('[data-matrix-json]').forEach(btn => {
      btn.addEventListener('click', () => {
        const vId = btn.dataset.matrixJson;
        const vendor = activeCampaign.vendors.find(v => v.id === vId);
        if (vendor) {
          openMongoJsonViewer(vendor, 'vendors');
        }
      });
    });
  }

  const flagsContainer = document.getElementById('red-flags-container');
  if (flagsContainer) {
    const allFlags = [];
    activeCampaign.vendors.forEach(v => {
      (v.redFlags || []).forEach(f => {
        allFlags.push({ ...f, vendorName: v.name });
      });
    });

    if (allFlags.length === 0) {
      flagsContainer.innerHTML = `
        <div class="flag-item-card">
          <div class="flag-icon">🛡️</div>
          <div>
            <div class="flag-vendor-name">All Vendor Contracts Verified Clean</div>
            <div class="flag-text">Acoustic and semantic scanning detected zero automatic lock-in traps or hidden overage escalators.</div>
          </div>
        </div>
      `;
    } else {
      flagsContainer.innerHTML = allFlags.map(f => `
        <div class="flag-item-card ${f.type === 'danger' ? 'danger' : ''}">
          <div class="flag-icon">${f.type === 'danger' ? '🚨' : '⚠️'}</div>
          <div>
            <div class="flag-vendor-name">${f.vendorName}</div>
            <div class="flag-text">${f.text}</div>
          </div>
        </div>
      `).join('');
    }
  }
}

function renderTermSheet(state) {
  const { activeCampaign } = state;
  const winner = activeCampaign.vendors[0];

  const vendorName = document.getElementById('contract-vendor-name');
  const vendorRep = document.getElementById('contract-vendor-rep');
  const scopeDesc = document.getElementById('contract-scope-desc');
  const rackRate = document.getElementById('contract-rack-rate');
  const finalRate = document.getElementById('contract-final-rate');
  const savingsPct = document.getElementById('contract-savings-pct');
  const concessionsList = document.getElementById('contract-concessions-list');
  const citationText = document.getElementById('contract-verbal-citation');
  const audioHash = document.getElementById('contract-audio-hash');

  if (vendorName) vendorName.textContent = winner.name;
  if (vendorRep) vendorRep.textContent = `${winner.rep} (${winner.repTitle})`;
  if (scopeDesc) scopeDesc.textContent = activeCampaign.subtitle;
  if (rackRate) rackRate.textContent = `$${winner.initialQuote.toLocaleString()} / ${activeCampaign.unit}`;
  if (finalRate) finalRate.textContent = `$${winner.finalOffer.toLocaleString()} / ${activeCampaign.unit}`;
  if (savingsPct) savingsPct.textContent = `${winner.savingsPct}% Margin Reduction (-$${winner.savings.toLocaleString()}/${activeCampaign.unit})`;

  if (concessionsList) {
    concessionsList.innerHTML = (winner.concessionsWon || []).map(c => `<li>${c}</li>`).join('');
  }

  if (citationText) {
    const keyStep = winner.transcript.find(t => t.isKeyEvidence) || winner.transcript[winner.transcript.length - 1];
    citationText.textContent = `"${keyStep ? keyStep.text : 'Commercial terms accepted and locked.'}" — ${winner.rep} [${keyStep ? keyStep.time : '02:08'}]`;
  }

  if (audioHash) {
    audioHash.textContent = `Telephony Master Audio Hash: e9b4501a4e158d88e0b968a3556cf2d39891823759ad45bceb76814b7e80f2ad (Sealed at ${new Date().toISOString()})`;
  }
}

// TAB 6: Render Call Records & Audio Vault
function renderCallVault(callArchive) {
  const vaultBody = document.getElementById('vault-table-body');
  const badgeCount = document.getElementById('vault-badge-count');
  const btnPlay = document.getElementById('btn-vault-play');

  if (badgeCount) badgeCount.textContent = `${callArchive.length} Archived`;

  if (vaultBody) {
    vaultBody.innerHTML = callArchive.map(record => {
      return `
        <tr>
          <td>
            <div class="vendor-cell">
              <strong>${record.vendorName}</strong>
              <span class="vendor-rep-sub">${record.vendorRep} (${record.vendorPhone})</span>
            </div>
          </td>
          <td>${record.campaignTitle}</td>
          <td><span class="time-chip">${record.dateRecorded}</span></td>
          <td><span class="time-chip">${record.duration}</span></td>
          <td><span class="table-rate-strike">$${record.initialQuote.toLocaleString()}</span></td>
          <td><span class="table-rate-won ${record.savings < 0 ? 'loss-text' : ''}">$${record.finalOffer.toLocaleString()}</span></td>
          <td><span class="savings-tag ${record.savings < 0 ? 'loss-tag' : ''}">${record.savings >= 0 ? '+' : '-'}$${Math.abs(record.savings).toLocaleString()} (${record.savingsPct > 0 ? '+' : ''}${record.savingsPct}%)</span></td>
          <td>
            <div class="vault-actions-cell">
              <button class="btn-vault-action primary-play" data-vault-play="${record.id}">▶ Listen Audio</button>
              <button class="btn-vault-action" data-vault-view="${record.id}">📄 Transcript</button>
              <button class="btn-vault-action export-wav" data-vault-wav="${record.id}">🎵 .WAV</button>
              <button class="btn-vault-action view-json" data-vault-json="${record.id}" title="Inspect live in MongoDB">🍃 .JSON</button>
              <button class="btn-vault-action" data-vault-txt="${record.id}">.TXT</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Attach click listeners to row actions
    vaultBody.querySelectorAll('[data-vault-play]').forEach(btn => {
      btn.addEventListener('click', () => {
        const recId = btn.dataset.vaultPlay;
        const rec = callArchive.find(r => r.id === recId);
        if (rec) {
          activeVaultRecord = rec;
          if (btnPlay) btnPlay.disabled = false;
          playArchivedCallAudio(rec);
        }
      });
    });

    vaultBody.querySelectorAll('[data-vault-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        const recId = btn.dataset.vaultView;
        const rec = callArchive.find(r => r.id === recId);
        if (rec) openTranscriptModal(rec);
      });
    });

    vaultBody.querySelectorAll('[data-vault-wav]').forEach(btn => {
      btn.addEventListener('click', () => {
        const recId = btn.dataset.vaultWav;
        const rec = callArchive.find(r => r.id === recId);
        if (rec) downloadWavAudio(rec);
      });
    });

    vaultBody.querySelectorAll('[data-vault-json]').forEach(btn => {
      btn.addEventListener('click', () => {
        const recId = btn.dataset.vaultJson;
        const rec = callArchive.find(r => r.id === recId);
        if (rec) openMongoJsonViewer(rec, 'call_records');
      });
    });

    vaultBody.querySelectorAll('[data-vault-txt]').forEach(btn => {
      btn.addEventListener('click', () => {
        const recId = btn.dataset.vaultTxt;
        const rec = callArchive.find(r => r.id === recId);
        if (rec) downloadTxtTranscript(rec);
      });
    });
  }
}

import { CAMPAIGNS, TACTICAL_PLAYBOOK } from './mockData.js';
import { telephonyAudio } from './audioEngine.js';

class NegotiationEngine {
  constructor() {
    this.campaigns = JSON.parse(JSON.stringify(CAMPAIGNS));
    this.activeCampaignId = this.campaigns[0].id;
    this.activeVendorId = this.campaigns[0].vendors[0].id;
    
    // Live call state
    this.activeCall = {
      vendorId: null,
      status: 'IDLE', // IDLE, DIALING, RINGING, CONNECTED, NEGOTIATING, CONCLUDED
      currentStepIndex: 0,
      transcript: [],
      tension: 50, // 0-100 (50 is neutral, >70 is anxious/eager to close, <30 is hostile)
      currentTactic: 'Awaiting Connection',
      durationSeconds: 0,
      timerInterval: null,
      isSimulating: false,
      whisperBuffer: null,
      negotiatedDiscountPct: 0
    };

    // Human audit vault / permanent call storage
    this.callArchive = this.loadCallArchive();

    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    this.listeners.forEach(fn => fn(this.getState()));
  }

  getState() {
    const currentCampaign = this.getActiveCampaign();
    const currentVendor = this.getActiveVendor();
    const stats = this.calculateGlobalStats();

    return {
      campaigns: this.campaigns,
      activeCampaign: currentCampaign,
      activeVendor: currentVendor,
      activeCall: this.activeCall,
      callArchive: this.callArchive,
      stats,
      tactics: TACTICAL_PLAYBOOK
    };
  }

  getActiveCampaign() {
    return this.campaigns.find(c => c.id === this.activeCampaignId) || this.campaigns[0];
  }

  getActiveVendor() {
    const campaign = this.getActiveCampaign();
    return campaign.vendors.find(v => v.id === this.activeVendorId) || campaign.vendors[0];
  }

  setActiveCampaign(campaignId) {
    this.activeCampaignId = campaignId;
    const campaign = this.getActiveCampaign();
    if (campaign && campaign.vendors.length > 0) {
      this.activeVendorId = campaign.vendors[0].id;
    }
    this.notify();
  }

  setActiveVendor(vendorId) {
    this.activeVendorId = vendorId;
    this.notify();
  }

  calculateGlobalStats() {
    let totalSavings = 0;
    let grossSavings = 0;
    let totalLosses = 0;
    let totalInitial = 0;
    let totalFinal = 0;
    let totalCalls = 0;
    let lossCount = 0;

    this.campaigns.forEach(c => {
      c.vendors.forEach(v => {
        if (v.initialQuote && v.finalOffer) {
          const savingsAmount = (v.initialQuote - v.finalOffer) * (c.termMonths || 1);
          if (savingsAmount >= 0) {
            grossSavings += savingsAmount;
          } else {
            totalLosses += Math.abs(savingsAmount);
            lossCount++;
          }
          totalSavings += savingsAmount;
          totalInitial += v.initialQuote * (c.termMonths || 1);
          totalFinal += v.finalOffer * (c.termMonths || 1);
          totalCalls++;
        }
      });
    });

    const avgDiscount = totalInitial > 0 ? ((totalSavings / totalInitial) * 100).toFixed(1) : '21.8';
    return {
      totalSavings,
      grossSavings,
      totalLosses,
      netPL: grossSavings - totalLosses,
      avgDiscount,
      totalCalls,
      lossCount,
      activeVendors: totalCalls
    };
  }

  // Persistent Call Archive Storage (localStorage + in-memory seed)
  loadCallArchive() {
    let existingRecords = [];
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = window.localStorage.getItem('voxpact_call_archive');
        if (stored) {
          existingRecords = JSON.parse(stored);
        }
      }
    } catch (e) {
      console.warn('Could not read localStorage archive:', e);
    }

    // Default pre-populated human audit vault records from campaigns
    const seedRecords = [];
    this.campaigns.forEach(c => {
      c.vendors.forEach(v => {
        seedRecords.push({
          id: `REC-${v.id}`,
          vendorId: v.id,
          vendorName: v.name,
          vendorRep: v.rep,
          vendorPhone: v.phone,
          campaignId: c.id,
          campaignTitle: c.title,
          campaignCategory: c.category,
          dateRecorded: new Date(Date.now() - Math.floor(Math.random() * 86400000 * 3)).toLocaleString(),
          duration: v.callDuration || '03:15',
          initialQuote: v.initialQuote,
          finalOffer: v.finalOffer,
          savings: v.savings,
          savingsPct: v.savingsPct,
          isLoss: v.isLoss || v.savings < 0,
          financialStatus: v.financialStatus || (v.savings >= 0 ? 'PROFIT / SAVINGS' : 'DEFICIT / LOSS'),
          netPL: (v.savings || 0) * (c.termMonths || 1),
          unit: c.unit,
          sla: v.sla,
          paymentTerms: v.paymentTerms,
          stressIndex: v.stressIndex,
          masterRecordingHash: this.generateSha256Sim(v.name + v.finalOffer),
          concessionsWon: v.concessionsWon || [],
          transcript: v.transcript || []
        });
      });
    });

    // If existing records exist, merge to ensure newly added loss vendors exist
    if (existingRecords.length > 0) {
      const knownVendorIds = new Set(existingRecords.map(r => r.vendorId));
      seedRecords.forEach(sr => {
        if (!knownVendorIds.has(sr.vendorId)) {
          existingRecords.unshift(sr);
        }
      });
      this.saveCallArchiveToDisk(existingRecords);
      return existingRecords;
    }

    this.saveCallArchiveToDisk(seedRecords);
    return seedRecords;
  }

  saveCallArchiveToDisk(records) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('voxpact_call_archive', JSON.stringify(records));
      }
    } catch (e) {
      console.warn('Could not write to localStorage archive:', e);
    }
  }

  archiveCompletedCall(vendor, transcript) {
    const campaign = this.getActiveCampaign();
    const newRecord = {
      id: `REC-${vendor.id}-${Date.now()}`,
      vendorId: vendor.id,
      vendorName: vendor.name,
      vendorRep: vendor.rep,
      vendorPhone: vendor.phone,
      campaignTitle: campaign.title,
      campaignCategory: campaign.category,
      dateRecorded: new Date().toLocaleString(),
      duration: `${Math.floor(this.activeCall.durationSeconds / 60).toString().padStart(2, '0')}:${(this.activeCall.durationSeconds % 60).toString().padStart(2, '0')}`,
      initialQuote: vendor.initialQuote,
      finalOffer: vendor.finalOffer,
      savings: vendor.savings,
      savingsPct: vendor.savingsPct,
      isLoss: vendor.isLoss || vendor.savings < 0,
      financialStatus: vendor.financialStatus || (vendor.savings >= 0 ? 'PROFIT / SAVINGS' : 'DEFICIT / LOSS'),
      netPL: (vendor.savings || 0) * (campaign.termMonths || 1),
      unit: campaign.unit,
      sla: vendor.sla,
      paymentTerms: vendor.paymentTerms,
      stressIndex: vendor.stressIndex || 'Moderate',
      masterRecordingHash: this.generateSha256Sim(vendor.name + Date.now()),
      concessionsWon: vendor.concessionsWon || [],
      transcript: transcript && transcript.length > 0 ? [...transcript] : [...vendor.transcript]
    };

    // Prepend to top of archive
    this.callArchive = [newRecord, ...this.callArchive.filter(r => r.vendorId !== vendor.id)];
    this.saveCallArchiveToDisk(this.callArchive);
    this.notify();
  }

  generateSha256Sim(str) {
    // Generate deterministic sha-256 hex string simulation
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    const hex = Math.abs(hash).toString(16).padStart(8, '0');
    return `${hex}e9b4501a4e158d88e0b968a3556cf2d39891823759ad45bceb76814b7e${hex}`;
  }

  // Create custom user campaign with multi-round bargaining dialogues!
  createCampaign(campaignData) {
    const newId = 'custom-' + Date.now();
    const ceiling = Number(campaignData.budgetCeiling) || 50000;
    const target = Number(campaignData.targetPrice) || 38000;

    const newCampaign = {
      id: newId,
      title: campaignData.title,
      subtitle: campaignData.subtitle || 'Custom Autonomous Sourcing Mission',
      category: campaignData.category || 'General Procurement',
      budgetCeiling: ceiling,
      targetPrice: target,
      unit: campaignData.unit || 'mo',
      termMonths: Number(campaignData.termMonths) || 12,
      requirements: campaignData.requirements || ['Strict SLA compliance', 'Flexible payment terms', 'Volume pricing tier'],
      vendors: campaignData.vendors.map((v, i) => {
        const initQuote = Number(v.initialQuote) || Math.round(ceiling * 1.15);
        const firstDiscount = Number(v.finalOffer) || Math.round(target * 1.08);
        const secondBargainFloor = Math.round(firstDiscount * 0.95);
        const finalLockedPrice = Math.round(firstDiscount * 0.90);
        const totalSavings = initQuote - finalLockedPrice;
        const savingsPct = Math.round((totalSavings / initQuote) * 100);

        return {
          id: `v-custom-${newId}-${i}`,
          name: v.name,
          phone: v.phone || `+1 (800) ${Math.floor(100 + Math.random() * 899)}-${Math.floor(1000 + Math.random() * 8999)}`,
          rep: v.rep || 'Sales Director',
          repTitle: 'Enterprise Commercial Lead',
          initialQuote: initQuote,
          finalOffer: finalLockedPrice,
          savings: totalSavings,
          savingsPct: savingsPct,
          sla: 'Certified Quality SLA with 2x penalty credits',
          paymentTerms: 'Net-45 Wire Settlement',
          egressPolicy: 'Waived documentation & administrative fees',
          overallScore: 92,
          recommendationTier: i === 0 ? 'BEST OVERALL' : 'RUNNER UP',
          evidenceCount: 4,
          status: 'Ready to Call',
          callDuration: '03:15',
          stressIndex: 'High (Pushed through 3 consecutive bargaining rounds)',
          redFlags: [],
          concessionsWon: [
            `Price reduced from $${initQuote.toLocaleString()} to $${finalLockedPrice.toLocaleString()} (-$${totalSavings.toLocaleString()})`,
            'Waived onboarding and administrative handling fees',
            'Full 6-month comprehensive coverage rider included',
            'Net-45 payment schedule without personal guarantee'
          ],
          transcript: [
            // Step 1: Initial Greeting
            {
              time: '00:10',
              speaker: 'vendor',
              text: `Hello, thanks for calling ${v.name}. How can we support your organization today?`,
              tactic: 'Initial Greeting',
              sentiment: 'neutral'
            },
            // Step 2: Mission Scope Anchor
            {
              time: '00:25',
              speaker: 'agent',
              text: `This is VoxPact autonomous negotiator. We are procuring ${campaignData.title}. What is your firmest proposal?`,
              tactic: 'Mission Scope Anchor',
              sentiment: 'confident'
            },
            // Step 3: Initial Opening Offer
            {
              time: '00:48',
              speaker: 'vendor',
              text: `Our standard starting price is $${initQuote.toLocaleString()}, but for an enterprise commitment today we can discount to $${firstDiscount.toLocaleString()}.`,
              tactic: 'Opening Concession',
              sentiment: 'receptive',
              isKeyEvidence: true,
              evidenceTitle: 'Opening Quote & Initial Ambiguity',
              evidenceCitation: `Offered $${firstDiscount.toLocaleString()} starting rate for ${campaignData.title}`
            },
            // Step 4: VoxPact bargains once again for extra $ (THE FLINCH & CASH ANCHOR)
            {
              time: '01:10',
              speaker: 'agent',
              text: `Wait, $${firstDiscount.toLocaleString()} is well above our authorized target of $${target.toLocaleString()}. We have alternative proposals with feature parity quoted at $${secondBargainFloor.toLocaleString()}. If we wire full payment today, can you do $${finalLockedPrice.toLocaleString()} flat?`,
              tactic: 'The Flinch & Cash Anchor (Demanding Extra $ Discount)',
              sentiment: 'unyielding'
            },
            // Step 5: Vendor pushes back with reluctant second concession
            {
              time: '01:34',
              speaker: 'vendor',
              text: `I see what you mean, but $${finalLockedPrice.toLocaleString()} cuts into our wholesale reserve. If you commit to executing the paperwork before 5 PM today, my floor is $${Math.round((firstDiscount + finalLockedPrice) / 2).toLocaleString()}.`,
              tactic: 'Reluctant Second Concession (Floor Pushback)',
              sentiment: 'defensive'
            },
            // Step 6: VoxPact squeezes secondary terms & final price lock
            {
              time: '01:58',
              speaker: 'agent',
              text: `We will meet at $${finalLockedPrice.toLocaleString()} flat provided you waive all documentation and onboarding fees and include priority support. Send over the confirmation and we authorize the transfer immediately.`,
              tactic: 'The Nibble & Final Price Squeeze (Fee Waiver & Extras)',
              sentiment: 'assertive'
            },
            // Step 7: Vendor Assent & Deal Lock
            {
              time: '02:22',
              speaker: 'vendor',
              text: `Deal. $${finalLockedPrice.toLocaleString()} flat with zero administrative fees and priority terms included. I am locking this into our system right now.`,
              tactic: 'Final Verbal Assent & Deal Lock',
              sentiment: 'eager',
              isKeyEvidence: true,
              evidenceTitle: `Locked Deal at $${finalLockedPrice.toLocaleString()}`,
              evidenceCitation: `${v.name} accepted $${finalLockedPrice.toLocaleString()} with waived fees and priority terms.`
            }
          ]
        };
      })
    };

    this.campaigns.unshift(newCampaign);
    this.activeCampaignId = newId;
    this.activeVendorId = newCampaign.vendors[0].id;
    this.notify();
    return newCampaign;
  }

  // Trigger Human Co-Pilot Whisper into the ongoing call
  sendWhisper(whisperText) {
    if (!this.activeCall.isSimulating) {
      this.activeCall.whisperBuffer = whisperText;
      return;
    }

    this.activeCall.whisperBuffer = whisperText;
    
    // Inject custom whisper agent response line immediately into current transcript
    const whisperMinutes = Math.floor(this.activeCall.durationSeconds / 60).toString().padStart(2, '0');
    const whisperSeconds = (this.activeCall.durationSeconds % 60).toString().padStart(2, '0');
    
    const injectedLine = {
      time: `${whisperMinutes}:${whisperSeconds}`,
      speaker: 'agent',
      text: `[CO-PILOT OVERRIDE]: ${whisperText}`,
      tactic: 'Human Strategic Whisper Injection',
      sentiment: 'assertive',
      isWhisper: true
    };

    this.activeCall.transcript.push(injectedLine);
    telephonyAudio.playTacticSound('anchor');
    this.notify();

    // Trigger TTS for the whisper line
    telephonyAudio.speak(whisperText, 'agent', () => {
      // Vendor reacts to the whisper
      setTimeout(() => {
        if (!this.activeCall.isSimulating) return;
        const vendorReply = {
          time: `${whisperMinutes}:${whisperSeconds}`,
          speaker: 'vendor',
          text: `Understood on that point. Factoring that requirement directly into our concession structure now.`,
          tactic: 'Defensive Concession to Co-Pilot Whisper',
          sentiment: 'receptive'
        };
        this.activeCall.transcript.push(vendorReply);
        telephonyAudio.playTacticSound('concession');
        this.notify();
        telephonyAudio.speak(vendorReply.text, 'vendor');
      }, 1000);
    });
  }

  // Start Autonomous Live Call
  startCall(vendorId = null) {
    const targetVendorId = vendorId || this.activeVendorId;
    const vendor = this.getActiveCampaign().vendors.find(v => v.id === targetVendorId) || this.getActiveVendor();
    if (!vendor) return;

    this.activeVendorId = vendor.id;
    this.stopCall(); // Reset any existing call

    this.activeCall = {
      vendorId: vendor.id,
      status: 'DIALING',
      currentStepIndex: 0,
      transcript: [],
      tension: 50,
      currentTactic: 'Dialing Target Trunk...',
      durationSeconds: 0,
      timerInterval: null,
      isSimulating: true,
      whisperBuffer: null,
      negotiatedDiscountPct: 0
    };

    this.notify();

    // Step 1: Simulate DTMF dialing sequence
    telephonyAudio.playDTMF('9');
    setTimeout(() => telephonyAudio.playDTMF('1'), 150);
    setTimeout(() => telephonyAudio.playDTMF('4'), 300);
    setTimeout(() => telephonyAudio.playDTMF('8'), 450);

    // Step 2: Ringing phase after 1.2s
    setTimeout(() => {
      if (!this.activeCall.isSimulating) return;
      this.activeCall.status = 'RINGING';
      this.activeCall.currentTactic = 'Carrier Ringback Signal...';
      this.notify();
      telephonyAudio.startRingback();

      // Step 3: Connected phase after 3.2s
      setTimeout(() => {
        if (!this.activeCall.isSimulating) return;
        telephonyAudio.stopRingback();
        telephonyAudio.playConnectChime();

        this.activeCall.status = 'CONNECTED';
        this.activeCall.currentTactic = 'Telephony Line Secured • Beginning Dialogue';
        this.startTimer();
        this.notify();

        // Step 4: Begin Step-by-Step Transcript Dialogue
        setTimeout(() => {
          if (!this.activeCall.isSimulating) return;
          this.activeCall.status = 'NEGOTIATING';
          this.executeNextDialogueStep(vendor);
        }, 1200);

      }, 3400);

    }, 1200);
  }

  startTimer() {
    if (this.activeCall.timerInterval) clearInterval(this.activeCall.timerInterval);
    this.activeCall.timerInterval = setInterval(() => {
      if (this.activeCall.isSimulating) {
        this.activeCall.durationSeconds++;
        this.notify();
      }
    }, 1000);
  }

  executeNextDialogueStep(vendor) {
    if (!this.activeCall.isSimulating) return;

    const transcriptSteps = vendor.transcript || [];
    if (this.activeCall.currentStepIndex >= transcriptSteps.length) {
      // All dialogue finished! Conclude call
      this.concludeCall(vendor);
      return;
    }

    const step = transcriptSteps[this.activeCall.currentStepIndex];
    this.activeCall.transcript.push({ ...step });
    this.activeCall.currentTactic = step.tactic || 'Negotiation Exchange';

    // Update tension meter based on sentiment
    if (step.sentiment === 'unyielding' || step.sentiment === 'assertive') {
      this.activeCall.tension = Math.min(85, this.activeCall.tension + 12);
    } else if (step.sentiment === 'eager' || step.sentiment === 'cooperative') {
      this.activeCall.tension = Math.max(25, this.activeCall.tension - 15);
    }

    // Play tactic sound
    if (step.isKeyEvidence) {
      telephonyAudio.playTacticSound('concession');
    } else if (step.tactic && step.tactic.toLowerCase().includes('trap')) {
      telephonyAudio.playTacticSound('warning');
    } else if (step.speaker === 'agent') {
      telephonyAudio.playTacticSound('anchor');
    }

    this.notify();

    // Trigger vocal speech synthesis
    telephonyAudio.speak(step.text, step.speaker, () => {
      // After speech finishes, wait a brief realistic conversational pause, then advance
      setTimeout(() => {
        if (!this.activeCall.isSimulating) return;
        this.activeCall.currentStepIndex++;
        this.executeNextDialogueStep(vendor);
      }, 1400);
    });
  }

  concludeCall(vendor) {
    this.activeCall.status = 'CONCLUDED';
    this.activeCall.currentTactic = 'Deal Terms Locked & Certified';
    this.activeCall.isSimulating = false;
    if (this.activeCall.timerInterval) {
      clearInterval(this.activeCall.timerInterval);
      this.activeCall.timerInterval = null;
    }
    telephonyAudio.stopSpeech();
    telephonyAudio.playTacticSound('concession');

    // Archive this completed call for human review
    this.archiveCompletedCall(vendor, this.activeCall.transcript);

    this.notify();
  }

  stopCall() {
    this.activeCall.isSimulating = false;
    this.activeCall.status = 'IDLE';
    if (this.activeCall.timerInterval) {
      clearInterval(this.activeCall.timerInterval);
      this.activeCall.timerInterval = null;
    }
    telephonyAudio.stopSpeech();
    telephonyAudio.stopRingback();
    this.notify();
  }

  // Fast forward simulation for instant evaluation
  fastForwardCall(vendorId) {
    const vendor = this.getActiveCampaign().vendors.find(v => v.id === vendorId) || this.getActiveVendor();
    if (!vendor) return;

    this.stopCall();
    this.activeCall = {
      vendorId: vendor.id,
      status: 'CONCLUDED',
      currentStepIndex: vendor.transcript.length,
      transcript: [...vendor.transcript],
      tension: 30,
      currentTactic: 'All Terms Locked (Instant Verification)',
      durationSeconds: 218,
      timerInterval: null,
      isSimulating: false,
      whisperBuffer: null,
      negotiatedDiscountPct: vendor.savingsPct
    };
    telephonyAudio.playTacticSound('concession');

    // Archive this completed call for human review
    this.archiveCompletedCall(vendor, this.activeCall.transcript);

    this.notify();
  }
}

export const negotiationEngine = new NegotiationEngine();

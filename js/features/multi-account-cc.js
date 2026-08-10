(function(){
  'use strict';

  /* ═══════════════════════════════════════════════════════════
     STORAGE
     ═══════════════════════════════════════════════════════════ */
  let CC_KEY      = 'veyra_creditCards_v2';   // bumped — new matched field
  let ACC_KEY     = 'veyra_accounts_v1';
  let PATTERN_KEY = 'veyra_ccRepayPatterns_v1';

  function loadCC(){
    try{ let r=localStorage.getItem(CC_KEY); return r?JSON.parse(r):{cards:[],charges:[],repayments:[]}; }
    catch(e){ return {cards:[],charges:[],repayments:[]}; }
  }
  function saveCC(d){ try{ localStorage.setItem(CC_KEY,JSON.stringify(d)); }catch(e){} }

  function loadAccounts(){
    try{ let r=localStorage.getItem(ACC_KEY); return r?JSON.parse(r):defaultAccounts(); }
    catch(e){ return defaultAccounts(); }
  }
  function saveAccounts(a){ try{ localStorage.setItem(ACC_KEY,JSON.stringify(a)); }catch(e){} }

  function defaultAccounts(){
    return [
      {id:'acc-current',name:'Current Account'},
      {id:'acc-savings',name:'Savings Account'},
      {id:'acc-share',  name:'Share Account'}
    ];
  }

  // Repayment description patterns — user-taught list of substrings
  function loadPatterns(){ try{ let r=localStorage.getItem(PATTERN_KEY); return r?JSON.parse(r):[]; }catch(e){ return []; } }
  function savePatterns(p){ try{ localStorage.setItem(PATTERN_KEY,JSON.stringify(p)); }catch(e){} }

  function isRepaymentDesc(desc){
    let lower=(desc||'').toLowerCase();
    return loadPatterns().some(function(p){ return lower.indexOf(p.toLowerCase())>=0; });
  }

  /* ═══════════════════════════════════════════════════════════
     ACCOUNT TAGGING — injected into CSV modal header
     ═══════════════════════════════════════════════════════════ */
  // CURRENT_IMPORT_ACCOUNT is exposed on window via Object.defineProperty (see below,
  // near getAccountName) so cross-IIFE scripts can access it. Internally we use
  // _currentImportAccount as the backing variable.

  function injectAccountBar(){
    if(document.getElementById('csvAccountBar')) return;
    let header=document.querySelector('.csv-import-header');
    if(!header) return;
    let bar=document.createElement('div');
    bar.className='csv-account-bar'; bar.id='csvAccountBar';
    bar.innerHTML=buildAccountBarHTML();
    header.parentNode.insertBefore(bar,header.nextSibling);
    wireAccountBarEvents(bar);
  }

  function buildAccountBarHTML(){
    let accounts=loadAccounts();
    let opts='<option value="">— All / Unspecified —</option>';
    accounts.forEach(function(a){ opts+='<option value="'+esc(a.id)+'">'+esc(a.name)+'</option>'; });
    return '<label>Source account</label>'
      +'<select class="csv-account-select" id="csvAccountSelect">'+opts+'</select>'
      +'<button class="csv-account-new-btn" id="csvAccountAddBtn" type="button">+ New account</button>'
      +'<button class="csv-account-manage-btn" id="csvAccountEditBtn" type="button" disabled>Edit</button>'
      +'<button class="csv-account-manage-btn csv-danger" id="csvAccountDeleteBtn" type="button" disabled>Delete</button>';
  }

  function wireAccountBarEvents(bar){
    if(!bar) return;
    let sel=bar.querySelector('#csvAccountSelect');
    if(sel) sel.value=CURRENT_IMPORT_ACCOUNT||'';
    refreshCsvAccountBarState();
    bar.addEventListener('change',function(e){
      if(e.target.id==='csvAccountSelect'){
        CURRENT_IMPORT_ACCOUNT=e.target.value||null;
        refreshCsvAccountBarState();
        let title=document.getElementById('csvImportTitle');
        if(title && /(CSV Imports|Import Bank CSV)/.test(title.textContent||'') && typeof window.openCsvImportHistory==='function') window.openCsvImportHistory();
      }
    });
    let add=bar.querySelector('#csvAccountAddBtn'); if(add) add.addEventListener('click',promptNewAccount);
    let edit=bar.querySelector('#csvAccountEditBtn'); if(edit) edit.addEventListener('click',promptEditAccount);
    let del=bar.querySelector('#csvAccountDeleteBtn'); if(del) del.addEventListener('click',promptDeleteAccount);
  }

  function refreshCsvAccountBarState(){
    let sel=document.getElementById('csvAccountSelect');
    let has=!!(sel&&sel.value);
    let edit=document.getElementById('csvAccountEditBtn');
    let del=document.getElementById('csvAccountDeleteBtn');
    if(edit) edit.disabled=!has;
    if(del) del.disabled=!has;
  }
  window.refreshCsvAccountBarState=refreshCsvAccountBarState;

  function rerenderAccountBar(){
    let bar=document.getElementById('csvAccountBar');
    if(!bar) return;
    bar.innerHTML=buildAccountBarHTML();
    wireAccountBarEvents(bar);
  }

  function promptNewAccount(){
    let name=(prompt('Name for the new account (e.g. "Joint Account"):', '')||'').trim();
    if(!name) return;
    let accounts=loadAccounts();
    let id='acc-'+Date.now().toString(36);
    accounts.push({id:id,name:name});
    saveAccounts(accounts);
    CURRENT_IMPORT_ACCOUNT=id;
    rerenderAccountBar();
    let title=document.getElementById('csvImportTitle');
    if(title && /(CSV Imports|Import Bank CSV)/.test(title.textContent||'') && typeof window.openCsvImportHistory==='function') window.openCsvImportHistory();
  }

  function promptEditAccount(){
    let id=CURRENT_IMPORT_ACCOUNT;
    if(!id) return;
    let accounts=loadAccounts();
    let account=accounts.find(function(a){return a&&a.id===id;});
    if(!account) return;
    let name=(prompt('Rename source account:',account.name)||'').trim();
    if(!name) return;
    account.name=name;
    saveAccounts(accounts);
    let st=window.state;
    if(st&&Array.isArray(st.csvImportBatches)){
      st.csvImportBatches.forEach(function(b){ if(b&&b.accountId===id) b.accountName=name; });
      if(window.saveState) window.saveState(st);
    }
    rerenderAccountBar();
    if(typeof window.openCsvImportHistory==='function') window.openCsvImportHistory();
  }

  function promptDeleteAccount(){
    let id=CURRENT_IMPORT_ACCOUNT;
    if(!id) return;
    let accounts=loadAccounts();
    let account=accounts.find(function(a){return a&&a.id===id;});
    let name=account?account.name:id;
    if(!confirm('Delete source account "'+name+'"? Existing CSV imports will stay, but their source account link will be cleared.')) return;
    accounts=accounts.filter(function(a){return a&&a.id!==id;});
    saveAccounts(accounts);
    let st=window.state;
    if(st&&Array.isArray(st.csvImportBatches)){
      st.csvImportBatches.forEach(function(b){ if(b&&b.accountId===id){ b.accountId=''; b.accountName=''; } });
      if(window.saveState) window.saveState(st);
    }
    CURRENT_IMPORT_ACCOUNT=null;
    rerenderAccountBar();
    if(typeof window.openCsvImportHistory==='function') window.openCsvImportHistory();
  }

  function getAccountName(id){
    if(!id) return '';
    let a=loadAccounts().find(function(x){ return x.id===id; });
    return a?a.name:id;
  }

  // Expose account helpers to window so cross-IIFE scripts (csv-import-logic)
  // can access CURRENT_IMPORT_ACCOUNT, getAccountName and recordCapturedRepayments
  // without a ReferenceError.
  window.getAccountName = getAccountName;
  // Use a property descriptor so reads/writes in any script stay in sync.
  Object.defineProperty(window, 'CURRENT_IMPORT_ACCOUNT', {
    get: function(){ return _currentImportAccount; },
    set: function(v){ _currentImportAccount = v; },
    configurable: true
  });
  let _currentImportAccount = null;

  /* ═══════════════════════════════════════════════════════════
     AUTO-DETECT CC REPAYMENT ROWS IN CSV IMPORT
     ═══════════════════════════════════════════════════════════ */
  // Intercept the CSV target-type dropdown to add CC Repayment option,
  // and auto-select it when the description matches a learned pattern.
  function patchCsvTargetTypeDropdowns(){
    // Add "CC Repayment" to every .csv-target-type-select that doesn't have it yet
    document.querySelectorAll('.csv-target-type-select').forEach(function(sel){
      if(sel.querySelector('option[value="cc-repayment"]')) return; // already patched
      let opt=document.createElement('option');
      opt.value='cc-repayment'; opt.textContent='CC Repayment (exclude from budget)';
      sel.appendChild(opt);

      // Auto-select if the row description matches a learned pattern
      let idx=+sel.dataset.idx;
      let entry=window._pendingCsvTxs && window._pendingCsvTxs[idx]; // try to reach pendingTxs
      // Fallback: read description from the row's DOM
      let row=sel.closest('tr');
      let descCell=row&&row.querySelector('.csv-review-desc');
      let desc=descCell?descCell.textContent:'';
      if(!entry && desc) entry={tx:{desc:desc}};
      if(entry && isRepaymentDesc(entry.tx&&entry.tx.desc||desc)){
        sel.value='cc-repayment';
        // Trigger a change event so the existing wire logic can update state
        sel.dispatchEvent(new Event('change',{bubbles:true}));
      }
    });
  }

  // Hook: whenever the CSV modal opens/re-renders, patch dropdowns + tag batches
  document.addEventListener('DOMContentLoaded',function(){
    // MutationObserver on the CSV body to patch whenever rows are rendered
    let csvBody=document.getElementById('csvImportBody');
    if(csvBody){
      let obs=new MutationObserver(function(){ setTimeout(patchCsvTargetTypeDropdowns,30); });
      obs.observe(csvBody,{childList:true,subtree:false});
    }

    // Also patch when overlay opens
    let overlay=document.getElementById('csvImportOverlay');
    if(overlay){
      let obs2=new MutationObserver(function(muts){
        muts.forEach(function(m){
          if(m.type==='attributes'&&m.attributeName==='class'&&overlay.classList.contains('csv-open')){
            setTimeout(injectAccountBar,50);
            setTimeout(patchCsvTargetTypeDropdowns,120);
          }
        });
      });
      obs2.observe(overlay,{attributes:true});
    }

    let commitBtn=document.getElementById('csvImportCommit');
    if(commitBtn){
      commitBtn.addEventListener('click',function(){ setTimeout(refreshCcRepaymentSummaries,250); });
    }

    // Sidebar button
    injectCCButton();
    // Overview widget
    setTimeout(injectOverviewWidget,900);
  });

  function parseMoneyFromText(text){
    let raw=String(text||'').replace(/[^0-9,.-]/g,'').trim();
    if(!raw) return 0;
    if(raw.indexOf(',')>=0 && raw.indexOf('.')>=0) raw=raw.replace(/\./g,'').replace(',', '.');
    else if(raw.indexOf(',')>=0) raw=raw.replace(',', '.');
    let v=parseFloat(raw);
    return isNaN(v)?0:Math.abs(v);
  }

  function normalizeDateForCC(dateText){
    let s=String(dateText||'').trim();
    if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    let d=new Date(s);
    if(!isNaN(d.getTime())) return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    return todayISO();
  }

  function repaymentFingerprint(r){
    return [normalizeDateForCC(r.date), Number(r.amount||0).toFixed(2), String(r.desc||r.note||'').toLowerCase().replace(/\s+/g,' ').trim()].join('|');
  }

  function syncRepaymentsFromCsvBatches(){
    let st=window.state;
    if(!st || !Array.isArray(st.csvImportBatches)) return;
    let data=loadCC();
    if(!Array.isArray(data.repayments)) data.repayments=[];
    let cards=Array.isArray(data.cards)?data.cards:[];
    let defaultCardId=cards.length===1?cards[0].id:'';
    let validKeys={};
    let existingByKey={};
    data.repayments.forEach(function(r){
      if(r && r.source==='bank-csv' && r.importBatchId && r.importEntryId){
        existingByKey[String(r.importBatchId)+'|'+String(r.importEntryId)] = r;
      }
    });
    st.csvImportBatches.forEach(function(batch){
      if(!batch || !Array.isArray(batch.entries)) return;
      batch.entries.forEach(function(entry){
        if(!entry || entry.skip || entry.isCredit) return;
        if((entry.targetType||'expense')!=='cc-repayment') return;
        let tx=entry.tx||{};
        let amount=Math.abs(Number(tx.amount||0));
        if(!(amount>0)) return;
        let key=String(batch.id||'')+'|'+String(entry.id||'');
        validKeys[key]=true;
        let cleanDate=normalizeDateForCC(tx.dateStamp||tx.date||todayISO());
        let desc=tx.desc||entry.desc||'';
        let existing=existingByKey[key];
        if(existing){
          existing.date=cleanDate;
          existing.amount=amount;
          existing.desc=desc;
          existing.note=desc;
          existing.accountId=existing.accountId||batch.accountId||'';
          existing.accountName=existing.accountName||batch.accountName||getAccountName(batch.accountId)||'';
          if(!existing.cardId && defaultCardId) existing.cardId=defaultCardId;
        } else {
          data.repayments.push({
            id:'rep-bank-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6),
            cardId:defaultCardId,
            date:cleanDate,
            amount:amount,
            desc:desc,
            note:desc,
            accountId:batch.accountId||'',
            accountName:batch.accountName||getAccountName(batch.accountId)||'',
            source:'bank-csv',
            importBatchId:batch.id||'',
            importEntryId:entry.id||'',
            createdAt:new Date().toISOString()
          });
        }
      });
    });
    data.repayments=data.repayments.filter(function(r){
      if(!(r && r.source==='bank-csv' && r.importBatchId && r.importEntryId)) return true;
      return !!validKeys[String(r.importBatchId)+'|'+String(r.importEntryId)];
    });
    recalcRepaymentSummaries(data);
    saveCC(data);
  }

  function recordCapturedRepayments(rows){
    let data=loadCC();
    if(!Array.isArray(data.repayments)) data.repayments=[];
    let cards=data.cards||[];
    let defaultCardId=cards.length===1?cards[0].id:'';
    let existing={};
    data.repayments.forEach(function(r){ existing[repaymentFingerprint(r)]=true; });
    rows.forEach(function(r){
      let clean={date:normalizeDateForCC(r.date),amount:Number(r.amount||0),desc:r.desc||'',note:r.desc||'',accountId:r.accountId||'',accountName:r.accountName||'',source:'bank-csv',createdAt:new Date().toISOString()};
      if(!(clean.amount>0) || existing[repaymentFingerprint(clean)]) return;
      clean.id='rep-bank-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6);
      clean.cardId=defaultCardId;
      data.repayments.push(clean);
      existing[repaymentFingerprint(clean)]=true;
    });
    recalcRepaymentSummaries(data);
    saveCC(data);
    refreshOverviewWidget();
  }
  window.recordCapturedRepayments = recordCapturedRepayments;

  /* Learn a description fragment (longest meaningful word boundary substring) */
  function learnRepaymentPattern(desc){
    // Store the raw description lowercased — user can also manage patterns manually
    let patterns=loadPatterns();
    let lower=desc.toLowerCase().trim();
    if(lower.length<4) return;
    if(patterns.some(function(p){ return lower.indexOf(p)>=0||p.indexOf(lower)>=0; })) return; // already covered
    patterns.push(lower);
    savePatterns(patterns);
  }
  window.learnRepaymentPattern = learnRepaymentPattern;

  /* ═══════════════════════════════════════════════════════════
     AUTO-MATCH REPAYMENTS → CC CHARGES
     ═══════════════════════════════════════════════════════════
     Logic:
       - A "CC Repayment" row in the bank CSV means a bulk payment
         went from the bank account to the credit card company.
       - We try to match it to the total of unmatched CC charges
         within a reasonable date window (±45 days).
       - Matched charges get matched=true and their categories
         are written into the dashboard expenses.
       - Unmatched charges remain pending (money not yet spent
         from the bank account's perspective).
     ═══════════════════════════════════════════════════════════ */
  function autoMatchRepayments(){
    let data=loadCC();
    let cards=data.cards||[];
    if(!cards.length) return;

    // Get all cc-repayment rows that were just committed (we detect them by
    // scanning the dashboard state for any "cc-repayment" tagged transactions
    // added in the last commit). Since we can't easily intercept the commit
    // result, we instead look at ALL repayments recorded manually and try to
    // match any unmatched pending charges.
    matchPendingCharges(data);
    saveCC(data);
    refreshOverviewWidget();
  }

  function matchPendingCharges(data){
    if(!data) return;
    let charges=data.charges||[];
    let repayments=data.repayments||[];

    // Clear stale match metadata for repayments that no longer exist or changed card.
    let repayById={};
    repayments.forEach(function(r){ repayById[r.id]=r; r.fullyMatched=false; r.partialMatch=false; r.matchedChargeCount=0; r.matchedAmount=0; });
    charges.forEach(function(c){
      let rep=c.matchedRepayId && repayById[c.matchedRepayId];
      if(!rep || (rep.cardId && c.cardId!==rep.cardId)){ c.matched=false; delete c.matchedRepayId; }
    });

    (data.cards||[]).forEach(function(card){
      let cardCharges=charges.filter(function(c){ return c.cardId===card.id && !c.ignored; });
      let cardRepayments=repayments.filter(function(r){ return r.cardId===card.id; });

      cardRepayments.forEach(function(rep){
        let repAmt=parseFloat(rep.amount||0);
        if(!(repAmt>0)) return;
        let repDate=new Date(rep.date||Date.now());
        let tolerance=Math.max(1, repAmt*0.02);
        let already=cardCharges.filter(function(c){ return c.matchedRepayId===rep.id; });
        let alreadyTotal=already.reduce(function(s,c){ return s+parseFloat(c.amount||0); },0);

        if(already.length){
          rep.matchedChargeCount=already.length;
          rep.matchedAmount=alreadyTotal;
          rep.fullyMatched=Math.abs(alreadyTotal-repAmt)<=tolerance;
          rep.partialMatch=!rep.fullyMatched;
          if(rep.manualMatched) return;
          if(rep.fullyMatched) return;
        }

        let unmatched=cardCharges.filter(function(c){
          if(c.matched) return false;
          let cDate=new Date(c.date||rep.date);
          let diffDays=Math.abs((repDate-cDate)/(1000*60*60*24));
          return diffDays<=45;
        });
        let total=unmatched.reduce(function(s,c){ return s+parseFloat(c.amount||0); },0);

        if(Math.abs(total-repAmt)<=tolerance){
          unmatched.forEach(function(c){ c.matched=true; c.matchedRepayId=rep.id; });
          rep.fullyMatched=true;
          rep.matchedChargeCount=unmatched.length;
          rep.matchedAmount=total;
        } else if(total>repAmt){
          let sorted=unmatched.slice().sort(function(a,b){ return (a.date||'').localeCompare(b.date||''); });
          let running=0,count=0;
          sorted.forEach(function(c){
            let amt=parseFloat(c.amount||0);
            if(running+amt<=repAmt+tolerance){
              running+=amt; count++;
              c.matched=true; c.matchedRepayId=rep.id;
            }
          });
          if(count){ rep.partialMatch=true; rep.matchedChargeCount=count; rep.matchedAmount=running; }
        }
      });
    });
  }

  function recalcRepaymentSummaries(data){
    if(!data) return;
    let charges=data.charges||[];
    let repayments=data.repayments||[];
    let repayById={};
    repayments.forEach(function(r){
      repayById[r.id]=r;
      r.fullyMatched=false;
      r.partialMatch=false;
      r.matchedChargeCount=0;
      r.matchedAmount=0;
    });
    charges.forEach(function(c){
      let rep=c.matchedRepayId && repayById[c.matchedRepayId];
      if(!rep || (rep.cardId && c.cardId!==rep.cardId)){
        c.matched=false;
        delete c.matchedRepayId;
        return;
      }
      c.matched=true;
      rep.matchedChargeCount=(rep.matchedChargeCount||0)+1;
      rep.matchedAmount=(rep.matchedAmount||0)+Number(c.amount||0);
    });
    repayments.forEach(function(r){
      let amt=Number(r.amount||0);
      let tolerance=Math.max(1,amt*0.02);
      r.fullyMatched=(r.matchedChargeCount||0)>0 && Math.abs(Number(r.matchedAmount||0)-amt)<=tolerance;
      r.partialMatch=(r.matchedChargeCount||0)>0 && !r.fullyMatched;
    });
  }

  function refreshCcRepaymentSummaries(){
    let data=loadCC();
    recalcRepaymentSummaries(data);
    saveCC(data);
    refreshOverviewWidget();
  }



  /* ═══════════════════════════════════════════════════════════
     SIDEBAR BUTTON
     ═══════════════════════════════════════════════════════════ */
  function injectCCButton(){
    let existing=document.getElementById('ccManagerBtn');
    if(existing){
      if(!existing.dataset.ccWired){
        existing.addEventListener('click',openCC);
        existing.dataset.ccWired='1';
      }
      return;
    }
    let deleteBtn=document.getElementById('deleteMonthBtn');
    if(!deleteBtn) return;
    let btn=document.createElement('button');
    btn.className='secondary'; btn.id='ccManagerBtn';
    btn.title='Manage credit cards and log charges';
    btn.innerHTML='<span class="btn-icon">💳</span> Credit Cards';
    btn.addEventListener('click',openCC);
    btn.dataset.ccWired='1';
    deleteBtn.parentNode.insertBefore(btn,deleteBtn);
  }

  /* ═══════════════════════════════════════════════════════════
     CREDIT CARD MODAL
     ═══════════════════════════════════════════════════════════ */
  let SWATCH_COLORS=['#dc2626','#ea580c','#d97706','#16a34a','#0891b2','#2563eb','#7c3aed','#db2777','#475569'];
  let _selColor=SWATCH_COLORS[5];
  let _activeTab='cards';
  let _chargeFormOpen=false;
  let _addCardFormOpen=false;
  let _preselCardId=null;
  let _importMode=false;
  let _selectedRepayId=null;
  let _importPreview=[]; // parsed statement rows awaiting confirmation

  function buildModal(){
    if(document.getElementById('ccManagerOverlay')) return;
    let div=document.createElement('div');
    div.innerHTML=[
      '<div class="cc-overlay" id="ccManagerOverlay" role="dialog" aria-modal="true" aria-labelledby="ccModalTitle">',
      '  <div class="cc-modal">',
      '    <div class="cc-header">',
      '      <div class="cc-header-text">',
      '        <div class="cc-title" id="ccModalTitle">💳 Credit Card Manager</div>',
      '        <div class="cc-sub">Log charges, import statements, and manage repayments without double-counting</div>',
      '      </div>',
      '      <button class="cc-close-btn" id="ccCloseBtn" type="button">×</button>',
      '    </div>',
      '    <div class="cc-tabs">',
      '      <button class="cc-tab cc-active" data-cc-tab="cards">My Cards</button>',
      '      <button class="cc-tab" data-cc-tab="matching">Matching</button>',
      '      <button class="cc-tab" data-cc-tab="history">History</button>',
      '      <button class="cc-tab" data-cc-tab="patterns">Auto-detect</button>',
      '    </div>',
      '    <div class="cc-body" id="ccBody">',
      '      <div class="cc-panel cc-panel-active" id="ccPanelCards"></div>',
      '      <div class="cc-panel" id="ccPanelMatching"></div>',
      '      <div class="cc-panel" id="ccPanelHistory"></div>',
      '      <div class="cc-panel" id="ccPanelPatterns"></div>',
      '    </div>',
      '    <div class="cc-footer">',
      '      <button class="cc-footer-close" id="ccFooterClose" type="button">Close</button>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('');
    document.body.appendChild(div.firstElementChild);
    document.querySelectorAll('.cc-tab').forEach(function(tab){
      tab.addEventListener('click',function(){
        _activeTab=tab.dataset.ccTab;
        document.querySelectorAll('.cc-tab').forEach(function(t){ t.classList.remove('cc-active'); });
        tab.classList.add('cc-active');
        renderActivePanel();
      });
    });
    document.getElementById('ccCloseBtn').addEventListener('click',closeCC);
    document.getElementById('ccFooterClose').addEventListener('click',closeCC);
    document.getElementById('ccManagerOverlay').addEventListener('click',function(e){ if(e.target.id==='ccManagerOverlay') closeCC(); });
  }

  function seedMerchantMemoryFromMatches(){
    if(typeof window.learnMerchant!=='function') return;
    let data=loadCC();
    (data.charges||[]).forEach(function(c){
      if(c.cat&&c.sub&&c.cat!=='Imported'&&c.sub!=='Imported'&&c.desc) window.learnMerchant(c.desc,c.cat,c.sub);
    });
  }
  function openCC(opts){
    buildModal();
    seedMerchantMemoryFromMatches();
    _activeTab=(opts&&opts.tab)||'cards'; if(_activeTab==='charges'||_activeTab==='repayments') _activeTab='matching';
    document.querySelectorAll('.cc-tab').forEach(function(t){ t.classList.toggle('cc-active',t.dataset.ccTab===_activeTab); });
    renderActivePanel();
    let o=document.getElementById('ccManagerOverlay');
    if(o){
      o.classList.add('cc-open');
      o.setAttribute('aria-hidden','false');
      let closeBtn=o.querySelector('#ccCloseBtn');
      if(closeBtn){ setTimeout(function(){ try{ closeBtn.focus(); }catch(e){} },0); }
    }
  }
  function closeCC(){
    let o=document.getElementById('ccManagerOverlay');
    if(o){
      if(document.activeElement && o.contains(document.activeElement)){
        try{ document.activeElement.blur(); }catch(e){}
      }
      o.classList.remove('cc-open');
      o.setAttribute('aria-hidden','true');
    }
    refreshOverviewWidget();
  }

  function renderActivePanel(){
    if(_activeTab==='cards')      renderCardsPanel();
    else if(_activeTab==='matching')   renderMatchingPanel();
    else if(_activeTab==='history')    renderHistoryPanel();
    else if(_activeTab==='patterns')   renderPatternsPanel();
  }

  /* ── Cards panel ── */
  function renderCardsPanel(){
    let data=loadCC(); let cards=data.cards||[];
    let panel=document.getElementById('ccPanelCards');
    if(!panel) return;
    document.querySelectorAll('.cc-panel').forEach(function(p){ p.classList.remove('cc-panel-active'); });
    panel.classList.add('cc-panel-active');

    let html='<div class="cc-card-list">';
    if(!cards.length){
      html+='<div class="cc-empty"><div class="cc-empty-icon">💳</div>No cards yet. Add your first card below to start logging charges.</div>';
    } else {
      cards.forEach(function(card){
        let bal=cardBalance(card.id,data);
        let executed=cardExecuted(card.id,data);
        let pending=bal-executed; // bal = total charges this month, executed = matched ones
        html+='<div class="cc-card-item">';
        html+='<div class="cc-card-chip" style="background:'+esc(card.color||'#2563eb')+'">'+esc((card.issuer||'CC').slice(0,3).toUpperCase())+'</div>';
        html+='<div class="cc-card-info">';
        html+='<div class="cc-card-name">'+esc(card.name)+'</div>';
        html+='<div class="cc-card-meta">'+(card.last4?'•••• '+esc(card.last4)+' · ':'')+esc(card.issuer||'')+'</div>';
        html+='</div>';
        html+='<div class="cc-card-balance'+(bal>0?' bal-red':'')+'" title="€'+executed.toFixed(2)+' matched · €'+pending.toFixed(2)+' pending">€'+bal.toFixed(2)+'</div>';
        html+='<div class="cc-card-actions">';
        html+='<button class="cc-card-btn cc-log-charge-btn" data-card-id="'+esc(card.id)+'" type="button">+ Charge</button>';
        html+='<button class="cc-card-btn cc-danger cc-del-card-btn" data-card-id="'+esc(card.id)+'" type="button">Delete</button>';
        html+='</div></div>';
      });
    }
    html+='</div>';
    html+='<div class="cc-add-form'+(_addCardFormOpen?'':' cc-hidden')+'" id="ccAddForm">';
    html+='<div style="font-size:.8rem;font-weight:800;color:var(--accent-text);margin-bottom:8px;">Add a credit card</div>';
    html+='<div class="cc-form-row">';
    html+='<div class="cc-form-field"><label>Nickname *</label><input class="cc-form-input" id="ccCardName" placeholder="e.g. Visa Gold" type="text"/></div>';
    html+='<div class="cc-form-field"><label>Issuer</label><input class="cc-form-input" id="ccCardIssuer" placeholder="e.g. BNP Paribas" type="text"/></div>';
    html+='<div class="cc-form-field" style="max-width:100px"><label>Last 4 digits</label><input class="cc-form-input" id="ccCardLast4" placeholder="1234" maxlength="4" type="text"/></div>';
    html+='</div>';
    html+='<div class="cc-form-row"><div class="cc-form-field"><label>Card colour</label><div class="cc-color-swatch-row" id="ccSwatches">';
    SWATCH_COLORS.forEach(function(c){ html+='<div class="cc-swatch'+(c===_selColor?' cc-swatch-sel':'')+'" style="background:'+c+'" data-color="'+c+'"></div>'; });
    html+='</div></div></div>';
    html+='<div class="cc-form-btns"><button class="cc-save-btn" id="ccSaveCardBtn" type="button">Save card</button><button class="cc-cancel-form-btn" id="ccCancelCardBtn" type="button">Cancel</button></div>';
    html+='</div>';
    if(!_addCardFormOpen) html+='<button class="cc-toolbar-btn cc-secondary" id="ccShowAddCardBtn" type="button" style="margin-top:10px;">+ Add credit card</button>';
    panel.innerHTML=html;

    panel.querySelectorAll('.cc-swatch').forEach(function(s){
      s.addEventListener('click',function(){
        _selColor=s.dataset.color;
        panel.querySelectorAll('.cc-swatch').forEach(function(x){ x.classList.toggle('cc-swatch-sel',x.dataset.color===_selColor); });
      });
    });
    let sv=document.getElementById('ccSaveCardBtn');
    if(sv) sv.addEventListener('click',function(){
      let name=(document.getElementById('ccCardName').value||'').trim();
      if(!name){ alert('Please enter a card nickname.'); return; }
      let d=loadCC(); if(!Array.isArray(d.cards)) d.cards=[];
      d.cards.push({id:'cc-'+Date.now().toString(36),name:name,
        issuer:(document.getElementById('ccCardIssuer').value||'').trim(),
        last4:(document.getElementById('ccCardLast4').value||'').trim(),
        color:_selColor,createdAt:new Date().toISOString()});
      saveCC(d); _addCardFormOpen=false; renderCardsPanel();
    });
    let cv=document.getElementById('ccCancelCardBtn');
    if(cv) cv.addEventListener('click',function(){ _addCardFormOpen=false; renderCardsPanel(); });
    let shw=document.getElementById('ccShowAddCardBtn');
    if(shw) shw.addEventListener('click',function(){ _addCardFormOpen=true; renderCardsPanel(); });

    panel.querySelectorAll('.cc-log-charge-btn').forEach(function(btn){
      btn.addEventListener('click',function(){
        _activeTab='charges';
        _activeTab='matching';
        _preselCardId=btn.dataset.cardId;
        document.querySelectorAll('.cc-tab').forEach(function(t){ t.classList.toggle('cc-active',t.dataset.ccTab==='matching'); });
        renderMatchingPanel(btn.dataset.cardId);
      });
    });
    panel.querySelectorAll('.cc-del-card-btn').forEach(function(btn){
      btn.addEventListener('click',function(){
        if(!confirm('Delete this card and all its charges?')) return;
        let d=loadCC(); let cid=btn.dataset.cardId;
        d.cards=(d.cards||[]).filter(function(c){ return c.id!==cid; });
        d.charges=(d.charges||[]).filter(function(c){ return c.cardId!==cid; });
        saveCC(d); renderCardsPanel();
      });
    });
  }

  /* Balance helpers */
  function cardBalance(cardId,data){
    let now=new Date(); let ym=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
    let charges=(data.charges||[]).filter(function(c){ return c.cardId===cardId&&(c.date||'').startsWith(ym); });
    return charges.reduce(function(s,c){ return s+parseFloat(c.amount||0); },0);
  }
  function cardExecuted(cardId,data){
    let now=new Date(); let ym=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
    let charges=(data.charges||[]).filter(function(c){ return c.cardId===cardId&&(c.date||'').startsWith(ym)&&c.matched; });
    return charges.reduce(function(s,c){ return s+parseFloat(c.amount||0); },0);
  }

  /* ── Charges panel (with PDF/CSV import) ── */

  /* ── Upload zone wiring ── */
  function wireUploadZone(cardId){
    let zone=document.getElementById('ccUploadZone');
    let fileInput=document.getElementById('ccStatementFile');
    if(!zone||!fileInput) return;

    zone.addEventListener('click',function(){ fileInput.click(); });
    zone.addEventListener('dragover',function(e){ e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave',function(){ zone.classList.remove('drag-over'); });
    zone.addEventListener('drop',function(e){
      e.preventDefault(); zone.classList.remove('drag-over');
      let f=e.dataTransfer.files[0];
      if(f) processStatementFile(f,cardId);
    });
    fileInput.addEventListener('change',function(){
      let f=this.files[0];
      if(f) processStatementFile(f,cardId);
      this.value='';
    });
  }

  function showParseProgress(msg){
    let wrap=document.getElementById('ccImportZoneWrap');
    let zone=document.getElementById('ccUploadZone');
    let prog=document.getElementById('ccImportProgress');
    let msgEl=document.getElementById('ccImportProgressMsg');
    if(wrap) wrap.style.display='';
    if(zone) zone.style.display='none';
    if(prog) prog.style.display='flex';
    if(msgEl) msgEl.textContent=msg||'Processing…';
  }
  function hideParseProgress(){
    let prog=document.getElementById('ccImportProgress');
    if(prog) prog.style.display='none';
    let zone=document.getElementById('ccUploadZone');
    if(zone) zone.style.display='';
  }

  /* ── PDF/CSV statement processing (pdf.js text layer, fully inline) ── */

  function processStatementFile(file, cardId){
    let ext = (file.name||'').split('.').pop().toLowerCase();
    showParseProgress('Reading file\u2026');
    let reader = new FileReader();
    if(ext === 'csv'){
      reader.onload = function(e){
        hideParseProgress();
        let rows = parseStatementCSV(e.target.result);
        showImportPreview(rows, cardId);
      };
      reader.readAsText(file, 'UTF-8');
    } else if(ext === 'pdf'){
      reader.onload = function(e){ extractPDFText(e.target.result, cardId); };
      reader.readAsArrayBuffer(file);
    } else {
      hideParseProgress();
      alert('Please upload a .pdf or .csv file.');
    }
  }

  /* ── PDF text extraction via bundled pdf.js (no network, no OCR needed) ──
     Bank statements are digitally generated PDFs — they contain embedded text
     that pdf.js can extract directly via page.getTextContent().
     Each text item carries x/y position which we use to reconstruct rows.
  ──────────────────────────────────────────────────────────────────────── */
  function extractPDFText(arrayBuffer, cardId){
    if(!window.pdfjsLib || !window._pdfJsBundled){
      hideParseProgress();
      alert('PDF library failed to initialise. Please refresh the page and try again.');
      return;
    }
    showParseProgress('Reading PDF\u2026');
    pdfjsLib.getDocument({ data: arrayBuffer, disableWorker: true }).promise.then(function(pdf){
      extractAllPageTexts(pdf, 1, [], cardId);
    }).catch(function(e){
      hideParseProgress();
      alert('Could not open PDF: ' + (e.message||e));
    });
  }

  function extractAllPageTexts(pdf, pageNum, allItems, cardId){
    if(pageNum > pdf.numPages){
      hideParseProgress();
      let rows = parsePositionalText(allItems);
      if(!rows.length){
        // Fallback: try line-based parser on concatenated text
        let plainText = allItems.map(function(it){ return it.str; }).join('\n');
        rows = parseOCRText(plainText);
      }
      if(!rows.length){
        alert('No transactions found in this PDF.\n\nMake sure it is a digitally-generated statement (not a scan). You can also use the CSV export from your bank.');
        return;
      }
      showImportPreview(rows, cardId);
      return;
    }
    showParseProgress('Reading page ' + pageNum + ' of ' + pdf.numPages + '\u2026');
    pdf.getPage(pageNum).then(function(page){
      let vp = page.getViewport({scale: 1});
      page.getTextContent().then(function(tc){
        // Tag each item with page number and viewport height (for y-flip)
        tc.items.forEach(function(item){
          item._pageNum = pageNum;
          item._pageH   = vp.height;
        });
        allItems = allItems.concat(tc.items);
        extractAllPageTexts(pdf, pageNum + 1, allItems, cardId);
      });
    });
  }

  /* ── parsePositionalText ───────────────────────────────────────────────
     pdf.js text items each have a transform matrix: [a,b,c,d,tx,ty]
     tx = x position, ty = y position (from bottom of page in PDF coords).

     Strategy for the statement layout (4 columns):
       Col 1 (x ~28–110):  datum verrichting  → transaction date
       Col 2 (x ~110–190): datum verrekening  → ignored
       Col 3 (x ~190–430): omschrijving       → description
       Col 4 (x ~430+):    bedrag             → amount (negative = charge)

     We group items by y-position (same row = within 4px), then sort by x,
     then apply column logic to extract date / description / amount.
  ──────────────────────────────────────────────────────────────────────── */
  function parsePositionalText(items){
    if(!items.length) return [];

    // Convert PDF y (bottom-origin) to top-origin per page
    // Items are already tagged with _pageNum; offset pages vertically
    let pageHeights = {};
    items.forEach(function(it){
      let ph = it._pageH || 800;
      if(!pageHeights[it._pageNum]) pageHeights[it._pageNum] = 0;
      // cumulative offset: stack pages top to bottom
    });

    // Group by (pageNum, rounded_y)
    let rows = {};
    items.forEach(function(it){
      let str = (it.str||'').trim();
      if(!str) return;
      let tx = it.transform ? it.transform[4] : 0;
      let ty = it.transform ? it.transform[5] : 0;
      // Flip y within page, offset by page index
      let yTop = (it._pageH||800) - ty + (it._pageNum - 1) * 1200;
      // Round to nearest 4px to group items on the same visual line
      let rowKey = Math.round(yTop / 4) * 4;
      if(!rows[rowKey]) rows[rowKey] = [];
      rows[rowKey].push({str: str, x: tx, y: yTop});
    });

    // Sort row keys top→bottom
    let rowKeys = Object.keys(rows).map(Number).sort(function(a,b){return a-b;});

    let DATE_RE   = /^\d{1,2}[-\/\.]\d{1,2}[-\/\.]\d{2,4}$/;
    let AMOUNT_RE = /^-?\d{1,3}(?:\.\d{3})*,\d{2}$/;

    let transactions = [];
    let current = null;

    function flush(){
      if(!current) return;
      if(current.amount !== null && current.amount > 0){
        transactions.push({
          date: cleanDate(current.date),
          desc: current.desc.replace(/\s+/g,' ').trim(),
          amount: current.amount,
          cat: ''
        });
      }
      current = null;
    }

    rowKeys.forEach(function(rk){
      let items = rows[rk].slice().sort(function(a,b){return a.x-b.x;});
      let texts = items.map(function(it){return it.str;});
      let xs    = items.map(function(it){return it.x;});

      // Skip pure header rows
      let joined = texts.join(' ');
      if(/datum verrichting|datum verrekening|omschrijving|bedrag in eur|overzicht van/i.test(joined)) return;

      // Detect columns by x position
      // Dates live around x=28-190, amounts at x>380 (right-aligned)
      // We look for: does this row contain a date in col1 position?
      let col1items = items.filter(function(it){ return it.x < 150; });
      let col3items = items.filter(function(it){ return it.x >= 150 && it.x < 420; });
      let col4items = items.filter(function(it){ return it.x >= 380; });

      let dates = col1items.filter(function(it){ return DATE_RE.test(it.str); });
      let amountItems = col4items.filter(function(it){ return AMOUNT_RE.test(it.str); });
      let descText  = col3items.map(function(it){return it.str;}).join(' ').trim();

      if(dates.length > 0){
        // New transaction row
        flush();
        let txDate = dates[0].str; // first date = verrichting date
        let amt = null;
        if(amountItems.length){
          amt = parseStatementAmount(amountItems[amountItems.length-1].str);
        }
        current = {date: txDate, desc: descText, amount: amt};
      } else if(amountItems.length && current && current.amount === null){
        // Amount landed on a continuation line
        current.amount = parseStatementAmount(amountItems[amountItems.length-1].str);
        if(descText) current.desc += ' ' + descText;
      } else if(current && descText){
        // Continuation description line (e.g. exchange rate note)
        current.desc += ' ' + descText;
      }
    });

    flush();

    // Deduplicate
    let seen = {};
    return transactions.filter(function(r){
      let key = r.date+'|'+r.amount.toFixed(2)+'|'+r.desc.slice(0,20);
      if(seen[key]) return false; seen[key]=true; return true;
    });
  }

  /* ── parseOCRText (fallback line-based parser) ── */
  function parseOCRText(text){
    let lines = text.split(/\r?\n/).map(function(l){ return l.trimEnd(); });
    let DATE_RE   = /\b(\d{1,2}[-\/\.](?:\d{2}|\d{1,2})[-\/\.](?:20\d{2}|\d{2}))\b/;
    let AMOUNT_RE = /(-?\s*(?:\d{1,3}\.)*\d{1,3},\d{2})\s*$/;
    let transactions = [];
    let current = null;
    function flushCurrent(){
      if(!current) return;
      if(current.amount !== null && current.amount > 0) transactions.push({date:cleanDate(current.date),desc:current.desc.replace(/\s+/g,' ').trim(),amount:current.amount,cat:''});
      current = null;
    }
    lines.forEach(function(line){
      let trimmed = line.trim(); if(!trimmed) return;
      if(/datum verrichting|datum verrekening|omschrijving|bedrag in eur|overzicht van/i.test(trimmed)) return;
      let dateMatch   = trimmed.match(DATE_RE);
      let amountMatch = trimmed.match(AMOUNT_RE);
      if(dateMatch){
        let allDates = trimmed.match(/\d{1,2}[-\/\.]\d{1,2}[-\/\.](?:20\d{2}|\d{2})/g)||[];
        let txDate = allDates[0]||dateMatch[1];
        let descFrag = trimmed; allDates.forEach(function(d){descFrag=descFrag.replace(d,'');});
        let amt = null;
        if(amountMatch){ amt=parseStatementAmount(amountMatch[1]); descFrag=descFrag.replace(amountMatch[0],''); }
        flushCurrent();
        current = {date:txDate, desc:descFrag.replace(/\s+/g,' ').trim(), amount:amt};
      } else if(amountMatch && current){
        if(current.amount===null) current.amount=parseStatementAmount(amountMatch[1]);
        let extra=trimmed.replace(amountMatch[0],'').trim();
        if(extra&&!/^\d{1,2}[-\/\.]/.test(extra)) current.desc+=' '+extra;
      } else if(current){
        if(trimmed.length>2&&!/^[\-\.]+$/.test(trimmed)) current.desc+=' '+trimmed;
      }
    });
    flushCurrent();
    let seen={};
    return transactions.filter(function(r){
      let key=r.date+'|'+r.amount.toFixed(2)+'|'+r.desc.slice(0,20);
      if(seen[key])return false;seen[key]=true;return true;
    });
  }

  /* ── CSV parsing ── */
  /* ── CSV parsing (unchanged) ── */
  /* Parse a simple CSV statement — tries to detect date/desc/amount columns */
  function parseStatementCSV(text){
    let lines=text.split(/\r?\n/).filter(function(l){ return l.trim(); });
    if(!lines.length) return [];
    let delim=lines[0].indexOf(';')>lines[0].indexOf(',')?';':',';
    let headers=splitCSVLine(lines[0],delim).map(function(h){ return h.toLowerCase().trim(); });
    let dateIdx=findCol(headers,['date','datum','valuta','transaction date','boekingsdatum','date de valeur']);
    let descIdx=findCol(headers,['description','omschrijving','libelle','details','name','merchant','memo','tegenpartij','communication','mededeling']);
    let amtIdx =findCol(headers,['amount','bedrag','montant','debit','credit','bedrag eur','amount eur','transaction amount']);
    if(dateIdx<0||amtIdx<0){ return linesAsRawRows(lines,delim); }
    let rows=[];
    for(let i=1;i<lines.length;i++){
      let cols=splitCSVLine(lines[i],delim);
      let rawAmt=cols[amtIdx]||'';
      let amt=parseStatementAmount(rawAmt);
      if(isNaN(amt)||amt===0) continue;
      if(amt<0) amt=Math.abs(amt);
      rows.push({
        date:cleanDate(cols[dateIdx]||''),
        desc:descIdx>=0?(cols[descIdx]||'').trim():'',
        amount:amt,cat:'',raw:lines[i]
      });
    }
    return rows;
  }

  function findCol(headers,candidates){
    for(let ci=0;ci<candidates.length;ci++){
      let idx=headers.findIndex(function(h){ return h.indexOf(candidates[ci])>=0; });
      if(idx>=0) return idx;
    }
    return -1;
  }

  function linesAsRawRows(lines,delim){
    return lines.slice(1).map(function(l){
      let cols=splitCSVLine(l,delim);
      return {date:'',desc:l.trim(),amount:0,cat:'',raw:l};
    });
  }

  function splitCSVLine(line,delim){
    let cols=[],cur='',inq=false;
    for(let i=0;i<line.length;i++){
      let ch=line[i];
      if(ch==='"'){ inq=!inq; }
      else if(ch===delim&&!inq){ cols.push(cur.trim()); cur=''; }
      else cur+=ch;
    }
    cols.push(cur.trim());
    return cols;
  }

  function cleanDate(s){
    s=(s||'').trim().replace(/['"]/g,'');
    let m;
    if((m=s.match(/^(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{4})$/))) return m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');
    if((m=s.match(/^(\d{4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})$/))) return m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');
    if((m=s.match(/^(\d{8})$/))) return m[1].slice(0,4)+'-'+m[1].slice(4,6)+'-'+m[1].slice(6,8);
    return s;
  }

  function parseStatementAmount(s){
    if(!s) return NaN;
    s=String(s).replace(/['"€$£\s]/g,'').replace(/-\s*/,'-').trim();
    if(!s) return NaN;
    if(/^\(.*\)$/.test(s)) s='-'+s.slice(1,-1);
    // Belgian: 1.234,56
    if(s.indexOf(',')>-1&&s.indexOf('.')>-1){
      let li=s.lastIndexOf(','),ld=s.lastIndexOf('.');
      if(li>ld) s=s.replace(/\./g,'').replace(',','.');
      else s=s.replace(/,/g,'');
    } else if(s.indexOf(',')>-1){
      let parts=s.split(',');
      if(parts.length===2&&parts[1].length<=2) s=s.replace(',','.');
      else s=s.replace(/,/g,'');
    }
    let n = parseFloat(s);
    // Charges on CC statements are negative in the PDF but we store as positive
    return Math.abs(n);
  }

  /* ── Import preview ── */
  /* ── Import preview ── */
  function showImportPreview(rows,cardId){
    _importPreview=rows;
    let wrap=document.getElementById('ccImportPreviewWrap');
    if(!wrap) return;
    if(!rows.length){ wrap.innerHTML='<div class="cc-empty" style="padding:16px 0">No transactions found in this file.</div>'; return; }

    // Mark any row with no positive amount as removable by default (totals, headers etc.)
    // Also pre-flag rows that look like totals/balance lines
    let TOTAL_RE=/totaal|total|saldo|balance|opening|closing|carried|subtotal|bedrag.*verrichting|som\s|somme\s|overschrijving tot/i;
    _importPreview.forEach(function(r){
      if(typeof r.removed==='undefined'){
        r.removed = TOTAL_RE.test(r.desc||'');
      }
    });

    rebuildPreviewTable(cardId);
  }

  function getCcExpenseGroups(){
    let st=window.state, months=(st&&Array.isArray(st.months))?st.months:[], all={}, savAll={};
    months.forEach(function(m){
      (m.expenseCategoryOrder||[]).forEach(function(g){ if(g) all[g]=true; });
      (m.expenses||[]).forEach(function(r){ if(r&&r.group) all[r.group]=true; });
      (m.savings||[]).forEach(function(r){ if(r&&r.group) savAll[r.group]=true; });
    });
    let groups=Object.keys(all);
    Object.keys(savAll).forEach(function(g){ groups.push('savings:'+g); });
    return groups;
  }
  function buildCcExpenseSubOpts(cat,sel){
    let st=window.state;
    if(!cat||!st||!Array.isArray(st.months)) return '<option value="">— Sub-category —</option>';
    let isSav=cat.indexOf('savings:')=== 0;
    let realCat=isSav?cat.slice(8):cat;
    let subs={};
    st.months.forEach(function(m){
      let pool=isSav?(m.savings||[]):(m.expenses||[]);
      pool.forEach(function(r){ if(r&&r.group===realCat&&r.name) subs[r.name]=true; });
    });
    let html='<option value="">— Sub-category —</option>';
    Object.keys(subs).forEach(function(name){ html+='<option value="'+esc(name)+'"'+(name===sel?' selected':'')+'>'+esc(name)+'</option>'; });
    return html;
  }

  function buildCcCatOpts(sel){
    let groups=getCcExpenseGroups();
    let html='<option value="">— Category —</option>';
    groups.forEach(function(g){
      let isSav=g.indexOf('savings:')===0;
      let label=isSav?('💰 '+g.slice(8)):g;
      html+='<option value="'+esc(g)+'"'+(g===sel?' selected':'')+'>'+esc(label)+'</option>';
    });
    return html;
  }
  function rebuildPreviewTable(cardId){
    let wrap=document.getElementById('ccImportPreviewWrap');
    if(!wrap) return;
    let active=_importPreview.filter(function(r){ return !r.removed; });
    let html='<div style="font-size:.76rem;font-weight:700;color:var(--accent-text);margin-bottom:6px;">'+_importPreview.length+' transactions found — review and confirm:</div>';
    html+='<div style="overflow-x:auto"><table class="cc-preview-table">';
    html+='<thead><tr><th></th><th>Date</th><th>Description</th><th style="text-align:right">Amount</th><th>Category</th><th>Sub-category</th></tr></thead><tbody>';
    _importPreview.forEach(function(r,i){
      let removed=!!r.removed;
      let rowStyle=removed?'opacity:.38;text-decoration:line-through;':'';
      html+='<tr style="'+rowStyle+'" data-preview-idx="'+i+'">';
      // Remove/restore toggle
      html+='<td style="width:28px;text-align:center">';
      if(removed){
        html+='<button class="cc-prev-restore" data-idx="'+i+'" title="Restore" type="button" style="font:inherit;font-size:.65rem;font-weight:700;background:rgba(16,185,129,.1);color:#065f46;border:1px solid rgba(16,185,129,.25);border-radius:5px;padding:1px 5px;cursor:pointer;">↩</button>';
      } else {
        html+='<button class="cc-prev-remove" data-idx="'+i+'" title="Remove this row" type="button" style="font:inherit;font-size:.72rem;background:none;border:none;color:var(--muted);cursor:pointer;padding:1px 4px;border-radius:4px;" '+(removed?'disabled':'')+'>✕</button>';
      }
      html+='</td>';
      html+='<td><input class="cc-form-input" style="min-width:110px;padding:3px 6px;font-size:.7rem" type="date" data-prev-date="'+i+'" value="'+esc(r.date||'')+'"'+(removed?' disabled':'')+'/></td>';
      html+='<td><input class="cc-form-input" style="width:100%;min-width:150px;padding:3px 6px;font-size:.7rem" type="text" data-prev-desc="'+i+'" value="'+esc(r.desc||'')+'"'+(removed?' disabled':'')+'/></td>';
      html+='<td class="td-amt">€'+parseFloat(r.amount||0).toFixed(2)+'</td>';
      // Category dropdown
      html+='<td><select class="cc-form-input cc-prev-cat" data-idx="'+i+'" style="min-width:130px;padding:3px 6px;font-size:.7rem"'+(removed?' disabled':'')+'>'+buildCcCatOpts(r.cat||'')+'</select></td>';
      // Sub-category dropdown
      html+='<td><select class="cc-form-input cc-prev-sub" data-idx="'+i+'" style="min-width:130px;padding:3px 6px;font-size:.7rem"'+(removed?' disabled':'')+'>'+buildCcExpenseSubOpts(r.cat||'',r.sub||'')+'</select></td>';
      html+='</tr>';
    });
    html+='</tbody></table></div>';
    let activeCnt=active.length;
    html+='<div class="cc-preview-actions">';
    html+='<button class="cc-save-btn" id="ccConfirmImportBtn" type="button" '+(activeCnt===0?'disabled':'')+'>Import '+activeCnt+' charge'+(activeCnt===1?'':'s')+'</button>';
    html+='<button class="cc-cancel-form-btn" id="ccCancelImportBtn" type="button">Cancel</button>';
    html+='</div>';
    wrap.innerHTML=html;

    // Wire inputs
    wrap.querySelectorAll('[data-prev-date]').forEach(function(inp){
      inp.addEventListener('change',function(){ _importPreview[+this.dataset.prevDate].date=this.value; });
    });
    wrap.querySelectorAll('[data-prev-desc]').forEach(function(inp){
      inp.addEventListener('input',function(){ _importPreview[+this.dataset.prevDesc].desc=this.value; });
    });
    // Category dropdown → update data + re-render sub-category cell only
    wrap.querySelectorAll('.cc-prev-cat').forEach(function(sel){
      sel.addEventListener('change',function(){
        let idx=+this.dataset.idx;
        _importPreview[idx].cat=this.value;
        _importPreview[idx].sub='';
        // Swap out the sub-category select in place (avoid full re-render)
        let row=this.closest('tr');
        let subSel=row&&row.querySelector('.cc-prev-sub');
        if(subSel){
          subSel.innerHTML=buildCcExpenseSubOpts(this.value,'');
          subSel.addEventListener('change',function(){
            _importPreview[idx].sub=this.value;
          });
        }
        _updateConfirmBtn();
      });
    });
    wrap.querySelectorAll('.cc-prev-sub').forEach(function(sel){
      sel.addEventListener('change',function(){
        _importPreview[+this.dataset.idx].sub=this.value;
      });
    });
    // Remove/restore
    wrap.querySelectorAll('.cc-prev-remove').forEach(function(btn){
      btn.addEventListener('click',function(){
        _importPreview[+this.dataset.idx].removed=true;
        rebuildPreviewTable(cardId);
      });
    });
    wrap.querySelectorAll('.cc-prev-restore').forEach(function(btn){
      btn.addEventListener('click',function(){
        _importPreview[+this.dataset.idx].removed=false;
        rebuildPreviewTable(cardId);
      });
    });

    let confirmBtn=document.getElementById('ccConfirmImportBtn');
    if(confirmBtn) confirmBtn.addEventListener('click',function(){
      commitStatementImport(_importPreview.filter(function(r){ return !r.removed; }),cardId);
    });
    document.getElementById('ccCancelImportBtn').addEventListener('click',function(){
      _importPreview=[]; _importMode=false; renderMatchingPanel();
    });
  }

  function _updateConfirmBtn(){
    let btn=document.getElementById('ccConfirmImportBtn');
    if(!btn) return;
    let active=_importPreview.filter(function(r){ return !r.removed; }).length;
    btn.disabled=active===0;
    btn.textContent='Import '+active+' charge'+(active===1?'':'s');
  }

  function commitStatementImport(rows,cardId){
    let d=loadCC(); if(!Array.isArray(d.charges)) d.charges=[];
    let added=0;
    rows.forEach(function(r){
      if(!r.amount||r.amount<=0) return;
      let autoC=(!r.cat&&!r.sub&&typeof window.autoExpenseCategory==='function')?window.autoExpenseCategory(r.desc||''):null;
      d.charges.push({id:'chg-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,5),
        cardId:cardId,date:r.date||todayISO(),desc:r.desc||'Imported charge',
        amount:parseFloat(r.amount),cat:r.cat||(autoC&&autoC.cat)||'',sub:r.sub||(autoC&&autoC.sub)||'',matched:false,
        source:'import',createdAt:new Date().toISOString()});
      added++;
    });
    saveCC(d); _importMode=false; _importPreview=[]; _preselCardId=cardId;
    renderMatchingPanel();
    // Keep imported charges unmatched until the user manually saves a match or clicks Auto-match.
    let d2=loadCC(); recalcRepaymentSummaries(d2); saveCC(d2);
    renderMatchingPanel();
  }

  function ccFmt(v){ return '€'+Number(v||0).toFixed(2); }
  function ccChargeLine(c){
    return (c.date||'—')+' · '+(c.desc||'Imported charge')+' · '+ccFmt(c.amount||0)+(c.cat?(' · '+c.cat+(c.sub?' / '+c.sub:'')):'');
  }
  function ccCardName(cardId,cards){
    let card=(cards||[]).find(function(c){ return c.id===cardId; });
    return card?card.name:'Unassigned card';
  }
  function buildRepaymentMatchDetails(rep,data,cards){
    let rid=rep.id;
    let repAmt=Number(rep.amount||0);
    let charges=(data.charges||[]).filter(function(c){
      if(c.ignored) return false;
      if(rep.cardId && c.cardId!==rep.cardId) return false;
      return c.matchedRepayId===rid || !c.matched;
    }).sort(function(a,b){ return (a.date||'').localeCompare(b.date||''); });
    let matched=charges.filter(function(c){ return c.matchedRepayId===rid; });
    let matchedTotal=matched.reduce(function(s,c){ return s+Number(c.amount||0); },0);
    let diff=repAmt-matchedTotal;
    let html='<div class="cc-match-detail" data-match-detail="'+esc(rid)+'" style="margin:8px 0 0 0;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--panel-2);">';
    html+='<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;margin-bottom:7px;">';
    html+='<div><div style="font-size:.68rem;font-weight:800;color:var(--accent-text);">Matched charge details</div><div style="font-size:.62rem;color:var(--muted);margin-top:2px;">Review or manually select the card charges covered by this bank repayment before saving the match.</div></div>';
    html+='<div style="font-size:.66rem;font-family:var(--font-mono);font-weight:700;text-align:right;white-space:nowrap;">Selected '+ccFmt(matchedTotal)+' / '+ccFmt(repAmt)+'<br><span style="color:'+(Math.abs(diff)<=Math.max(1,repAmt*.02)?'#166534':'#92400e')+'">Difference '+ccFmt(diff)+'</span></div>';
    html+='</div>';
    if(!rep.cardId){
      html+='<div style="font-size:.68rem;color:#92400e;font-weight:700;">Assign a card first to see available charges.</div>';
    } else if(!charges.length){
      html+='<div style="font-size:.68rem;color:var(--muted);">No unmatched or currently matched charges are available for '+esc(ccCardName(rep.cardId,cards))+'.</div>';
    } else {
      html+='<div style="display:grid;gap:5px;max-height:220px;overflow:auto;padding-right:4px;">';
      charges.forEach(function(c){
        let checked=c.matchedRepayId===rid;
        html+='<label class="cc-match-choice" style="display:grid;grid-template-columns:18px minmax(0,1fr) auto;gap:8px;align-items:center;padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:var(--panel);font-size:.67rem;cursor:pointer;">';
        html+='<input type="checkbox" data-manual-charge-id="'+esc(c.id)+'" '+(checked?'checked':'')+' />';
        html+='<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="'+esc(ccChargeLine(c))+'">'+esc(c.date||'—')+' · '+esc(c.desc||'Imported charge')+(c.cat?' · '+esc(c.cat+(c.sub?' / '+c.sub:'')):'')+'</span>';
        html+='<strong style="font-family:var(--font-mono);">'+ccFmt(c.amount||0)+'</strong>';
        html+='</label>';
      });
      html+='</div>';
      html+='<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:9px;flex-wrap:wrap;">';
      html+='<button type="button" class="cc-cancel-form-btn" data-manual-unmatch="'+esc(rid)+'">Unmatch all</button>';
      html+='<button type="button" class="cc-save-btn" data-manual-save="'+esc(rid)+'">Save manual match</button>';
      html+='</div>';
    }
    html+='</div>';
    return html;
  }
  let CC_MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  function ccMonthNameFromISO(iso){
    let d=new Date(iso||todayISO());
    if(isNaN(d.getTime())) d=new Date();
    return CC_MONTH_NAMES[d.getMonth()]+' '+d.getFullYear();
  }
  function ccIsValidExpenseAssignment(c){
    let cat=String(c&&c.cat||'').trim();
    let sub=String(c&&c.sub||'').trim();
    return !!(cat && sub && cat!=='Imported' && sub!=='Imported');
  }
  function ccExpenseTxForCharge(c,repayId){
    return {
      amount:Math.abs(Number(c.amount||0)),
      note:normalizeImportText('💳 '+(c.desc||'Credit card charge'),'Credit card charge'),
      date:c.date||todayISO(),
      source:'credit-card',
      ledgerSource:'credit-card',
      creditCardCharge:true,
      ccChargeId:c.id||'',
      ccRepaymentId:repayId||'',
      cardId:c.cardId||'',
      createsFinancialEntry:true
    };
  }
  function ccEnsureBudgetMonth(monthName){
    let st=window.state;
    if(!st||!Array.isArray(st.months)) return null;
    let month=st.months.find(function(m){ return m&&m.name===monthName; });
    if(month) return month;
    return null;
  }
  function ccEnsureExpenseRow(month,cat,sub){
    if(!month||!cat||!sub) return null;
    let isSav=cat.indexOf('savings:')===0;
    let realCat=isSav?cat.slice(8):cat;
    if(isSav){
      if(!Array.isArray(month.savings)) month.savings=[];
      let row=month.savings.find(function(r){ return r&&r.group===realCat&&r.name===sub; });
      if(!row){
        row={
          id:'cc-sav-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7),
          type:'VARIABLE',
          group:realCat,
          name:sub,
          planned:0,
          transactions:[]
        };
        month.savings.push(row);
      }
      if(!Array.isArray(row.transactions)) row.transactions=[];
      return row;
    }
    if(!Array.isArray(month.expenses)) month.expenses=[];
    if(!Array.isArray(month.expenseCategoryOrder)) month.expenseCategoryOrder=[];
    if(month.expenseCategoryOrder.indexOf(realCat)<0) month.expenseCategoryOrder.push(realCat);
    let row=month.expenses.find(function(r){ return r&&r.group===realCat&&r.name===sub; });
    if(!row){
      row={
        id:'cc-exp-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7),
        type:'VARIABLE',
        group:realCat,
        name:sub,
        planned:0,
        fixed:false,
        transactions:[]
      };
      month.expenses.push(row);
    }
    if(!Array.isArray(row.transactions)) row.transactions=[];
    return row;
  }
  function ccPruneEmptyRows(){
    let st=window.state;
    if(!st||!Array.isArray(st.months)) return;
    st.months.forEach(function(month){
      if(Array.isArray(month.expenses)){
        month.expenses=month.expenses.filter(function(row){
          let id=String(row&&row.id||'');
          return !(id.indexOf('csv-')===0 && (!row.transactions||row.transactions.length===0) && !Number(row.planned||0));
        });
      }
      if(Array.isArray(month.income)){
        month.income=month.income.filter(function(row){
          let id=String(row&&row.id||'');
          return !(id.indexOf('csv-inc-')===0 && (!row.transactions||row.transactions.length===0) && !Number(row.planned||0));
        });
      }
      if(Array.isArray(month.savings)){
        month.savings=month.savings.filter(function(row){
          let id=String(row&&row.id||'');
          return !(id.indexOf('csv-sav-')===0 && (!row.transactions||row.transactions.length===0) && !Number(row.planned||0));
        });
      }
    });
  }

  function removeCcExpenseTransactionsForRepayment(repayId){
    let st=window.state;
    if(!st||!Array.isArray(st.months)||!repayId) return;
    st.months.forEach(function(month){
      (month.expenses||[]).forEach(function(row){
        if(Array.isArray(row.transactions)) row.transactions=row.transactions.filter(function(t){ return t.ccRepaymentId!==repayId; });
      });
      (month.savings||[]).forEach(function(row){
        if(Array.isArray(row.transactions)) row.transactions=row.transactions.filter(function(t){ return t.ccRepaymentId!==repayId; });
      });
    });
    ccPruneEmptyRows();
  }
  function removeCcExpenseTransactionsForCharge(chargeId){
    let st=window.state;
    if(!st||!Array.isArray(st.months)||!chargeId) return;
    st.months.forEach(function(month){
      (month.expenses||[]).forEach(function(row){
        if(Array.isArray(row.transactions)) row.transactions=row.transactions.filter(function(t){ return t.ccChargeId!==chargeId; });
      });
      (month.savings||[]).forEach(function(row){
        if(Array.isArray(row.transactions)) row.transactions=row.transactions.filter(function(t){ return t.ccChargeId!==chargeId; });
      });
    });
    ccPruneEmptyRows();
  }
  function cleanupLegacyCcRepaymentExpenseRows(){
    let st=window.state;
    if(!st||!Array.isArray(st.months)) return;
    // CC repayment bank lines are transfer/settlement records, not expenses.
    // Keep true card-charge expense transactions, remove only legacy repayment rows
    // that earlier builds accidentally posted into Expenses/Imported.
    let re=/\b(CC Repayment|credit card repayment|TERUGBETALING|FLEX BUDGET|repayment to credit card)\b/i;
    st.months.forEach(function(month){
      if(!Array.isArray(month.expenses)) return;
      (month.expenses||[]).forEach(function(row){
        if(!Array.isArray(row.transactions)) return;
        row.transactions=row.transactions.filter(function(t){
          if(!t) return false;
          if(t.creditCardCharge===true || String(t.source||t.ledgerSource||'')==='credit-card') return true;
          if(t.ccRepaymentId && !t.ccChargeId) return false;
          if(t.source==='cc-repayment'||t.ledgerSource==='cc-repayment') return false;
          if(String(row.group||'')==='Imported' && String(row.name||'')==='Imported' && re.test(String(t.note||''))) return false;
          if(re.test(String(t.note||'')) && String(t.ledgerSource||t.source||'')==='csv') return false;
          return true;
        });
      });
      month.expenses=month.expenses.filter(function(row){
        if(String(row.group||'')==='Imported' && String(row.name||'')==='Imported' && (!row.transactions||row.transactions.length===0) && !Number(row.planned||0)) return false;
        return true;
      });
    });
    ccPruneEmptyRows();
  }
  function postMatchedChargesToExpenses(data,repayId){
    if(!data||!repayId) return true;
    let charges=(data.charges||[]).filter(function(c){ return c.matchedRepayId===repayId; });
    let missing=charges.filter(function(c){ return !ccIsValidExpenseAssignment(c); });
    if(missing.length){
      alert('Please assign a real expense category and sub-category to every selected card charge before saving the match.');
      return false;
    }
    cleanupLegacyCcRepaymentExpenseRows();
    removeCcExpenseTransactionsForRepayment(repayId);
    charges.forEach(function(c){
      let month=ccEnsureBudgetMonth(ccMonthNameFromISO(c.date));
      if(!month){
        alert('Could not post one or more card charges because the matching budget month does not exist. Please create/import that month first.');
        return;
      }
      let cCat=String(c.cat||'').trim(), cSub=String(c.sub||'').trim();
      let row=ccEnsureExpenseRow(month,cCat,cSub);
      row.transactions=row.transactions.filter(function(t){ return t.ccChargeId!==c.id; });
      row.transactions.push(ccExpenseTxForCharge(c,repayId));
      if(cCat&&cSub&&cCat!=='Imported'&&cSub!=='Imported'&&typeof window.learnMerchant==='function') window.learnMerchant(c.desc||'',cCat,cSub);
    });
    if(typeof propagateLinkedRollovers==='function') propagateLinkedRollovers();
    if(typeof window.saveState==='function') window.saveState(window.state);
    else if(typeof saveState==='function') saveState(window.state);
    if(typeof renderAll==='function') renderAll();
    return true;
  }
  function persistCcChargeAssignment(chargeId,cat,sub){
    let data=loadCC();
    let c=(data.charges||[]).find(function(x){ return x.id===chargeId; });
    if(!c) return;
    c.cat=String(cat||'').trim();
    c.sub=String(sub||'').trim();
    saveCC(data);
    if(c.matchedRepayId && ccIsValidExpenseAssignment(c)) postMatchedChargesToExpenses(data,c.matchedRepayId);
  }

  function applyManualRepaymentMatch(repayId){
    let data=loadCC();
    let rep=(data.repayments||[]).find(function(r){ return r.id===repayId; });
    if(!rep) return;
    let activePanel=document.querySelector('.cc-panel.cc-panel-active') || document;
    let box=activePanel.querySelector('[data-match-detail="'+repayId+'"]') || null;
    let selected={};
    if(box){
      box.querySelectorAll('[data-manual-charge-id]:checked').forEach(function(inp){ selected[inp.dataset.manualChargeId]=true; });
      box.querySelectorAll('[data-charge-cat-id]').forEach(function(sel){
        let c=(data.charges||[]).find(function(x){ return x.id===sel.dataset.chargeCatId; });
        if(c) c.cat=String(sel.value||'').trim();
      });
      box.querySelectorAll('[data-charge-sub-id]').forEach(function(sel){
        let c=(data.charges||[]).find(function(x){ return x.id===sel.dataset.chargeSubId; });
        if(c) c.sub=String(sel.value||'').trim();
      });
    }
    let selectedCharges=(data.charges||[]).filter(function(c){ return !!selected[c.id]; });
    if(selectedCharges.some(function(c){ return !ccIsValidExpenseAssignment(c); })){
      saveCC(data);
      alert('Please assign a real expense category and sub-category to every selected card charge before saving the match.');
      return;
    }
    removeCcExpenseTransactionsForRepayment(repayId);
    (data.charges||[]).forEach(function(c){
      if(c.matchedRepayId===repayId){ c.matched=false; delete c.matchedRepayId; }
    });
    let total=0,count=0;
    selectedCharges.forEach(function(c){
      c.matched=true; c.matchedRepayId=repayId;
      total+=Number(c.amount||0); count++;
    });
    let tolerance=Math.max(1,Number(rep.amount||0)*0.02);
    rep.manualMatched=true;
    rep.matchSaved=count>0;
    rep.matchedAt=count>0 ? new Date().toISOString() : '';
    rep.matchedAmount=total;
    rep.matchedChargeCount=count;
    rep.fullyMatched=count>0 && Math.abs(total-Number(rep.amount||0))<=tolerance;
    rep.partialMatch=count>0 && !rep.fullyMatched;
    if(count>0 && !postMatchedChargesToExpenses(data,repayId)) return;
    if (rep.matchSaved && _selectedRepayId === repayId) _selectedRepayId = null;
    saveCC(data); refreshOverviewWidget(); renderMatchingPanel();
  }
  function unmatchRepayment(repayId){
    removeCcExpenseTransactionsForRepayment(repayId);
    cleanupLegacyCcRepaymentExpenseRows();
    if(typeof window.saveState==='function') window.saveState(window.state);
    let data=loadCC();
    let rep=(data.repayments||[]).find(function(r){ return r.id===repayId; });
    (data.charges||[]).forEach(function(c){ if(c.matchedRepayId===repayId){ c.matched=false; delete c.matchedRepayId; } });
    if(rep){ rep.manualMatched=true; rep.matchSaved=false; rep.matchedAt=''; rep.fullyMatched=false; rep.partialMatch=false; rep.matchedChargeCount=0; rep.matchedAmount=0; }
    saveCC(data); refreshOverviewWidget(); renderMatchingPanel();
  }


  function isRepaymentWaitingForMatch(r){
    // Keep the active Matching list clean: once a repayment has a complete match,
    // it belongs in History. Partial matches remain visible so the user can finish
    // or correct them manually.
    return !!r && !r.matchSaved && !r.fullyMatched;
  }

  function getSelectedRepayment(data){
    let reps=((data&&data.repayments)||[]).filter(isRepaymentWaitingForMatch);
    if(_selectedRepayId && reps.some(function(r){ return r.id===_selectedRepayId; })) return reps.find(function(r){ return r.id===_selectedRepayId; });
    let open=reps.find(function(r){ return !r.partialMatch; }) || reps[0] || null;
    _selectedRepayId=open?open.id:null;
    return open;
  }

  function renderMatchingPanel(preselId){
    if(preselId) _preselCardId=preselId;
    syncRepaymentsFromCsvBatches();
    cleanupLegacyCcRepaymentExpenseRows();
    if(typeof window.saveState==='function') window.saveState(window.state);
    let data=loadCC(); let cards=data.cards||[]; recalcRepaymentSummaries(data); saveCC(data); data=loadCC(); let repayments=(data.repayments||[]).filter(isRepaymentWaitingForMatch);
    if(_selectedRepayId && !(repayments||[]).some(function(r){ return r.id===_selectedRepayId; })) _selectedRepayId=null;
    let panel=document.getElementById('ccPanelMatching') || document.getElementById('ccPanelCharges') || document.getElementById('ccPanelRepayments');
    if(!panel) return;
    document.querySelectorAll('.cc-panel').forEach(function(p){ p.classList.remove('cc-panel-active'); });
    panel.classList.add('cc-panel-active');
    if(!cards.length){ panel.innerHTML='<div class="cc-empty"><div class="cc-empty-icon">💳</div>Add a credit card on <strong>My Cards</strong> first.</div>'; return; }

    let rep=getSelectedRepayment(data);
    let activeCardId=(rep&&rep.cardId)||_preselCardId||(cards[0]&&cards[0].id);
    let cardOpts=cards.map(function(c){ return '<option value="'+esc(c.id)+'"'+(c.id===activeCardId?' selected':'')+'>'+esc(c.name)+'</option>'; }).join('');
    let html='<div class="cc-repayment-info"><strong>Matching workspace:</strong> select a bank repayment on the left, then tick the unmatched card charges it pays on the right. Auto-match only runs when you click it; otherwise charges stay unmatched until saved manually without changing bank CSV, budget, subscriptions, usage, or rollover logic.</div>';
    html+='<div class="cc-match-workspace">';

    html+='<section class="cc-match-pane"><div class="cc-match-pane-head"><div><div class="cc-match-pane-title">Bank repayments</div><div class="cc-match-pane-sub">Imported rows flagged as CC Repayment or manual repayments.</div></div></div><div class="cc-match-pane-body">';
    if(!repayments.length){
      html+='<div class="cc-empty" style="padding:20px 0"><div class="cc-empty-icon">🏦</div>No unmatched CC repayments waiting for assignment.</div>';
    } else {
      repayments.slice().sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); }).forEach(function(r){
        let card=cards.find(function(c){ return c.id===r.cardId; });
        let cls='cc-match-repay-card'+(r.id===_selectedRepayId?' is-selected':'')+(r.fullyMatched?' is-matched':'');
        let status=r.fullyMatched?'Fully matched':(r.partialMatch?'Partial match':'Unmatched');
        html+='<div class="'+cls+'" data-select-repay="'+esc(r.id)+'">';
        html+='<div class="cc-match-repay-top"><div><div class="cc-match-repay-title"><span class="cc-repay-marker">CC Repayment</span> '+esc(r.note||r.desc||'Bank repayment')+'</div><div class="cc-match-repay-meta">'+esc(r.date||'')+' · '+esc(card?card.name:'No card assigned')+' · '+esc(status)+(r.source==='bank-csv'?' · bank CSV':'')+'</div></div><div class="cc-match-repay-amt">'+ccFmt(r.amount||0)+'</div></div>';
        html+='<div style="display:flex;gap:6px;align-items:center;justify-content:space-between;flex-wrap:wrap;">';
        html+='<select class="cc-match-card-select" data-repay-card-id="'+esc(r.id)+'"><option value="">Select card…</option>';
        cards.forEach(function(c){ html+='<option value="'+esc(c.id)+'"'+(r.cardId===c.id?' selected':'')+'>'+esc(c.name)+'</option>'; });
        html+='</select>';
        html+='<button class="cc-toolbar-btn cc-secondary" style="font-size:.63rem;padding:4px 8px" data-repay-match-id="'+esc(r.id)+'" type="button">Auto-match</button>';
        html+='</div></div>';
      });
    }
    html+='</div></section>';

    html+='<section class="cc-match-pane"><div class="cc-match-pane-head"><div><div class="cc-match-pane-title">Card charges</div><div class="cc-match-pane-sub">Unmatched card charges stay here until you assign them to a repayment.</div></div><select class="cc-charges-select" id="ccMatchingCardSel">'+cardOpts+'</select></div><div class="cc-match-pane-body">';
    html+='<div class="cc-charges-toolbar" style="margin-bottom:0"><button class="cc-toolbar-btn" id="ccShowChargeFormBtn" type="button">+ Log manually</button><button class="cc-toolbar-btn cc-secondary" id="ccImportStatementBtn" type="button">📄 Import statement</button></div>';
    html+='<div id="ccImportZoneWrap" style="'+(_importMode?'':'display:none')+'"><div class="cc-upload-zone" id="ccUploadZone"><input type="file" id="ccStatementFile" accept=".pdf,.csv" /><div class="cc-upload-zone-icon">📄</div><div class="cc-upload-zone-label">Drop a PDF or CSV statement here</div><div class="cc-upload-zone-sub">PDF/CSV statement rows are imported as credit card charges only.</div></div><div id="ccImportProgress" style="display:none" class="cc-parse-progress"><div class="cc-parse-spinner"></div><span id="ccImportProgressMsg">Reading file…</span></div><div id="ccImportPreviewWrap"></div></div>';
    html+='<div class="cc-charge-form'+(_chargeFormOpen?'':' cc-hidden')+'" id="ccChargeForm"><div style="font-size:.78rem;font-weight:800;color:var(--accent-text);margin-bottom:8px;">Log a charge</div><div class="cc-form-row"><div class="cc-form-field" style="max-width:150px"><label>Date</label><input class="cc-form-input" id="ccChargeDate" type="date" value="'+todayISO()+'"/></div><div class="cc-form-field"><label>Description *</label><input class="cc-form-input" id="ccChargeDesc" placeholder="e.g. Zalando order" type="text"/></div><div class="cc-form-field" style="max-width:130px"><label>Amount (€) *</label><input class="cc-form-input" id="ccChargeAmt" placeholder="0.00" type="number" step="0.01" min="0"/></div><div class="cc-form-field"><label>Category</label><input class="cc-form-input" id="ccChargeCat" placeholder="e.g. Shopping" type="text"/></div></div><div class="cc-form-btns"><button class="cc-save-btn" id="ccSaveChargeBtn" type="button">Save charge</button><button class="cc-cancel-form-btn" id="ccCancelChargeBtn" type="button">Cancel</button></div></div>';

    if(!rep){
      html+='<div class="cc-empty" style="padding:22px 0"><div class="cc-empty-icon">↔️</div>Select or create a repayment first, then choose matching card charges.</div>';
    } else if(!rep.cardId){
      html+='<div class="cc-empty" style="padding:22px 0"><div class="cc-empty-icon">💳</div>Assign a card to the selected repayment first.</div>';
    } else {
      let visibleCharges=(data.charges||[]).filter(function(c){ return !c.ignored && c.cardId===rep.cardId && (!c.matched || c.matchedRepayId===rep.id); }).sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });
      let selectedTotal=visibleCharges.filter(function(c){ return c.matchedRepayId===rep.id; }).reduce(function(s,c){ return s+Number(c.amount||0); },0);
      let diff=Number(rep.amount||0)-selectedTotal;
      html+='<div class="cc-match-summary"><div><strong>Selected repayment:</strong> '+esc(rep.date||'')+' · '+ccFmt(rep.amount||0)+'<br><span style="color:var(--muted)">Selected charges update immediately while you tick boxes.</span></div><div id="ccLiveMatchTotal" style="font-family:var(--font-mono);font-weight:800;text-align:right">Selected '+ccFmt(selectedTotal)+'<br><span style="color:'+(Math.abs(diff)<=Math.max(1,Number(rep.amount||0)*.02)?'#166534':'#92400e')+'">Diff '+ccFmt(diff)+'</span></div></div>';
      if(!visibleCharges.length){
        html+='<div class="cc-empty" style="padding:18px 0"><div class="cc-empty-icon">🧾</div>No unmatched charges are available for this card.</div>';
      } else {
        let autoCatUpdated=false;
        html+='<div class="cc-match-charge-list" data-match-detail="'+esc(rep.id)+'">';
        visibleCharges.forEach(function(c){
          let checked=c.matchedRepayId===rep.id;
          if(!c.cat||!c.sub){
            let autoC=typeof window.autoExpenseCategory==='function'?window.autoExpenseCategory(c.desc||''):null;
            if(autoC&&autoC.cat&&autoC.sub){ c.cat=c.cat||autoC.cat; c.sub=c.sub||autoC.sub; autoCatUpdated=true; }
          }
          html+='<div class="cc-match-charge-row'+(checked?' is-linked':'')+'">';
          html+='<input type="checkbox" data-manual-charge-id="'+esc(c.id)+'" '+(checked?'checked':'')+' />';
          html+='<span class="cc-match-charge-date">'+esc(c.date||'')+'</span><span class="cc-match-charge-desc" title="'+esc(ccChargeLine(c))+'">'+esc(c.desc||'Imported charge')+'</span><span class="cc-match-charge-amt">'+ccFmt(c.amount||0)+'</span><button class="cc-charge-del" data-charge-id="'+esc(c.id)+'" type="button" title="Delete charge">✕</button>';
          html+='<select class="cc-match-cat-select" data-charge-cat-id="'+esc(c.id)+'">'+buildCcCatOpts(c.cat||'')+'</select>';
          html+='<select class="cc-match-sub-select" data-charge-sub-id="'+esc(c.id)+'">'+buildCcExpenseSubOpts(c.cat||'',c.sub||'')+'</select>';
          html+='</div>';
        });
        if(autoCatUpdated) saveCC(data);
        html+='</div><div class="cc-match-actions"><button type="button" class="cc-cancel-form-btn" data-manual-unmatch="'+esc(rep.id)+'">Unmatch selected repayment</button><button type="button" class="cc-save-btn" data-manual-save="'+esc(rep.id)+'">Save match to History</button></div>';
      }
    }
    html+='</div></section></div>';
    panel.innerHTML=html;
    wireMatchingPanel(panel, activeCardId);
  }

  function wireMatchingPanel(panel, activeCardId){
    let cardSel=document.getElementById('ccMatchingCardSel');
    if(cardSel) cardSel.addEventListener('change',function(){ _preselCardId=this.value; _importMode=false; _chargeFormOpen=false; renderMatchingPanel(this.value); });
    let showBtn=document.getElementById('ccShowChargeFormBtn');
    if(showBtn) showBtn.addEventListener('click',function(){ _chargeFormOpen=true; _importMode=false; renderMatchingPanel(activeCardId); });
    let impBtn=document.getElementById('ccImportStatementBtn');
    if(impBtn) impBtn.addEventListener('click',function(){ _importMode=!_importMode; _chargeFormOpen=false; renderMatchingPanel(activeCardId); });
    let cancel=document.getElementById('ccCancelChargeBtn');
    if(cancel) cancel.addEventListener('click',function(){ _chargeFormOpen=false; renderMatchingPanel(activeCardId); });
    let save=document.getElementById('ccSaveChargeBtn');
    if(save) save.addEventListener('click',function(){
      let desc=(document.getElementById('ccChargeDesc').value||'').trim();
      let amt=parseFloat(document.getElementById('ccChargeAmt').value||'0');
      if(!desc||isNaN(amt)||amt<=0){ alert('Description and a positive amount are required.'); return; }
      let d=loadCC(); if(!Array.isArray(d.charges)) d.charges=[];
      let manCat4=(document.getElementById('ccChargeCat').value||'').trim();
      let autoC4=(!manCat4&&typeof window.autoExpenseCategory==='function')?window.autoExpenseCategory(desc):null;
      d.charges.push({id:'chg-'+Date.now().toString(36),cardId:activeCardId,date:document.getElementById('ccChargeDate').value||todayISO(),desc:desc,amount:amt,cat:manCat4||(autoC4&&autoC4.cat)||'',sub:(autoC4&&autoC4.sub)||'',matched:false,createdAt:new Date().toISOString()});
      saveCC(d); _chargeFormOpen=false; renderMatchingPanel(activeCardId);
    });
    wireUploadZone(activeCardId);
    panel.querySelectorAll('[data-select-repay]').forEach(function(el){ el.addEventListener('click',function(e){ if(e.target && (e.target.tagName==='SELECT'||e.target.tagName==='BUTTON')) return; _selectedRepayId=el.dataset.selectRepay; renderMatchingPanel(activeCardId); }); });
    panel.querySelectorAll('[data-repay-card-id]').forEach(function(sel){ sel.addEventListener('change',function(){ let d=loadCC(), rid=this.dataset.repayCardId, r=(d.repayments||[]).find(function(x){ return x.id===rid; }); if(r){ removeCcExpenseTransactionsForRepayment(rid); r.cardId=this.value||''; (d.charges||[]).forEach(function(c){ if(c.matchedRepayId===rid){ c.matched=false; delete c.matchedRepayId; } }); saveCC(d); if(typeof window.saveState==='function') window.saveState(window.state); _selectedRepayId=rid; renderMatchingPanel(this.value||activeCardId); } }); });
    panel.querySelectorAll('[data-repay-match-id]').forEach(function(btn){ btn.addEventListener('click',function(){ let d=loadCC(); let rid=btn.dataset.repayMatchId; let rep=(d.repayments||[]).find(function(r){ return r.id===rid; }); if(rep) delete rep.manualMatched; matchPendingCharges(d); saveCC(d); _selectedRepayId=rid; refreshOverviewWidget(); renderMatchingPanel(activeCardId); }); });
    panel.querySelectorAll('[data-manual-charge-id]').forEach(function(inp){ inp.addEventListener('change',function(){ updateLiveMatchTotal(); }); });
    panel.querySelectorAll('[data-charge-cat-id]').forEach(function(sel){ sel.addEventListener('change',function(){ let cid=this.dataset.chargeCatId; let sub=panel.querySelector('[data-charge-sub-id="'+CSS.escape(cid)+'"]'); persistCcChargeAssignment(cid,this.value,sub?sub.value:''); renderMatchingPanel(activeCardId); }); });
    panel.querySelectorAll('[data-charge-sub-id]').forEach(function(sel){ sel.addEventListener('change',function(){ let cid=this.dataset.chargeSubId; let cat=panel.querySelector('[data-charge-cat-id="'+CSS.escape(cid)+'"]'); persistCcChargeAssignment(cid,cat?cat.value:'',this.value); }); });
    panel.querySelectorAll('[data-manual-save]').forEach(function(btn){ btn.addEventListener('click',function(){ applyManualRepaymentMatch(btn.dataset.manualSave); }); });
    panel.querySelectorAll('[data-manual-unmatch]').forEach(function(btn){ btn.addEventListener('click',function(){ unmatchRepayment(btn.dataset.manualUnmatch); _selectedRepayId=btn.dataset.manualUnmatch; renderMatchingPanel(activeCardId); }); });
    panel.querySelectorAll('[data-charge-id]').forEach(function(btn){ btn.addEventListener('click',function(e){ e.preventDefault(); let d=loadCC(), cid=btn.dataset.chargeId; removeCcExpenseTransactionsForCharge(cid); if(typeof window.saveState==='function') window.saveState(window.state); d.charges=(d.charges||[]).filter(function(c){ return c.id!==cid; }); recalcRepaymentSummaries(d); saveCC(d); refreshOverviewWidget(); renderMatchingPanel(activeCardId); }); });
  }

  function updateLiveMatchTotal(){
    let data=loadCC(), rep=getSelectedRepayment(data); if(!rep) return;
    let ids={}; document.querySelectorAll('[data-manual-charge-id]:checked').forEach(function(inp){ ids[inp.dataset.manualChargeId]=true; });
    let total=(data.charges||[]).reduce(function(s,c){ return ids[c.id]?s+Number(c.amount||0):s; },0);
    let diff=Number(rep.amount||0)-total;
    let el=document.getElementById('ccLiveMatchTotal');
    if(el) el.innerHTML='Selected '+ccFmt(total)+'<br><span style="color:'+(Math.abs(diff)<=Math.max(1,Number(rep.amount||0)*.02)?'#166534':'#92400e')+'">Diff '+ccFmt(diff)+'</span>';
  }

  function renderHistoryPanel(){
    syncRepaymentsFromCsvBatches();
    let data=loadCC(); let cards=data.cards||[]; let panel=document.getElementById('ccPanelHistory');
    if(!panel) return;
    document.querySelectorAll('.cc-panel').forEach(function(p){ p.classList.remove('cc-panel-active'); });
    panel.classList.add('cc-panel-active');
    let _activeMon=window.state&&window.state.activeMonth?window.state.activeMonth:null;
    let _activeParsed=_activeMon?_activeMon.match(/^(\w+)\s+(\d{4})$/):null;
    let reps=(data.repayments||[]).filter(function(r){
      if(!((r.matchedChargeCount||0)>0 || r.fullyMatched || r.partialMatch)) return false;
      if(!_activeParsed||!r.date) return true;
      let d=new Date(r.date); if(isNaN(d.getTime())) return true;
      let mNames=['January','February','March','April','May','June','July','August','September','October','November','December'];
      return mNames[d.getMonth()]===_activeParsed[1] && String(d.getFullYear())===_activeParsed[2];
    }).sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });
    let html='<div class="cc-repayment-info"><strong>Match history:</strong> every saved or auto-detected repayment match is shown here with the exact card charges linked to it.</div><div class="cc-history-list">';
    if(!reps.length){ html+='<div class="cc-empty"><div class="cc-empty-icon">📚</div>No repayment matches saved yet.</div>'; }
    reps.forEach(function(r){
      let card=cards.find(function(c){ return c.id===r.cardId; });
      let charges=(data.charges||[]).filter(function(c){ return c.matchedRepayId===r.id; }).sort(function(a,b){ return (a.date||'').localeCompare(b.date||''); });
      let total=charges.reduce(function(s,c){ return s+Number(c.amount||0); },0);
      html+='<div class="cc-history-item"><div class="cc-history-head" data-history-toggle="'+esc(r.id)+'" title="Click to show matched charges"><div class="cc-history-head-main"><div class="cc-history-title">'+esc(card?card.name:'Unassigned card')+' · '+esc(r.note||r.desc||'Bank repayment')+'</div><div class="cc-history-meta">'+esc(r.date||'')+' · '+charges.length+' charge(s) · matched '+ccFmt(total)+' of '+ccFmt(r.amount||0)+'</div></div><div class="cc-history-amount">'+ccFmt(r.amount||0)+'</div></div><div class="cc-history-detail">';
      if(!charges.length){ html+='<div class="cc-history-meta">No linked charges found.</div>'; }
      else { charges.forEach(function(c){ html+='<div class="cc-history-charge"><span class="cc-match-charge-date">'+esc(c.date||'')+'</span><span class="cc-match-charge-desc" title="'+esc(ccChargeLine(c))+'">'+esc(c.desc||'Imported charge')+'</span><strong>'+ccFmt(c.amount||0)+'</strong></div>'; }); }
      html+='<div class="cc-match-actions"><button type="button" class="cc-cancel-form-btn" data-history-unmatch="'+esc(r.id)+'">Unmatch</button><button type="button" class="cc-toolbar-btn cc-secondary" data-history-edit="'+esc(r.id)+'">Edit match</button></div></div></div>';
    });
    html+='</div>'; panel.innerHTML=html;
    panel.querySelectorAll('[data-history-toggle]').forEach(function(head){ head.addEventListener('click',function(){ let item=head.closest('.cc-history-item'); if(item) item.classList.toggle('is-expanded'); }); });
    panel.querySelectorAll('[data-history-edit]').forEach(function(btn){ btn.addEventListener('click',function(){ let d=loadCC(), rid=btn.dataset.historyEdit, r=(d.repayments||[]).find(function(x){ return x.id===rid; }); if(r){ r.matchSaved=false; saveCC(d); } _selectedRepayId=rid; _activeTab='matching'; document.querySelectorAll('.cc-tab').forEach(function(t){ t.classList.toggle('cc-active',t.dataset.ccTab==='matching'); }); renderMatchingPanel(); }); });
    panel.querySelectorAll('[data-history-unmatch]').forEach(function(btn){ btn.addEventListener('click',function(){ unmatchRepayment(btn.dataset.historyUnmatch); renderHistoryPanel(); }); });
  }

  /* ── Repayments panel ── */
  function renderRepaymentsPanel(){
    syncRepaymentsFromCsvBatches();
    let data=loadCC(); let cards=data.cards||[];
    let repayments=data.repayments||[];
    let panel=document.getElementById('ccPanelRepayments');
    if(!panel) return;
    document.querySelectorAll('.cc-panel').forEach(function(p){ p.classList.remove('cc-panel-active'); });
    panel.classList.add('cc-panel-active');

    let html='<div class="cc-repayment-info">';
    html+='<strong>How repayments work:</strong> When your bank account shows a bulk payment to the credit card company ';
    html+='(e.g. <em>"UW TERUGBETALING FLEX BUDGET"</em>), record it here. It will not count as a budget expense. ';
    html+='The system will then auto-match it to your logged charges — matched charges become executed expenses, ';
    html+='unmatched ones remain pending (the money is still on your current account).';
    html+='</div>';

    // Record repayment form
    html+='<div class="cc-charge-form" id="ccRepayForm">';
    html+='<div style="font-size:.78rem;font-weight:800;color:var(--accent-text);margin-bottom:8px;">Record a bank repayment</div>';
    html+='<div class="cc-form-row">';
    if(cards.length>0){
      let cardOpts=cards.map(function(c){ return '<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>'; }).join('');
      html+='<div class="cc-form-field"><label>Card repaid *</label><select class="cc-form-input" id="ccRepayCard">'+cardOpts+'</select></div>';
    }
    html+='<div class="cc-form-field" style="max-width:150px"><label>Date</label><input class="cc-form-input" id="ccRepayDate" type="date" value="'+todayISO()+'"/></div>';
    html+='<div class="cc-form-field" style="max-width:140px"><label>Amount (€) *</label><input class="cc-form-input" id="ccRepayAmt" placeholder="0.00" type="number" step="0.01" min="0"/></div>';
    html+='<div class="cc-form-field"><label>Reference</label><input class="cc-form-input" id="ccRepayNote" placeholder="e.g. UW TERUGBETALING…" type="text"/></div>';
    html+='</div>';
    html+='<div class="cc-form-btns"><button class="cc-save-btn" id="ccSaveRepayBtn" type="button">Save &amp; auto-match</button></div>';
    html+='</div>';

    // Repayment list
    html+='<div class="cc-repayment-list" id="ccRepayList">';
    if(!repayments.length){
      html+='<div class="cc-empty" style="padding:16px 0"><div class="cc-empty-icon">🏦</div>No repayments recorded yet.</div>';
    } else {
      repayments.slice().sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); }).forEach(function(r){
        let card=cards.find(function(c){ return c.id===r.cardId; });
        let matchInfo=r.fullyMatched?'✓ Fully matched ('+r.matchedChargeCount+' charges)':(r.partialMatch?'⚠ Partial match':'◌ Unmatched');
        html+='<div class="cc-repayment-row">';
        html+='<div class="cc-repayment-date">'+esc(r.date||'')+'</div>';
        html+='<div class="cc-repayment-desc"><span class="cc-repay-marker">CC Repayment</span> '+(card?esc(card.name):'<span style="color:#92400e;font-weight:700">Assign card</span>')+(r.note?' · '+esc(r.note):'')+'<br><span style="font-size:.63rem;color:var(--muted)">'+esc(matchInfo)+(r.source==='bank-csv'?' · imported from bank CSV':'')+'</span></div>';
        html+='<div class="cc-repayment-amt">€'+parseFloat(r.amount||0).toFixed(2)+'</div>';
        html+='<div class="cc-repayment-actions">';
        if(cards.length){
          html+='<select class="cc-repay-card-select" data-repay-card-id="'+esc(r.id)+'">';
          html+='<option value=""'+(!r.cardId?' selected':'')+'>Select card…</option>';
          cards.forEach(function(c){ html+='<option value="'+esc(c.id)+'"'+(r.cardId===c.id?' selected':'')+'>'+esc(c.name)+'</option>'; });
          html+='</select>';
        }
        html+='<button data-repay-match-id="'+esc(r.id)+'" type="button">Auto-match</button>';
        html+='<button class="cc-charge-del" data-repay-id="'+esc(r.id)+'" title="Delete" type="button">✕</button>';
        html+='</div>';
        html+='</div>';
        html+=buildRepaymentMatchDetails(r,data,cards);
      });
    }
    html+='</div>';
    panel.innerHTML=html;

    let sv=document.getElementById('ccSaveRepayBtn');
    if(sv) sv.addEventListener('click',function(){
      let amt=parseFloat(document.getElementById('ccRepayAmt').value||'0');
      if(isNaN(amt)||amt<=0){ alert('Please enter a positive repayment amount.'); return; }
      let d=loadCC(); if(!Array.isArray(d.repayments)) d.repayments=[];
      let cSel=document.getElementById('ccRepayCard');
      d.repayments.push({id:'rep-'+Date.now().toString(36),
        cardId:cSel?cSel.value:'',
        date:document.getElementById('ccRepayDate').value||todayISO(),
        amount:amt,
        note:(document.getElementById('ccRepayNote').value||'').trim(),
        createdAt:new Date().toISOString()});
      // Run matching immediately
      matchPendingCharges(d);
      saveCC(d);
      refreshOverviewWidget();
      renderMatchingPanel();
      // Show match result
      setTimeout(function(){
        let d2=loadCC();
        let latest=d2.repayments[d2.repayments.length-1];
        if(latest&&latest.fullyMatched){
          let box=document.createElement('div');
          box.className='cc-match-result matched';
          box.textContent='✓ Fully matched to '+latest.matchedChargeCount+' charges.';
          let list=document.getElementById('ccRepayList');
          if(list) list.insertBefore(box,list.firstChild);
        } else if(latest&&latest.partialMatch){
          let box2=document.createElement('div');
          box2.className='cc-match-result partial';
          box2.textContent='⚠ Partial match — some charges remain pending.';
          let list2=document.getElementById('ccRepayList');
          if(list2) list2.insertBefore(box2,list2.firstChild);
        }
      },100);
    });

    panel.querySelectorAll('[data-repay-card-id]').forEach(function(sel){
      sel.addEventListener('change',function(){
        let d=loadCC(); let rid=this.dataset.repayCardId; let r=(d.repayments||[]).find(function(x){ return x.id===rid; });
        if(r){ r.cardId=this.value||''; (d.charges||[]).forEach(function(c){ if(c.matchedRepayId===rid){ c.matched=false; delete c.matchedRepayId; } }); matchPendingCharges(d); saveCC(d); refreshOverviewWidget(); renderMatchingPanel(); }
      });
    });

    panel.querySelectorAll('[data-repay-match-id]').forEach(function(btn){
      btn.addEventListener('click',function(){
        let d=loadCC();
        let rid=btn.dataset.repayMatchId;
        let rep=(d.repayments||[]).find(function(r){ return r.id===rid; });
        if(rep) delete rep.manualMatched;
        matchPendingCharges(d); saveCC(d); refreshOverviewWidget(); renderMatchingPanel();
      });
    });

    panel.querySelectorAll('[data-manual-save]').forEach(function(btn){
      btn.addEventListener('click',function(){ applyManualRepaymentMatch(btn.dataset.manualSave); });
    });
    panel.querySelectorAll('[data-manual-unmatch]').forEach(function(btn){
      btn.addEventListener('click',function(){ unmatchRepayment(btn.dataset.manualUnmatch); });
    });

    panel.querySelectorAll('[data-repay-id]').forEach(function(btn){
      btn.addEventListener('click',function(){
        let d=loadCC(); let rid=btn.dataset.repayId;
        // Also unmatch charges that were matched to this repayment
        (d.charges||[]).forEach(function(c){ if(c.matchedRepayId===rid){ c.matched=false; delete c.matchedRepayId; } });
        d.repayments=(d.repayments||[]).filter(function(r){ return r.id!==rid; });
        saveCC(d); refreshOverviewWidget(); renderMatchingPanel();
      });
    });

    if(!cards.length){
      let note=document.createElement('div'); note.className='cc-repayment-info'; note.style.marginTop='10px';
      note.innerHTML='Add a card on <strong>My Cards</strong> first.';
      panel.appendChild(note);
    }
  }

  /* ── Auto-detect patterns panel ── */
  function renderPatternsPanel(){
    let panel=document.getElementById('ccPanelPatterns');
    if(!panel) return;
    document.querySelectorAll('.cc-panel').forEach(function(p){ p.classList.remove('cc-panel-active'); });
    panel.classList.add('cc-panel-active');

    let patterns=loadPatterns();
    let html='<div class="cc-repayment-info">';
    html+='<strong>How pattern auto-detection works:</strong> When you flag a CSV row as "CC Repayment" during a bank import, ';
    html+='Veyra learns the transaction description as a pattern. Future CSV imports with matching descriptions are ';
    html+='<strong>automatically flagged</strong> as CC Repayments — no manual selection needed. ';
    html+='You can also add patterns manually below (e.g. paste in "UW TERUGBETALING FLEX BUDGET").';
    html+='</div>';

    html+='<div class="cc-pattern-strip">';
    html+='<div style="font-size:.72rem;font-weight:700;width:100%;margin-bottom:4px;">Learned patterns</div>';
    if(!patterns.length){
      html+='<div style="font-size:.72rem;color:var(--muted);font-style:italic;">No patterns learned yet. Flag a CSV row as CC Repayment or add one below.</div>';
    } else {
      patterns.forEach(function(p,i){
        html+='<span class="cc-pattern-tag">'+esc(p)+'<button class="cc-pattern-tag-del" data-pat-idx="'+i+'" title="Remove" type="button">✕</button></span>';
      });
    }
    html+='<div class="cc-pattern-add-row">';
    html+='<input class="cc-pattern-input" id="ccPatternInput" placeholder="e.g. UW TERUGBETALING FLEX BUDGET" type="text"/>';
    html+='<button class="cc-pattern-add-btn" id="ccPatternAddBtn" type="button">+ Add pattern</button>';
    html+='</div>';
    html+='</div>';

    // Test section
    html+='<div style="margin-top:16px;font-size:.76rem;font-weight:700;color:var(--accent-text);margin-bottom:6px;">Test a description</div>';
    html+='<div class="cc-form-row" style="gap:8px;">';
    html+='<input class="cc-form-input" id="ccPatternTest" placeholder="Paste a transaction description to test" type="text" style="flex:1"/>';
    html+='<button class="cc-toolbar-btn cc-secondary" id="ccPatternTestBtn" type="button">Test</button>';
    html+='</div>';
    html+='<div id="ccPatternTestResult" style="margin-top:8px;font-size:.73rem;"></div>';

    panel.innerHTML=html;

    // Delete pattern
    panel.querySelectorAll('.cc-pattern-tag-del').forEach(function(btn){
      btn.addEventListener('click',function(){
        let p=loadPatterns(); p.splice(+btn.dataset.patIdx,1); savePatterns(p); renderPatternsPanel();
      });
    });

    // Add pattern
    document.getElementById('ccPatternAddBtn').addEventListener('click',function(){
      let val=(document.getElementById('ccPatternInput').value||'').trim().toLowerCase();
      if(!val) return;
      let p=loadPatterns();
      if(!p.includes(val)){ p.push(val); savePatterns(p); }
      renderPatternsPanel();
    });
    document.getElementById('ccPatternInput').addEventListener('keydown',function(e){
      if(e.key==='Enter') document.getElementById('ccPatternAddBtn').click();
    });

    // Test
    document.getElementById('ccPatternTestBtn').addEventListener('click',function(){
      let desc=document.getElementById('ccPatternTest').value||'';
      let result=document.getElementById('ccPatternTestResult');
      if(!result) return;
      if(isRepaymentDesc(desc)){
        result.innerHTML='<span style="color:#065f46;font-weight:700">✓ Matches a pattern — would be auto-flagged as CC Repayment</span>';
      } else {
        result.innerHTML='<span style="color:#475569">✗ No match — would not be auto-flagged</span>';
      }
    });
  }

  /* ═══════════════════════════════════════════════════════════
     OVERVIEW WIDGET
     ═══════════════════════════════════════════════════════════ */
  function injectOverviewWidget(){
    if(document.getElementById('ccOverviewWidget')) return;
    let anchor=document.querySelector('.ov-hero')||document.getElementById('finStateBanner');
    if(!anchor) return;
    let widget=document.createElement('div');
    widget.className='cc-overview-widget'; widget.id='ccOverviewWidget';
    anchor.parentNode.insertBefore(widget,anchor.nextSibling);
    refreshOverviewWidget();
  }

  function refreshOverviewWidget(){
    let widget=document.getElementById('ccOverviewWidget');
    if(!widget) return;
    let data=loadCC(); let cards=data.cards||[];
    if(!cards.length){ widget.innerHTML=''; return; }

    let totalExec=0,totalPend=0;
    let rows=cards.map(function(c){
      let exec=cardExecuted(c.id,data);
      let total=cardBalance(c.id,data);
      let pend=total-exec;
      totalExec+=exec; totalPend+=pend;
      return {card:c,exec:exec,pend:pend,total:total};
    }).filter(function(r){ return r.total>0; });

    if(!rows.length){ widget.innerHTML=''; return; }
    let fmt=function(v){ return '€'+v.toFixed(2); };
    let html='<div class="cc-overview-inner">';
    html+='<div class="cc-overview-head"><span class="cc-overview-head-label">💳 Credit Card (this month)</span>';
    html+='<span class="cc-overview-head-total">'+fmt(totalExec+totalPend)+'</span></div>';
    html+='<div class="cc-overview-rows">';
    rows.forEach(function(r){
      html+='<div class="cc-overview-row">';
      html+='<div class="cc-overview-swatch" style="background:'+esc(r.card.color||'#2563eb')+'"></div>';
      html+='<div class="cc-overview-row-name">'+esc(r.card.name)+'</div>';
      if(r.exec>0) html+='<span class="cc-overview-row-amt amt-executed" title="Matched & executed">'+fmt(r.exec)+'</span>';
      if(r.pend>0) html+='<span class="cc-overview-row-amt amt-pending" title="Pending — not yet repaid from bank">'+fmt(r.pend)+' pending</span>';
      html+='</div>';
    });
    html+='</div>';
    html+='<button class="cc-overview-open-btn" id="ccOverviewOpenBtn" type="button">Manage credit cards →</button>';
    html+='</div>';
    widget.innerHTML=html;
    let btn=document.getElementById('ccOverviewOpenBtn');
    if(btn) btn.addEventListener('click',function(){ openCC(); });
  }

  /* ═══════════════════════════════════════════════════════════
     UTILS
     ═══════════════════════════════════════════════════════════ */
  function esc(v){ return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function todayISO(){ let d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function normalizeImportText(value,fallback){ let clean=String(value==null?'':value).replace(/\s+/g,' ').trim(); return clean || fallback || ''; }

})();

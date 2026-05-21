(function() {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────
  let LEARN_KEY   = 'veyra_csvMerchantMap_v1';
  let MAPPING_KEY = 'veyra_csvColumnMap_v1';
  let MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  // ── Merchant auto-categorisation rules ────────────────────────────────────
  let MERCHANT_RULES = [
    { p:/carrefour|louis delhaize|delhaize|lidl|aldi|colruyt|bio-planet|okay|super gb|spar|match|proxy|albert heijn|jumbo|tesco|sainsbury|edeka|rewe|kaufland|intermarche/i, cat:'Groceries', sub:'Groceries' },
    { p:/huur|loyer|rent|mortgage|hypotheek|syndic/i, cat:'Housing', sub:'Rent / Mortgage' },
    { p:/electricite|electricity|stroom|eandis|engie|fluvius|luminus|vattenfall|eon|gas\s|nutsvoorzienin/i, cat:'Housing', sub:'Utilities' },
    { p:/verzekering|assurance|insurance|ag insurance|ethias|axa|allianz|belfius assur|vnab/i, cat:'Housing', sub:'Insurance' },
    { p:/proximus|telenet|orange be|base\s|voo\s|sfr|bouygues|free mobile|t-mobile|vodafone|o2\s/i, cat:'Connectivity', sub:'Mobile' },
    { p:/netflix|prime video|disney|apple tv|hbo|viaplay|streamz|spotify|deezer|youtube premium|canal\+/i, cat:'Connectivity', sub:'TV' },
    { p:/internet\s|broadband|fiber|fibre/i, cat:'Connectivity', sub:'Internet' },
    { p:/pharmacy|apotheek|pharmacie|huisarts|dokter|medic|tandarts|dentist|ziekenfonds|mutualite|cm\s|ziekenhuis|hospital|kine|osteo/i, cat:'Health', sub:'Health' },
    { p:/stib|nmbs|sncb|de lijn|tec|mivb|trein|train|tram\s|metro|bus\s|interparking|q-park|parking|villo|swapfiets|cambio|flixbus|eurostar|thalys|ryanair|brussels airlines/i, cat:'Leisure', sub:'Transport' },
    { p:/restaurant|brasserie|bistro|pizza|burger|mcdonalds|quick\s|kfc|subway|delizio|sushi|thai|chinese|eetcafe|frituur|friterie|bottega|meander|ssp pr|midi\s|tavern/i, cat:'Leisure', sub:'Eating Out' },
    { p:/amazon|zalando|zara|h&m|primark|coolblue|bol\.com|ikea|fnac|mediamarkt|decathlon|bloemenrijk|asos|ebay/i, cat:'Leisure', sub:'Shopping' },
    { p:/tax|belasting|impot|sepa|transfer|virement|overschrijving|storting/i, cat:'Financial', sub:'Financial' },
  ];

  // Income name-pattern hints (for auto-categorising credit rows)
  let INCOME_HINTS = /salary|salaris|loon|wages|payroll|freelance|dividend|rente|interest|huur ontvangen|rental income/i;

  // ── Helpers ────────────────────────────────────────────────────────────────
  function esc(v){ return String(v==null?'':v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function normMerchant(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim().slice(0,40); }
  function loadMerchantMap(){  try{let r=localStorage.getItem(LEARN_KEY);  return r?JSON.parse(r):{};} catch(e){return{};} }
  function saveMerchantMap(m){ try{localStorage.setItem(LEARN_KEY,  JSON.stringify(m));}catch(e){} }
  function loadMappingStore(){ try{let r=localStorage.getItem(MAPPING_KEY);return r?JSON.parse(r):{};} catch(e){return{};} }
  function saveMappingStore(m){ try{localStorage.setItem(MAPPING_KEY,JSON.stringify(m));}catch(e){} }

  function autoExpenseCategory(desc){
    let learned=loadMerchantMap(), norm=normMerchant(desc);
    for(let k in learned){ if(k.length>=4&&norm.indexOf(k)>=0) return learned[k]; }
    for(let i=0;i<MERCHANT_RULES.length;i++){ if(MERCHANT_RULES[i].p.test(desc)) return {cat:MERCHANT_RULES[i].cat,sub:MERCHANT_RULES[i].sub}; }
    return null;
  }
  function learnMerchant(desc,cat,sub){
    let norm=normMerchant(desc); if(!norm||norm.length<4) return;
    let map=loadMerchantMap(); map[norm]={cat:cat,sub:sub};
    let keys=Object.keys(map); if(keys.length>500) delete map[keys[0]];
    saveMerchantMap(map);
  }

  // ── Date helpers ───────────────────────────────────────────────────────────
  function parseDate(s){
    if(!s) return null; s=s.trim(); let m;
    if((m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return new Date(+m[3],+m[2]-1,+m[1]);
    if((m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)))   return new Date(+m[1],+m[2]-1,+m[3]);
    if((m=s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)))   return new Date(+m[3],+m[2]-1,+m[1]);
    if((m=s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/))) return new Date(+m[3],+m[2]-1,+m[1]);
    if((m=s.match(/^(\d{4})(\d{2})(\d{2})$/)))          return new Date(+m[1],+m[2]-1,+m[3]);
    if((m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/))){ let yr=+m[3]; return new Date(yr<50?2000+yr:1900+yr,+m[2]-1,+m[1]); }
    let d=new Date(s); return isNaN(d.getTime())?null:d;
  }
  function monthNameFromDate(d){ return MONTH_NAMES[d.getMonth()]+' '+d.getFullYear(); }
  function dateStampFromDate(d){ return d.toLocaleDateString('en-BE',{year:'numeric',month:'short',day:'2-digit'}); }

  // ── Amount parsing ─────────────────────────────────────────────────────────
  function parseAmount(s){
    if(s===null||s===undefined) return NaN;
    s=String(s).trim();
    if(!s) return NaN;

    // Bank CSV exports can contain malformed decimal quoting, especially in
    // semicolon-separated Belgian/KBC files, e.g. 3127",23 or 3127,"23.
    // Strip quote artifacts before decimal detection so income keeps cents too.
    s=s.replace(/["'`´’]/g,'');
    s=s.replace(/[€$£\s]/g,'').trim();
    if(!s) return NaN;

    if(/^\(.*\)$/.test(s)) s='-'+s.slice(1,-1);
    if(s.indexOf(',')>-1&&s.indexOf('.')>-1){
      let li=s.lastIndexOf(','),ld=s.lastIndexOf('.');
      if(li>ld) s=s.replace(/\./g,'').replace(',','.');
      else       s=s.replace(/,/g,'');
    } else if(s.indexOf(',')>-1){
      let parts=s.split(',');
      if(parts.length===2&&parts[1].length<=2) s=s.replace(',','.');
      else s=s.replace(/,/g,'');
    }
    return parseFloat(s);
  }

  // ── Separator detection (counts, not positions) ────────────────────────────
  function detectSeparator(line){
    let sc=0,cc=0,inQ=false;
    for(let i=0;i<line.length;i++){
      if(line[i]==='"'){inQ=!inQ;continue;}
      if(inQ) continue;
      if(line[i]===';') sc++;
      else if(line[i]===',') cc++;
    }
    return sc>=cc?';':',';
  }

  // ── CSV line splitter ──────────────────────────────────────────────────────
  function splitLine(line,sep){
    let fields=[],cur='',inQ=false;
    for(let i=0;i<line.length;i++){
      let ch=line[i];
      if(ch==='"'){if(inQ&&line[i+1]==='"'){cur+='"';i++;}else inQ=!inQ;}
      else if(ch===sep&&!inQ){fields.push(cur.trim());cur='';}
      else cur+=ch;
    }
    fields.push(cur.trim()); return fields;
  }

  // ── KBC-specific detection & parsing ──────────────────────────────────────
  function isKBC(cols){
    let h=cols.map(function(c){return c.toLowerCase().replace(/[^a-z]/g,'');});
    return h.indexOf('datum')>=0&&h.indexOf('bedrag')>=0&&h.indexOf('debet')>=0;
  }
  function parseKBCRow(rawLine,ci){
    let line=rawLine.replace(/^"/,''), parts=line.split(';');
    let dateStr=(parts[ci.datum]||'').trim();
    let descRaw=(parts[ci.omschrijving]||'').replace(/^"+|"+$/g,'').trim();
    let m=descRaw.match(/UUR\s+(.+?)\s+(?:BE|NL|FR|LU|DE|GB)\d{4}/);
    if(!m) m=descRaw.match(/UUR\s+(.+?)\s+MET\s+KBC/i);
    let desc=m?m[1].trim():descRaw.slice(0,60);
    // For KBC: Debet = expenses (negative), Credit = income (positive)
    let debitStr=(parts[ci.debet]||'').trim();
    let creditStr=(parts[ci.credit]||'').trim();
    let amount=NaN;
    if(debitStr) amount=-Math.abs(parseAmount(debitStr));
    if((isNaN(amount)||amount===0)&&creditStr) amount=Math.abs(parseAmount(creditStr));
    return {dateStr:dateStr,desc:desc,amount:amount};
  }

  // ── Column scoring (generic formats) ──────────────────────────────────────
  function scoreColumns(headerCols,dataRows){
    let h=headerCols.map(function(c){return c.toLowerCase().replace(/[^a-z0-9]/g,'');});
    let n=headerCols.length;
    let sc={date:[],desc:[],amount:[],credit:[],debit:[]};
    let dateN=/^(date|datum|valuedate|transactiondate|bookdate|boekdatum|date_operation|date_valeur|buchungstag|wertstellung)$/;
    let descN=/^(desc|description|merchant|libelle|label|naam|name|mededelingen|communication|detail|omschrijving|verwendungszweck|buchungstext|payee|reference|details)$/;
    let amtN=/^(amount|bedrag|montant|betrag|amount_eur|transactionamount)$/;
    let crN=/^(credit|crediet|inkomst|gutschrift|haben|credit_amount|credits|in)$/;
    let dbN=/^(debit|debiet|uitgave|lastschrift|soll|debit_amount|debits|out)$/;
    for(let i=0;i<n;i++){
      sc.date.push(dateN.test(h[i])?10:0); sc.desc.push(descN.test(h[i])?10:0);
      sc.amount.push(amtN.test(h[i])?10:0); sc.credit.push(crN.test(h[i])?10:0); sc.debit.push(dbN.test(h[i])?10:0);
    }
    dataRows.slice(0,5).forEach(function(row){
      for(let i=0;i<n;i++){
        let v=(row[i]||'').trim();
        if(parseDate(v)) sc.date[i]=(sc.date[i]||0)+3;
        let a=parseAmount(v);
        if(!isNaN(a)&&v.length>0&&v.length<15){
          if(a<0){sc.amount[i]=(sc.amount[i]||0)+2;sc.debit[i]=(sc.debit[i]||0)+2;}
          else if(a>0){sc.amount[i]=(sc.amount[i]||0)+1;sc.credit[i]=(sc.credit[i]||0)+1;}
        }
        if(v.length>8&&/\s/.test(v)) sc.desc[i]=(sc.desc[i]||0)+2;
      }
    });
    function best(arr,excl){
      let bi=-1,bv=-1;
      for(let i=0;i<arr.length;i++){if(excl&&excl.indexOf(i)>=0)continue;if(arr[i]>bv){bv=arr[i];bi=i;}}
      return bv>0?bi:-1;
    }
    let di=best(sc.date,[]),dsi=best(sc.desc,[di]),ai=best(sc.amount,[di,dsi]),cri=best(sc.credit,[di,dsi,ai]),dbi=best(sc.debit,[di,dsi,ai,cri]);
    return {date:di,desc:dsi,amount:ai,credit:cri,debit:dbi,
            confidence:Math.min(10,(sc.date[di]||0)/2+(sc.desc[dsi]||0)/2+Math.max(sc.amount[ai]||0,(sc.credit[cri]||0)+(sc.debit[dbi]||0))/2)};
  }

  function fileSignature(cols){ return cols.slice(0,8).join('|').toLowerCase().slice(0,80); }

  // ── Build transaction list from rows + column map ──────────────────────────
  function buildTransactions(dataRows,colMap){
    let txs=[];
    dataRows.forEach(function(row){
      let dateStr=(colMap.date>=0&&row[colMap.date])||'';
      let desc=String((colMap.desc>=0&&row[colMap.desc])||'').trim();
      let amt=NaN;
      if(colMap.amount>=0&&row[colMap.amount]!==undefined) amt=parseAmount(row[colMap.amount]);
      if(isNaN(amt)){
        let cr=colMap.credit>=0?parseAmount(row[colMap.credit]):NaN;
        let db=colMap.debit>=0?parseAmount(row[colMap.debit]):NaN;
        if(!isNaN(db)&&db!==0) amt=-Math.abs(db);
        else if(!isNaN(cr)&&cr!==0) amt=Math.abs(cr);
      }
      let d=parseDate(dateStr);
      if(!d||isNaN(amt)||Math.abs(amt)<0.001) return;
      txs.push({dateObj:d,monthName:monthNameFromDate(d),dateStamp:dateStampFromDate(d),
                desc:desc||'(no description)',amount:amt,isExpense:amt<0});
    });
    return txs;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN PARSE ENTRY
  // ═══════════════════════════════════════════════════════════════════════════
  let _parsed=null;

  function parseCSVText(text){
    let lines=text.split(/\r?\n/).filter(function(l){return l.trim();});
    if(lines.length<2) return {error:'File has fewer than 2 rows.'};
    let sep=detectSeparator(lines[0]+'\n'+(lines[1]||''));
    let headerLine=lines[0].replace(/^\uFEFF/,'');
    let headerCols=splitLine(headerLine,sep).map(function(c){return c.replace(/"/g,'').trim();});

    // ── KBC ──
    if(isKBC(headerCols)){
      let ci={};
      headerCols.forEach(function(c,i){ci[c.toLowerCase().trim()]=i;});
      let kbcMap={datum:ci['datum']!==undefined?ci['datum']:5,omschrijving:ci['omschrijving']!==undefined?ci['omschrijving']:6,debet:ci['debet']!==undefined?ci['debet']:11,credit:ci['credit']!==undefined?ci['credit']:10};
      let txs=[];
      for(let i=1;i<lines.length;i++){
        if(!lines[i].trim()) continue;
        let p=parseKBCRow(lines[i],kbcMap);
        let d=parseDate(p.dateStr);
        if(!d||isNaN(p.amount)||Math.abs(p.amount)<0.001) continue;
        txs.push({dateObj:d,monthName:monthNameFromDate(d),dateStamp:dateStampFromDate(d),desc:p.desc||'(no description)',amount:p.amount,isExpense:p.amount<0});
      }
      if(!txs.length) return {error:'KBC format detected but no valid transactions found.'};
      _parsed={transactions:txs,headerCols:headerCols,dataRows:[],sep:sep,format:'KBC Belgium',colMap:kbcMap,confidence:10};
      return {ok:true};
    }

    // ── Generic ──
    let dataRows=[];
    for(let j=1;j<lines.length;j++){
      let row=splitLine(lines[j],sep);
      if(row.length>=2&&row.some(function(c){return c.trim();})) dataRows.push(row);
    }
    if(!dataRows.length) return {error:'No data rows found after the header.'};

    // Two-line header detection
    let r0=dataRows[0], hasDate=r0.some(function(c){return !!parseDate(c);}), hasAmt=r0.some(function(c){let a=parseAmount(c);return !isNaN(a)&&Math.abs(a)>0;});
    if(!hasDate&&!hasAmt&&dataRows.length>1){
      headerCols=dataRows[0].map(function(c){return c.replace(/"/g,'').trim();});
      dataRows=dataRows.slice(1);
    }

    let sig=fileSignature(headerCols);
    let saved=loadMappingStore();
    let colMap=saved[sig]||scoreColumns(headerCols,dataRows);
    let txs2=buildTransactions(dataRows,colMap);
    _parsed={transactions:txs2,headerCols:headerCols,dataRows:dataRows,sep:sep,format:'Standard CSV',colMap:colMap,confidence:colMap.confidence!==undefined?colMap.confidence:5,sig:sig};
    return {ok:true};
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COLUMN MAPPING UI (shown when confidence < 6)
  // ═══════════════════════════════════════════════════════════════════════════
  function buildMappingUI(){
    let p=_parsed; if(!p) return;
    let cols=p.headerCols, preview=p.dataRows.slice(0,3), cm=p.colMap;
    function optFor(role,cur){
      let html='<option value="-1">— Not present —</option>';
      cols.forEach(function(c,i){html+='<option value="'+i+'"'+(i===cur?' selected':'')+'>['+ i+'] '+esc(c)+'</option>';});
      return html;
    }
    let html='<div class="csv-mapping-ui">';
    html+='<div class="csv-mapping-banner"><span class="csv-mapping-icon">🗺️</span><div>';
    html+='<div class="csv-mapping-title">Column mapping needed</div>';
    html+='<div class="csv-mapping-sub">We couldn\'t confidently detect all columns (confidence: '+Math.round(p.confidence*10)+'%). Tell us which column contains each field.</div>';
    html+='</div></div><div class="csv-mapping-grid">';
    [{key:'date',label:'📅 Date',req:true,help:'Transaction date (e.g. 10/05/2025)'},{key:'desc',label:'🏷️ Description',req:true,help:'Merchant name or description'},{key:'amount',label:'💶 Amount',req:false,help:'Single column with +/− amounts'},{key:'debit',label:'➖ Debit / Out',req:false,help:'Money leaving (positive number)'},{key:'credit',label:'➕ Credit / In',req:false,help:'Money coming in (positive number)'}].forEach(function(r){
      html+='<div class="csv-mapping-row"><div class="csv-mapping-label">'+(r.req?'<span class="csv-req">*</span> ':'')+r.label+'<span class="csv-mapping-help">'+r.help+'</span></div>';
      html+='<select class="csv-map-sel" data-role="'+r.key+'">'+optFor(r.key,cm[r.key]!=null?cm[r.key]:-1)+'</select></div>';
    });
    html+='</div>';
    if(preview.length){
      html+='<div class="csv-mapping-preview-label">Preview (first 3 rows):</div>';
      html+='<div class="csv-review-table-wrap" style="margin-top:6px;"><table class="csv-review-table"><thead><tr>';
      cols.forEach(function(c,i){html+='<th>['+i+'] '+esc(c)+'</th>';});
      html+='</tr></thead><tbody>';
      preview.forEach(function(row){html+='<tr>';cols.forEach(function(c,i){html+='<td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+esc((row[i]||'').slice(0,30))+'</td>';});html+='</tr>';});
      html+='</tbody></table></div>';
    }
    html+='<div class="csv-mapping-actions"><button class="csv-map-apply-btn" id="csvMapApply" type="button">Apply mapping &amp; preview →</button>';
    html+='<label class="csv-map-save-label"><input type="checkbox" id="csvMapSave" checked> Remember this mapping for future imports from this bank</label></div></div>';
    document.getElementById('csvImportBody').innerHTML=html;
    document.getElementById('csvImportCommit').disabled=true;
    document.getElementById('csvImportMsg').textContent='Set column mapping, then click Apply.';
    document.getElementById('csvMapApply').addEventListener('click',function(){
      let nm={confidence:10};
      document.querySelectorAll('.csv-map-sel').forEach(function(s){nm[s.dataset.role]=parseInt(s.value,10);});
      if(nm.date<0){alert('Please select the Date column.');return;}
      if(nm.desc<0){alert('Please select the Description column.');return;}
      if(nm.amount<0&&nm.debit<0&&nm.credit<0){alert('Please select at least one amount column (Amount, Debit, or Credit).');return;}
      if(document.getElementById('csvMapSave')&&document.getElementById('csvMapSave').checked&&_parsed.sig){
        let store=loadMappingStore(); store[_parsed.sig]=nm; saveMappingStore(store);
      }
      _parsed.colMap=nm; _parsed.transactions=buildTransactions(_parsed.dataRows,nm); _parsed.format='Custom mapping';
      if(!_parsed.transactions.length){alert('No valid transactions found with this mapping. Check Date and Amount columns.');return;}
      pendingTxs=[];
      buildReviewUI();
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REVIEW UI — expenses, income, and reimbursements
  // ═══════════════════════════════════════════════════════════════════════════
  let pendingTxs=[];
  let editBatchId=null;
  let editBatchMeta=null;

  // CADENCE options matching the dashboard's existing cadenceHint values
  let CADENCE_OPTS=[
    {val:'learn',    label:'Learn from pattern'},
    {val:'oneoff',   label:'One-off'},
    {val:'monthly',  label:'Monthly'},
    {val:'semimonthly',label:'Twice monthly'},
  ];

  // Credit row type options
  let CREDIT_TYPES=[
    {val:'skip',        label:'Skip (ignore)'},
    {val:'income',      label:'Income'},
    {val:'reimburse',   label:'Reimbursement → offset expense'},
    {val:'shared-expense-settlement', label:'Shared Expenses Settlement'},
  ];


  function deepClone(value){
    try{return JSON.parse(JSON.stringify(value));}catch(e){return value;}
  }
  function makeCsvId(prefix){
    return prefix+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9);
  }
  function ensureCsvBatches(){
    let st=window.state;
    if(!st) return [];
    if(!Array.isArray(st.csvImportBatches)) st.csvImportBatches=[];
    return st.csvImportBatches;
  }
  function getCsvBatches(){
    let st=window.state;
    return (st&&Array.isArray(st.csvImportBatches))?st.csvImportBatches:[];
  }
  function findCsvBatch(id){
    return getCsvBatches().find(function(b){return b&&b.id===id;})||null;
  }
  function serializeImportEntry(entry){
    return {
      id:entry.id||makeCsvId('csventry'),
      tx:deepClone(entry.tx),
      isCredit:!!entry.isCredit,
      creditType:entry.creditType||'',
      targetType:entry.targetType||(entry.isCredit?'credit':'expense'),
      incomeGroup:entry.incomeGroup||'Primary Income',
      incomeSub:entry.incomeSub||'',
      savingsGroup:entry.savingsGroup||'',
      savingsSub:entry.savingsSub||'',
      cat:entry.cat||'',
      sub:entry.sub||'',
      cadence:entry.cadence||'learn',
      skip:!!entry.skip,
      autoCat:!!entry.autoCat,
      isDup:!!entry.isDup,
      kind:entry.kind||'',
      sharedExpenseSettled:Number(entry.sharedExpenseSettled||0),
      sharedExpenseUnmatched:Number(entry.sharedExpenseUnmatched||0)
    };
  }
  function restorePendingFromBatch(batch){
    pendingTxs=(batch.entries||[]).map(function(e){return serializeImportEntry(e);});
    editBatchId=batch.id;
    editBatchMeta={title:batch.title||batch.format||'Imported CSV',format:batch.format||'Imported CSV',createdAt:batch.createdAt||'',updatedAt:batch.updatedAt||'',total:pendingTxs.length,accountId:batch.accountId||'',accountName:batch.accountName||''};
    if(typeof window!=='undefined' && 'CURRENT_IMPORT_ACCOUNT' in window){
      window.CURRENT_IMPORT_ACCOUNT=batch.accountId||null;
      setTimeout(function(){
        let sel=document.getElementById('csvAccountSelect');
        if(sel) sel.value=batch.accountId||'';
        if(typeof window.refreshCsvAccountBarState==='function') window.refreshCsvAccountBarState();
      },0);
    }
  }
  function setCsvModalChrome(mode){
    let title=document.getElementById('csvImportTitle');
    let sub=document.getElementById('csvImportSub');
    let commit=document.getElementById('csvImportCommit');
    let cancel=document.getElementById('csvImportCancel');
    if(mode==='history'){
      if(title) title.textContent='🏦 Import Bank CSV';
      if(sub) sub.textContent='Upload a new bank CSV or reopen a confirmed import to correct categories, income assignment, reimbursements, or skipped rows.';
      if(commit){commit.style.display='none';commit.disabled=true;}
      if(cancel) cancel.textContent='Close';
      return;
    }
    if(mode==='edit'){
      if(title) title.textContent='✏️ Edit CSV Import';
      if(sub) sub.textContent='Adjust the confirmed entries below. Saving will update the existing transactions instead of importing duplicates.';
      if(commit){commit.style.display='';commit.textContent='Save Changes';}
      if(cancel) cancel.textContent='Close';
      return;
    }
    if(title) title.textContent='🏦 Import Bank Transactions';
    if(sub) sub.textContent='Review and assign imported transactions before committing them to your budget';
    if(commit){commit.style.display='';commit.textContent='Import Transactions';}
    if(cancel) cancel.textContent='Cancel';
  }
  function findOrNullMonth(name){
    let st=window.state; if(!st||!Array.isArray(st.months)) return null;
    return st.months.find(function(m){return m&&m.name===name;})||null;
  }
  function isDuplicate(tx,month){
    if(!month||!Array.isArray(month.expenses)) return false;
    let a=Math.abs(tx.amount),n=normMerchant(tx.desc);
    return month.expenses.some(function(row){
      return (row.transactions||[]).some(function(t){
        return Math.abs(Math.abs(Number(t.amount||0))-a)<0.01&&normMerchant(t.note)===n;
      });
    });
  }
  function isDuplicateIncome(tx,month){
    if(!month||!Array.isArray(month.income)) return false;
    let a=Math.abs(Number(tx&&tx.amount||0));
    let n=normMerchant(tx&&tx.desc);
    let d=String(tx&&tx.dateStamp||'');
    return month.income.some(function(row){
      return (row.transactions||[]).some(function(t){
        let amountMatch=Math.abs(Math.abs(Number(t&&t.amount||0))-a)<0.01;
        let noteMatch=normMerchant(t&&t.note)===n;
        let existingDate=String((t&&t.date)||'');
        let dateMatch=!d||!existingDate||existingDate===d;
        return amountMatch&&noteMatch&&dateMatch;
      });
    });
  }

  function isDuplicateReimbursement(tx,month){
    if(!month||!Array.isArray(month.expenses)) return false;
    let a=Math.abs(Number(tx&&tx.amount||0));
    let n=normMerchant(tx&&tx.desc);
    let d=String(tx&&tx.dateStamp||'');
    return month.expenses.some(function(row){
      return (row.transactions||[]).some(function(t){
        let amountMatch=Math.abs(Math.abs(Number(t&&t.amount||0))-a)<0.01;
        let noteMatch=normMerchant(t&&t.note)===n;
        let existingDate=String((t&&t.date)||'');
        let dateMatch=!d||!existingDate||existingDate===d;
        let source=String((t&&t.source)||(t&&t.ledgerSource)||'');
        return amountMatch&&noteMatch&&dateMatch&&(source==='csv-reimburse'||Number(t&&t.amount||0)<0);
      });
    });
  }

  function isDuplicateCredit(tx,month,creditType){
    if(creditType==='income') return isDuplicateIncome(tx,month);
    if(creditType==='reimburse') return isDuplicateReimbursement(tx,month);
    return false;
  }
  function getExpenseGroups(){
    let st=window.state,months=(st&&Array.isArray(st.months))?st.months:[],all={};
    months.forEach(function(m){(m.expenseCategoryOrder||[]).forEach(function(g){all[g]=true;});(m.expenses||[]).forEach(function(r){if(r.group)all[r.group]=true;});});
    return Object.keys(all);
  }
  function getIncomeGroups(){
    let st=window.state,months=(st&&Array.isArray(st.months))?st.months:[],all={};
    months.forEach(function(m){(m.income||[]).forEach(function(r){if(r.group)all[r.group]=true;});});
    return Object.keys(all);
  }
  function getSavingsGroups(){
    let st=window.state,months=(st&&Array.isArray(st.months))?st.months:[],all={};
    months.forEach(function(m){
      (m.savingsCategoryOrder||[]).forEach(function(g){all[g]=true;});
      (m.savings||[]).forEach(function(r){if(r.group)all[r.group]=true;});
    });
    return Object.keys(all);
  }
  function buildSavingsSubOpts(group,sel){
    let st=window.state; if(!group||!st||!Array.isArray(st.months)) return '<option value="">— Savings row —</option>';
    let rows={};
    st.months.forEach(function(m){(m.savings||[]).forEach(function(r){if(r.group===group&&r.name)rows[r.name]=true;});});
    let html='<option value="">— Savings row —</option>';
    Object.keys(rows).forEach(function(s){html+='<option value="'+esc(s)+'"'+(s===sel?' selected':'')+'>'+esc(s)+'</option>';});
    return html;
  }
  function buildExpenseSubOpts(cat,sel){
    let st=window.state; if(!cat||!st||!Array.isArray(st.months)) return '<option value="">— Sub-category —</option>';
    let subs={};
    st.months.forEach(function(m){(m.expenses||[]).forEach(function(r){if(r.group===cat&&r.name)subs[r.name]=true;});});
    let html='<option value="">— Sub-category —</option>';
    Object.keys(subs).forEach(function(s){html+='<option value="'+esc(s)+'"'+(s===sel?' selected':'')+'>'+esc(s)+'</option>';});
    return html;
  }
  function hasValidExpenseAssignment(entry){
    if(!entry||!entry.cat||!entry.sub) return false;
    let groups=getExpenseGroups();
    if(groups.indexOf(entry.cat)<0) return false;
    let st=window.state;
    if(!st||!Array.isArray(st.months)) return false;
    return st.months.some(function(m){
      return (m.expenses||[]).some(function(r){return r.group===entry.cat&&r.name===entry.sub;});
    });
  }
  function buildIncomeSubOpts(group,sel){
    let st=window.state; if(!st||!Array.isArray(st.months)) return '<option value="">— Income row —</option>';
    let rows={};
    st.months.forEach(function(m){(m.income||[]).forEach(function(r){if((!group||r.group===group)&&r.name)rows[r.name]=true;});});
    let html='<option value="">— Income row —</option>';
    Object.keys(rows).forEach(function(s){html+='<option value="'+esc(s)+'"'+(s===sel?' selected':'')+'>'+esc(s)+'</option>';});
    return html;
  }

  // ── UI state: collapse & filter (persists across re-renders within a session) ──
  let _uiState = { expCollapsed: false, crCollapsed: false, expFilter: 'all', crFilter: 'all' };

  function buildDebitBadge(entry){
    if(entry.skip) return '<span class="csv-review-badge dup">Skipped</span>';
    if((entry.targetType||'expense')==='shared-expense-settlement') return '<span class="csv-review-badge auto">Shared settlement</span>';
    if((entry.targetType||'expense')==='cc-repayment') return '<span class="csv-review-badge auto">CC Repayment</span>';
    if((entry.targetType||'expense')==='savings'){
      if(!entry.savingsGroup||!entry.savingsSub) return '<span class="csv-review-badge manual">Needs assignment</span>';
      return '<span class="csv-review-badge auto">Savings / Investment</span>';
    }
    if(!hasValidExpenseAssignment(entry)) return '<span class="csv-review-badge manual">Needs assignment</span>';
    return entry.isDup?'<span class="csv-review-badge dup">Possible duplicate</span>':(entry.autoCat?'<span class="csv-review-badge auto">Auto-matched</span>':'<span class="csv-review-badge auto">Expense</span>');
  }
  function buildDebitAssignCell(entry,idx){
    if(entry.skip || (entry.targetType||'expense')==='cc-repayment') return '<span style="color:var(--muted);font-size:0.68rem;">—</span>';
    if((entry.targetType||'expense')==='shared-expense-settlement') return '<span style="color:var(--muted);font-size:0.68rem;">Settles oldest matching pending Shared Expenses up to this transaction month</span>';
    if((entry.targetType||'expense')==='savings'){
      let sg=getSavingsGroups();
      let sh='<select class="csv-savings-group-select" data-idx="'+idx+'"><option value="">— Savings group —</option>';
      sg.forEach(function(g){sh+='<option value="'+esc(g)+'"'+(g===entry.savingsGroup?' selected':'')+'>'+esc(g)+'</option>';});
      sh+='</select>';
      return sh;
    }
    let groups=getExpenseGroups();
    let html='<select class="csv-cat-select" data-idx="'+idx+'"><option value="">— Expense category —</option>';
    groups.forEach(function(g){html+='<option value="'+esc(g)+'"'+(entry.cat===g?' selected':'')+'>'+esc(g)+'</option>';});
    html+='</select>';
    return html;
  }
  function buildDebitSubCell(entry,idx){
    if(entry.skip || (entry.targetType||'expense')==='cc-repayment') return '';
    if((entry.targetType||'expense')==='shared-expense-settlement') return '<span style="color:var(--muted);font-size:0.68rem;">No category created</span>';
    if((entry.targetType||'expense')==='savings'){
      return '<select class="csv-savings-sub-select" data-idx="'+idx+'">'+buildSavingsSubOpts(entry.savingsGroup,entry.savingsSub)+'</select>';
    }
    return '<select class="csv-subcat-select" data-idx="'+idx+'">'+buildExpenseSubOpts(entry.cat,entry.sub)+'</select>';
  }
  function buildDebitPatternCell(entry,idx){
    if(entry.skip || (entry.targetType||'expense')==='savings' || (entry.targetType||'expense')==='cc-repayment' || (entry.targetType||'expense')==='shared-expense-settlement') return '<span style="color:var(--muted);font-size:0.68rem;">—</span>';
    return '<select class="csv-cadence-select" data-idx="'+idx+'">'+CADENCE_OPTS.map(function(o){return '<option value="'+o.val+'"'+(entry.cadence===o.val?' selected':'')+'>'+o.label+'</option>';}).join('')+'</select>';
  }
  function refreshDebitRow(idx){
    let entry=pendingTxs[idx]; if(!entry||entry.isCredit) return;
    let assignCell=document.getElementById('csvDebitAssign_'+idx);
    let subCell=document.getElementById('csvDebitSub_'+idx);
    let patternCell=document.getElementById('csvDebitPattern_'+idx);
    let badgeCell=document.getElementById('csvDebitBadge_'+idx);
    if(assignCell) assignCell.innerHTML=buildDebitAssignCell(entry,idx);
    if(subCell) subCell.innerHTML=buildDebitSubCell(entry,idx);
    if(patternCell) patternCell.innerHTML=buildDebitPatternCell(entry,idx);
    if(badgeCell) badgeCell.innerHTML=buildDebitBadge(entry);
    let cat=document.querySelector('.csv-cat-select[data-idx="'+idx+'"]');
    if(cat) cat.addEventListener('change',function(){entry.cat=this.value;entry.sub='';refreshDebitRow(idx);updateCommitBtn();});
    let sub=document.querySelector('.csv-subcat-select[data-idx="'+idx+'"]');
    if(sub) sub.addEventListener('change',function(){entry.sub=this.value;let b=document.getElementById('csvDebitBadge_'+idx);if(b)b.innerHTML=buildDebitBadge(entry);updateCommitBtn();});
    let cad=document.querySelector('.csv-cadence-select[data-idx="'+idx+'"]');
    if(cad) cad.addEventListener('change',function(){entry.cadence=this.value;});
    let sg=document.querySelector('.csv-savings-group-select[data-idx="'+idx+'"]');
    if(sg) sg.addEventListener('change',function(){entry.savingsGroup=this.value;entry.savingsSub='';refreshDebitRow(idx);updateCommitBtn();});
    let ss=document.querySelector('.csv-savings-sub-select[data-idx="'+idx+'"]');
    if(ss) ss.addEventListener('change',function(){entry.savingsSub=this.value;let b=document.getElementById('csvDebitBadge_'+idx);if(b)b.innerHTML=buildDebitBadge(entry);updateCommitBtn();});
  }

  function buildReviewUI(){
    let p=_parsed;
    let expGroups=getExpenseGroups();
    let txs=(p&&Array.isArray(p.transactions))?p.transactions:pendingTxs.map(function(e){return e.tx;});
    if(!p&&!editBatchId) return;
    let expCnt=0,unkCnt=0,dupCnt=0,crCnt=0;

    if(!editBatchId && !pendingTxs.length){
      txs.forEach(function(tx){
      if(!tx.isExpense){
        crCnt++;
        let creditType=INCOME_HINTS.test(tx.desc)?'income':'reimburse';
        let creditMonth=findOrNullMonth(tx.monthName);
        let creditDup=isDuplicateCredit(tx,creditMonth,creditType);
        pendingTxs.push({id:makeCsvId('csventry'),tx:tx,isCredit:true,creditType:creditType,targetType:'credit',
                         incomeGroup:'Primary Income',incomeSub:'',savingsGroup:'',savingsSub:'',
                         cat:'',sub:'',cadence:'oneoff',skip:creditDup,isDup:creditDup});
        return;
      }
      expCnt++;
      let auto=autoExpenseCategory(tx.desc);
      let month=findOrNullMonth(tx.monthName);
      let dup=isDuplicate(tx,month);
      if(dup) dupCnt++;
      if(!auto&&!dup) unkCnt++;
      pendingTxs.push({id:makeCsvId('csventry'),tx:tx,isCredit:false,targetType:'expense',cat:auto?auto.cat:'',sub:auto?auto.sub:'',
                       savingsGroup:'',savingsSub:'',cadence:'learn',skip:dup,autoCat:!!auto,isDup:dup});
      });
    }
    expCnt=0; unkCnt=0; dupCnt=0; crCnt=0;
    pendingTxs.forEach(function(entry){
      if(entry.isCredit){
        crCnt++;
        if(entry.isDup) dupCnt++;
      }
      else {
        expCnt++;
        if(entry.isDup) dupCnt++;
        if(!entry.skip){
          if((entry.targetType||'expense')==='cc-repayment'){ /* no budget assignment needed */ }
          else if((entry.targetType||'expense')==='shared-expense-settlement'){ /* no budget assignment needed */ }
          else if((entry.targetType||'expense')==='savings'){ if(!entry.savingsGroup||!entry.savingsSub) unkCnt++; }
          else if((entry.targetType||'expense')==='expense'&&!hasValidExpenseAssignment(entry)) unkCnt++;
        }
      }
    });

    // ── Top bar ──
    let html='';
    html+='<div class="csv-review-topbar">';
    let displayTitle=(editBatchMeta&&editBatchMeta.title)||(p&&p.format)||(editBatchMeta&&editBatchMeta.format)||'Imported CSV';
    html+='<span class="csv-format-badge">'+esc(displayTitle)+'</span>';
    html+='<button class="csv-remap-btn" id="csvRenameCurrentBatchBtn" type="button">✏️ Edit reference title</button>';
    if(p&&p.format!=='KBC Belgium') html+='<button class="csv-remap-btn" id="csvRemapBtn" type="button">✏️ Change column mapping</button>';
    if(editBatchId) html+='<button class="csv-remap-btn" id="csvBackToImportsBtn" type="button">← Back to imports</button>';
    html+='</div>';

    // ── Stats strip ──
    html+='<div class="csv-import-summary">';
    html+='<div class="csv-import-stat"><div class="csv-import-stat-label">Total rows</div><div class="csv-import-stat-value">'+txs.length+'</div></div>';
    html+='<div class="csv-import-stat"><div class="csv-import-stat-label">Expenses</div><div class="csv-import-stat-value">'+expCnt+'</div></div>';
    html+='<div class="csv-import-stat"><div class="csv-import-stat-label">Credits / Income</div><div class="csv-import-stat-value">'+crCnt+'</div></div>';
    html+='<div class="csv-import-stat"><div class="csv-import-stat-label">Auto-matched</div><div class="csv-import-stat-value val-good">'+(expCnt-unkCnt-dupCnt)+'</div></div>';
    html+='<div class="csv-import-stat"><div class="csv-import-stat-label">Need assignment</div><div class="csv-import-stat-value'+(unkCnt?' val-warn':'')+'">'+unkCnt+'</div></div>';
    html+='<div class="csv-import-stat"><div class="csv-import-stat-label">Possible duplicates</div><div class="csv-import-stat-value'+(dupCnt?' val-warn':'')+'">'+dupCnt+'</div></div>';
    html+='</div>';

    if(!pendingTxs.length){
      html+='<div style="padding:24px;text-align:center;color:var(--muted);">No transactions found.</div>';
    } else {
      let csvOpenSectionCount=0;
      if(!_uiState.expCollapsed) csvOpenSectionCount++;
      if(!_uiState.crCollapsed) csvOpenSectionCount++;
      html+='<div class="csv-review-sections csv-open-sections-'+csvOpenSectionCount+'">';

      // ════════════════════════════════════════════════════════════
      // EXPENSE TABLE
      // ════════════════════════════════════════════════════════════
      let expEntries=pendingTxs.filter(function(e){return !e.isCredit;});
      let expOpen=!_uiState.expCollapsed;
      let chevronExp=expOpen?'▾':'▸';

      // Section header — clickable toggle; visible even when the CSV has no expenses
      html+='<div class="csv-section-head csv-collapsible-head" id="csvExpHead">';
      html+='<span class="csv-chevron">'+chevronExp+'</span> 💸 Expenses';
      html+='<span class="csv-section-count">'+expEntries.length+'</span>';

      // Filter pills — only shown when section is open and has rows
      if(expOpen&&expEntries.length){
        html+='<div class="csv-filter-pills" id="csvExpFilters">';
        let pills=[{v:'all',l:'All'},  {v:'manual',l:'Needs assignment'},{v:'auto',l:'Auto-matched'},{v:'dup',l:'Possible duplicate'},{v:'skip',l:'Skipped'}];
        pills.forEach(function(pill){
          let active=_uiState.expFilter===pill.v;
          html+='<button class="csv-filter-pill'+(active?' active':'')+'" data-filter="'+pill.v+'" type="button">'+pill.l+'</button>';
        });
        html+='</div>';
      }
      html+='</div>';

      // Collapsible body
      html+='<div id="csvExpBody" class="csv-section-body"'+(expOpen?'':' style="display:none"')+'>';
      if(!expEntries.length){
        html+='<div class="csv-empty-section">No expense entries found in this CSV import.</div>';
      } else {
        html+='<div class="csv-review-table-wrap"><table class="csv-review-table">';
        html+='<colgroup><col class="c-date"><col class="c-desc"><col class="c-amt"><col class="c-month"><col class="c-type"><col class="c-cat"><col class="c-sub"><col class="c-cad"><col class="c-status"><col class="c-skip"></colgroup>';
        html+='<thead><tr>';
        html+='<th>Date</th><th>Merchant / Description</th><th style="text-align:right">Amount</th><th>Month</th><th>Type</th><th>Assign to</th><th>Sub-category</th><th>Pattern</th><th>Status</th><th></th>';

        html+='</tr></thead><tbody id="csvExpTbody">';

        let lastMonth='';
        expEntries.forEach(function(entry){
          let tx=entry.tx, idx=pendingTxs.indexOf(entry);
          // Determine status key for filtering
          let statusKey=entry.skip?'skip':(entry.isDup?'dup':((entry.targetType||'expense')==='savings'?(entry.savingsGroup&&entry.savingsSub?'auto':'manual'):(((entry.targetType||'expense')==='cc-repayment'||(entry.targetType||'expense')==='shared-expense-settlement')?'auto':(hasValidExpenseAssignment(entry)?'auto':'manual'))));
          let hidden=(_uiState.expFilter!=='all' && _uiState.expFilter!==statusKey);

          // Month group row — we tag it, JS will hide it when all its rows are filtered
          if(tx.monthName!==lastMonth){
            let exists=!!findOrNullMonth(tx.monthName);
            html+='<tr class="csv-month-group-row" data-month="'+esc(tx.monthName)+'"><td colspan="10">'+esc(tx.monthName)+(exists?'':' <span style="color:#92400e;font-size:0.58rem;font-weight:700;">(will create new month)</span>')+'</td></tr>';
            lastMonth=tx.monthName;
          }

          let rc=entry.skip?'row-skip':(entry.isDup?'row-dup':'');
          html+='<tr class="'+rc+'" data-idx="'+idx+'" data-status="'+statusKey+'"'+(hidden?' style="display:none"':'')+' >';
          html+='<td class="csv-review-date">'+esc(tx.dateStamp)+'</td>';
          html+='<td class="csv-review-desc" title="'+esc(tx.desc)+'">'+esc(tx.desc)+'</td>';
          html+='<td class="csv-review-amount negative col-right">€'+Math.abs(tx.amount).toFixed(2)+'</td>';
          html+='<td class="col-month">'+esc(tx.monthName)+'</td>';
          let targetType=entry.targetType||'expense';
          html+='<td class="csv-control-cell"><select class="csv-target-type-select" data-idx="'+idx+'"'+(entry.skip?' disabled':'')+'>';
          html+='<option value="expense"'+(targetType==='expense'?' selected':'')+'>Expense</option>';
          html+='<option value="savings"'+(targetType==='savings'?' selected':'')+'>Savings / Investment</option>';
          html+='<option value="cc-repayment"'+(targetType==='cc-repayment'?' selected':'')+'>CC Repayment (exclude from budget)</option>';
          html+='<option value="shared-expense-settlement"'+(targetType==='shared-expense-settlement'?' selected':'')+'>Shared Expenses Settlement</option>';
          html+='</select></td>';
          html+='<td class="csv-control-cell" id="csvDebitAssign_'+idx+'">'+buildDebitAssignCell(entry,idx)+'</td>';
          html+='<td class="csv-control-cell" id="csvDebitSub_'+idx+'">'+buildDebitSubCell(entry,idx)+'</td>';
          html+='<td class="csv-control-cell" id="csvDebitPattern_'+idx+'">'+buildDebitPatternCell(entry,idx)+'</td>';
          let badge=buildDebitBadge(entry);
          html+='<td id="csvDebitBadge_'+idx+'">'+badge+'</td>';
          html+='<td class="csv-control-cell"><button class="csv-skip-btn'+(entry.skip?' active':'')+'" data-idx="'+idx+'" type="button">'+(entry.skip?'Skipped':'Skip')+'</button></td>';
          html+='</tr>';
        });
        html+='</tbody></table></div>';
      }
      html+='</div>'; // end csvExpBody

      // ════════════════════════════════════════════════════════════
            // CREDITS / INCOME / REIMBURSEMENTS TABLE
      // ════════════════════════════════════════════════════════════
      // 9 columns, same structure as Expenses: Status badge + filter pills
      let crEntries=pendingTxs.filter(function(e){return e.isCredit;});
      let crOpen=!_uiState.crCollapsed;
      let chevronCr=crOpen?'▾':'▸';

      html+='<div class="csv-section-head csv-collapsible-head" id="csvCrHead" style="margin-top:16px;">';
      html+='<span class="csv-chevron">'+chevronCr+'</span> 💚 Credits, Income &amp; Reimbursements';
      html+='<span class="csv-section-count">'+crEntries.length+'</span>';

      if(crOpen&&crEntries.length){
        html+='<div class="csv-filter-pills" id="csvCrFilters">';
        let crPills=[{v:'all',l:'All'},{v:'income',l:'Income'},{v:'reimburse',l:'Reimbursement'},{v:'dup',l:'Possible duplicate'},{v:'skip-type',l:'Skip (ignored)'}];
        crPills.forEach(function(pill){
          let active=_uiState.crFilter===pill.v;
          html+='<button class="csv-filter-pill cr-pill'+(active?' active':'')+'" data-cr-filter="'+pill.v+'" type="button">'+pill.l+'</button>';
        });
        html+='</div>';
      }
      html+='</div>';

      html+='<div id="csvCrBody" class="csv-section-body"'+(crOpen?'':' style="display:none"')+'>';
      html+='<div class="csv-section-note">Salary and income go to your Income section. Employer reimbursements offset an expense category. Credits you want to ignore can be skipped.</div>';
      if(!crEntries.length){
        html+='<div class="csv-empty-section">No income, credit, or reimbursement entries found in this CSV import.</div>';
      } else {
        html+='<div class="csv-review-table-wrap"><table class="csv-review-table">';
        html+='<colgroup><col class="c-date"><col class="c-desc"><col class="c-amt"><col class="c-month"><col class="c-type"><col class="c-cat"><col class="c-sub"><col class="c-cad"><col class="c-status"><col class="c-skip"></colgroup>';
        html+='<thead><tr>';
        html+='<th>Date</th><th>Description</th><th style="text-align:right">Amount</th><th>Month</th><th>Type</th><th>Assign to</th><th>Sub-row</th><th>Pattern</th><th>Status</th><th></th>';
        html+='</tr></thead><tbody id="csvCrTbody">';
        crEntries.forEach(function(entry){
          let tx=entry.tx, idx=pendingTxs.indexOf(entry);
          let crStatusKey=entry.skip?'skip-type':(entry.isDup?'dup':entry.creditType);
          let crHidden=(_uiState.crFilter!=='all'&&_uiState.crFilter!==crStatusKey);
          let rc=entry.skip?'row-skip':(entry.isDup?'row-dup':'');
          html+='<tr class="'+rc+'" data-idx="'+idx+'" data-cr-status="'+crStatusKey+'"'+(crHidden?' style="display:none"':'')+' >';
          html+='<td class="csv-review-date">'+esc(tx.dateStamp)+'</td>';
          html+='<td class="csv-review-desc" title="'+esc(tx.desc)+'">'+esc(tx.desc)+'</td>';
          html+='<td class="csv-review-amount positive col-right">€'+Math.abs(tx.amount).toFixed(2)+'</td>';
          html+='<td class="col-month">'+esc(tx.monthName)+'</td>';
          html+='<td class="csv-control-cell"><select class="csv-credit-type-select" data-idx="'+idx+'"'+(entry.skip?' disabled':'')+'>';
          CREDIT_TYPES.forEach(function(o){html+='<option value="'+esc(o.val)+'"'+(entry.creditType===o.val?' selected':'')+'>'+o.label+'</option>';});
          html+='</select></td>';
          html+='<td class="csv-control-cell" id="csvCreditAssign_'+idx+'">'+buildCreditAssignCell(entry,idx)+'</td>';
          html+='<td class="csv-control-cell" id="csvCreditSub_'+idx+'">'+buildCreditSubCell(entry,idx)+'</td>';
          html+='<td class="csv-control-cell"><span style="color:var(--muted);font-size:0.68rem;">—</span></td>';
          html+='<td id="csvCreditBadge_'+idx+'">'+buildCreditBadge(entry)+'</td>';
          html+='<td class="csv-control-cell"><button class="csv-skip-btn'+(entry.skip?' active':'')+'" data-idx="'+idx+'" type="button">'+(entry.skip?'Skipped':'Skip')+'</button></td>';
          html+='</tr>';
        });
        html+='</tbody></table></div>';
      }
      html+='</div>'; // end csvCrBody
      html+='</div>';
    }

    document.getElementById('csvImportBody').innerHTML=html;
    updateCommitBtn();
    wireReviewEvents();
    let rb=document.getElementById('csvRemapBtn');
    if(rb) rb.addEventListener('click',function(){if(_parsed){_parsed.confidence=0;buildMappingUI();}});
    let back=document.getElementById('csvBackToImportsBtn');
    if(back) back.addEventListener('click',openCsvImportHistory);
    let renameBtn=document.getElementById('csvRenameCurrentBatchBtn');
    if(renameBtn) renameBtn.addEventListener('click',function(){
      let current=(editBatchMeta&&editBatchMeta.title)||(p&&p.format)||(editBatchMeta&&editBatchMeta.format)||'Imported CSV';
      let title=(prompt('CSV import reference title:',current)||'').trim();
      if(!title) return;
      if(!editBatchMeta) editBatchMeta={};
      editBatchMeta.title=title;
      if(editBatchId){
        let batch=findCsvBatch(editBatchId);
        if(batch){ batch.title=title; batch.format=title; batch.updatedAt=new Date().toISOString(); saveCsvBatch(batch); }
        if(typeof window.saveState==='function') window.saveState(window.state);
      }
      buildReviewUI();
      let msg=document.getElementById('csvImportMsg'); if(msg) msg.textContent='Reference title updated. Save Changes when you are done.';
    });

    // ── Collapse toggles ──
    // Keep the live review table in the DOM while collapsing so unsaved row assignments are not reset.
    function setCsvSectionCollapsed(kind,collapsed){
      let body=document.getElementById(kind==='exp'?'csvExpBody':'csvCrBody');
      let head=document.getElementById(kind==='exp'?'csvExpHead':'csvCrHead');
      let filters=document.getElementById(kind==='exp'?'csvExpFilters':'csvCrFilters');
      if(body) body.style.display=collapsed?'none':'';
      if(filters) filters.style.display=collapsed?'none':'';
      if(head){
        let chev=head.querySelector('.csv-chevron');
        if(chev) chev.textContent=collapsed?'▸':'▾';
      }
      let sections=document.querySelector('.csv-review-sections');
      if(sections){
        let openCount=(_uiState.expCollapsed?0:1)+(_uiState.crCollapsed?0:1);
        sections.classList.remove('csv-open-sections-0','csv-open-sections-1','csv-open-sections-2');
        sections.classList.add('csv-open-sections-'+openCount);
      }
    }
    let expHead=document.getElementById('csvExpHead');
    if(expHead) expHead.addEventListener('click',function(e){
      if(e.target.classList.contains('csv-filter-pill')) return;
      _uiState.expCollapsed=!_uiState.expCollapsed;
      setCsvSectionCollapsed('exp',_uiState.expCollapsed);
    });
    let crHead=document.getElementById('csvCrHead');
    if(crHead) crHead.addEventListener('click',function(e){
      if(e.target.classList.contains('csv-filter-pill')) return;
      _uiState.crCollapsed=!_uiState.crCollapsed;
      setCsvSectionCollapsed('cr',_uiState.crCollapsed);
    });

    // ── Filter pills — Expenses ──
    document.querySelectorAll('.csv-filter-pill:not(.cr-pill)').forEach(function(btn){
      btn.addEventListener('click',function(e){
        e.stopPropagation();
        _uiState.expFilter=this.dataset.filter;
        applyExpenseFilter();
        document.querySelectorAll('.csv-filter-pill:not(.cr-pill)').forEach(function(b){
          b.classList.toggle('active', b.dataset.filter===_uiState.expFilter);
        });
      });
    });

    // ── Filter pills — Credits ──
    document.querySelectorAll('.cr-pill').forEach(function(btn){
      btn.addEventListener('click',function(e){
        e.stopPropagation();
        _uiState.crFilter=this.dataset.crFilter;
        applyCreditFilter();
        document.querySelectorAll('.cr-pill').forEach(function(b){
          b.classList.toggle('active', b.dataset.crFilter===_uiState.crFilter);
        });
      });
    });
  }

  // Apply filter to expense rows without rebuilding the whole UI
  function applyExpenseFilter(){
    let filter=_uiState.expFilter;
    let tbody=document.getElementById('csvExpTbody');
    if(!tbody) return;
    let dataRows=tbody.querySelectorAll('tr[data-status]');
    dataRows.forEach(function(row){
      row.style.display=(filter==='all'||row.dataset.status===filter)?'':'none';
    });
    // Hide month-group rows when all their data rows are filtered out
    let monthRows=tbody.querySelectorAll('tr.csv-month-group-row');
    monthRows.forEach(function(mRow){
      let monthName=mRow.dataset.month;
      let siblingData=tbody.querySelectorAll('tr[data-status][data-idx]');
      let allHidden=true, inGroup=false;
      for(let i=0;i<siblingData.length;i++){
        let tr=siblingData[i];
        let idx=parseInt(tr.dataset.idx,10);
        if(isNaN(idx)||!pendingTxs[idx]) continue;
        if(pendingTxs[idx].tx.monthName===monthName){
          inGroup=true;
          if(tr.style.display!=='none'){ allHidden=false; break; }
        }
      }
      mRow.style.display=(inGroup&&allHidden)?'none':'';
    });
  }

  // Apply filter to credit rows (no month groups in credits table)
  function applyCreditFilter(){
    let filter=_uiState.crFilter;
    let tbody=document.getElementById('csvCrTbody');
    if(!tbody) return;
    tbody.querySelectorAll('tr[data-cr-status]').forEach(function(row){
      row.style.display=(filter==='all'||row.dataset.crStatus===filter)?'':'none';
    });
  }

  // buildCreditBadge: single source of truth for the credit Status badge.
  // "Needs assignment" when the row type requires a selection that isn't made yet.
  function buildCreditBadge(entry){
    if(entry.skip) return '<span class="csv-review-badge dup">Skipped</span>';
    if(entry.creditType==='income'){
      // Income needs an income sub-row selected
      if(entry.isDup) return '<span class="csv-review-badge dup">Possible duplicate</span>';
      if(!entry.incomeSub) return '<span class="csv-review-badge manual">Needs assignment</span>';
      return '<span class="csv-review-badge auto">Income</span>';
    }
    if(entry.creditType==='reimburse'){
      // Reimbursement needs both expense category and sub-category
      if(!hasValidExpenseAssignment(entry)) return '<span class="csv-review-badge manual">Needs assignment</span>';
      return '<span class="csv-review-badge auto">Reimbursement</span>';
    }
    if(entry.creditType==='shared-expense-settlement') return '<span class="csv-review-badge auto">Shared settlement</span>';
    // creditType==='skip': user chose to ignore
    return '<span class="csv-review-badge dup">Skip (ignored)</span>';
  }

  function buildCreditAssignCell(entry,idx){
    if(entry.skip||entry.creditType==='skip') return '<span style="color:var(--muted);font-size:0.68rem;">—</span>';
    if(entry.creditType==='income'){
      // Group dropdown for income
      let groups=getIncomeGroups();
      let html='<select class="csv-income-group-select" data-idx="'+idx+'">';
      groups.forEach(function(g){html+='<option value="'+esc(g)+'"'+(g===entry.incomeGroup?' selected':'')+'>'+esc(g)+'</option>';});
      html+='</select>';
      return html;
    }
    if(entry.creditType==='shared-expense-settlement'){
      return '<span style="color:var(--muted);font-size:0.68rem;">Settles oldest matching pending Shared Expenses up to this transaction month</span>';
    }
    if(entry.creditType==='reimburse'){
      // Expense category dropdown
      let groups2=getExpenseGroups();
      let html='<select class="csv-cat-select csv-reimb-cat" data-idx="'+idx+'">';
      html+='<option value="">— Expense category —</option>';
      groups2.forEach(function(g){html+='<option value="'+esc(g)+'"'+(g===entry.cat?' selected':'')+'>'+esc(g)+'</option>';});
      html+='</select>';
      return html;
    }
    return '';
  }

  function buildCreditSubCell(entry,idx){
    if(entry.skip||entry.creditType==='skip') return '';
    if(entry.creditType==='income'){
      return '<select class="csv-income-sub-select" data-idx="'+idx+'">'+buildIncomeSubOpts(entry.incomeGroup,entry.incomeSub)+'</select>';
    }
    if(entry.creditType==='reimburse'){
      return '<select class="csv-subcat-select csv-reimb-sub" data-idx="'+idx+'">'+buildExpenseSubOpts(entry.cat,entry.sub)+'</select>';
    }
    if(entry.creditType==='shared-expense-settlement') return '<span style="color:var(--muted);font-size:0.68rem;">No category created</span>';
    return '';
  }

  function refreshCreditRow(idx){
    let entry=pendingTxs[idx]; if(!entry||!entry.isCredit) return;
    let assignCell=document.getElementById('csvCreditAssign_'+idx);
    let subCell=document.getElementById('csvCreditSub_'+idx);
    let badgeCell=document.getElementById('csvCreditBadge_'+idx);
    if(assignCell) assignCell.innerHTML=buildCreditAssignCell(entry,idx);
    if(subCell)    subCell.innerHTML=buildCreditSubCell(entry,idx);
    if(badgeCell)  badgeCell.innerHTML=buildCreditBadge(entry);
    // Re-wire the new dropdowns
    let ig=document.querySelector('.csv-income-group-select[data-idx="'+idx+'"]');
    if(ig) ig.addEventListener('change',function(){ entry.incomeGroup=this.value; let ss=document.querySelector('.csv-income-sub-select[data-idx="'+idx+'"]'); if(ss) ss.innerHTML=buildIncomeSubOpts(this.value,entry.incomeSub); updateCommitBtn(); });
    let is=document.querySelector('.csv-income-sub-select[data-idx="'+idx+'"]');
    if(is) is.addEventListener('change',function(){
      entry.incomeSub=this.value;
      let bc=document.getElementById('csvCreditBadge_'+idx);
      if(bc) bc.innerHTML=buildCreditBadge(entry);
      updateCommitBtn();
    });
    let rc=document.querySelector('.csv-reimb-cat[data-idx="'+idx+'"]');
    if(rc) rc.addEventListener('change',function(){
      entry.cat=this.value; entry.sub='';
      let ss=document.querySelector('.csv-reimb-sub[data-idx="'+idx+'"]');
      if(ss) ss.innerHTML=buildExpenseSubOpts(this.value,'');
      let bc=document.getElementById('csvCreditBadge_'+idx);
      if(bc) bc.innerHTML=buildCreditBadge(entry);
      updateCommitBtn();
    });
    let rs=document.querySelector('.csv-reimb-sub[data-idx="'+idx+'"]');
    if(rs) rs.addEventListener('change',function(){
      entry.sub=this.value;
      let bc=document.getElementById('csvCreditBadge_'+idx);
      if(bc) bc.innerHTML=buildCreditBadge(entry);
      updateCommitBtn();
    });
  }

  function wireReviewEvents(){
    document.querySelectorAll('.csv-target-type-select').forEach(function(sel){
      sel.addEventListener('change',function(){
        let idx=+this.dataset.idx, entry=pendingTxs[idx];
        if(!entry) return;
        entry.targetType=this.value;
        entry.cat=''; entry.sub=''; entry.savingsGroup=''; entry.savingsSub=''; entry.autoCat=false; entry.isDup=false;
        refreshDebitRow(idx);
        updateCommitBtn();
      });
    });
    pendingTxs.forEach(function(entry,idx){ if(entry&&!entry.isCredit) refreshDebitRow(idx); });
    // Expense category
    document.querySelectorAll('.csv-cat-select:not(.csv-reimb-cat)').forEach(function(sel){
      sel.addEventListener('change',function(){
        let idx=+this.dataset.idx; pendingTxs[idx].cat=this.value; pendingTxs[idx].sub='';
        let ss=document.querySelector('.csv-subcat-select[data-idx="'+idx+'"]'); if(ss) ss.innerHTML=buildExpenseSubOpts(this.value,'');
        updateCommitBtn();
      });
    });
    // Expense sub-category
    document.querySelectorAll('.csv-subcat-select:not(.csv-reimb-sub)').forEach(function(sel){
      sel.addEventListener('change',function(){ pendingTxs[+this.dataset.idx].sub=this.value; updateCommitBtn(); });
    });
    // Cadence
    document.querySelectorAll('.csv-cadence-select').forEach(function(sel){
      sel.addEventListener('change',function(){ pendingTxs[+this.dataset.idx].cadence=this.value; });
    });
    // Credit type
    document.querySelectorAll('.csv-credit-type-select').forEach(function(sel){
      sel.addEventListener('change',function(){
        let idx=+this.dataset.idx; pendingTxs[idx].creditType=this.value;
        // Reset sub-assignments when type changes
        pendingTxs[idx].cat=''; pendingTxs[idx].sub=''; pendingTxs[idx].incomeSub='';
        let month=findOrNullMonth(pendingTxs[idx].tx&&pendingTxs[idx].tx.monthName);
        pendingTxs[idx].isDup=isDuplicateCredit(pendingTxs[idx].tx,month,this.value);
        if(pendingTxs[idx].isDup) pendingTxs[idx].skip=true;
        refreshCreditRow(idx);
        updateCommitBtn();
      });
    });
    // Skip buttons
    document.querySelectorAll('.csv-skip-btn').forEach(function(btn){
      btn.addEventListener('click',function(){
        let idx=+this.dataset.idx; pendingTxs[idx].skip=!pendingTxs[idx].skip;
        let row=document.querySelector('tr[data-idx="'+idx+'"]');
        if(row) row.className=pendingTxs[idx].skip?'row-skip':(pendingTxs[idx].isDup?'row-dup':'');
        this.textContent=pendingTxs[idx].skip?'Skipped':'Skip';
        this.classList.toggle('active',pendingTxs[idx].skip);
        // Disable/enable controls in the row
        ['csv-cat-select','csv-subcat-select','csv-cadence-select','csv-credit-type-select','csv-target-type-select','csv-savings-group-select','csv-savings-sub-select','csv-income-group-select','csv-income-sub-select'].forEach(function(cls){
          let el=row&&row.querySelector('.'+cls); if(el) el.disabled=pendingTxs[idx].skip;
        });
        if(pendingTxs[idx].isCredit) refreshCreditRow(idx);
        updateCommitBtn();
      });
    });
    // Wire initial credit row dropdowns
    pendingTxs.forEach(function(entry,idx){ if(entry.isCredit) refreshCreditRow(idx); });
  }

  function updateCommitBtn(){
    let btn=document.getElementById('csvImportCommit'), msg=document.getElementById('csvImportMsg');
    if(!btn) return;
    let active=pendingTxs.filter(function(e){return !e.skip;});
    // Validate active rows
    let issues=[];
    active.forEach(function(e){
      if(!e.isCredit&&(e.targetType||'expense')==='expense'&&!hasValidExpenseAssignment(e)) issues.push('expense');
      if(!e.isCredit&&(e.targetType||'expense')==='savings'&&(!e.savingsGroup||!e.savingsSub)) issues.push('savings');
      if(e.isCredit&&e.creditType==='income'&&!e.incomeSub) issues.push('income');
      if(e.isCredit&&e.creditType==='reimburse'&&!hasValidExpenseAssignment(e)) issues.push('reimburse');
    });
    let uniq=[...new Set(issues)];
    btn.disabled=active.length===0||uniq.length>0;
    if(msg){
      if(!active.length) msg.textContent='All transactions are skipped.';
      else if(uniq.length) msg.textContent='Some rows still need assignment: '+uniq.join(', ')+'.';
      else msg.textContent='\u2713 Ready to import '+active.length+' transaction(s).';
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMMIT
  // ═══════════════════════════════════════════════════════════════════════════
  let CSV_MONTH_NAMES=["January","February","March","April","May","June","July","August","September","October","November","December"];

  function parseCsvMonthName(monthName){
    let match=String(monthName||'').match(/^([A-Za-z]+)\s+(\d{4})$/);
    if(!match) return null;
    let idx=CSV_MONTH_NAMES.indexOf(match[1]);
    if(idx<0) return null;
    return {name:match[1]+' '+match[2],monthIdx:idx,year:Number(match[2]),serial:Number(match[2])*12+idx};
  }

  function csvMonthNameFromSerial(serial){
    let year=Math.floor(serial/12);
    let idx=serial-(year*12);
    if(idx<0){idx+=12;year-=1;}
    return CSV_MONTH_NAMES[idx]+' '+year;
  }

  function sortCsvMonths(){
    let st=window.state;
    if(!st||!Array.isArray(st.months)) return;
    st.months.sort(function(a,b){
      let pa=parseCsvMonthName(a&&a.name),pb=parseCsvMonthName(b&&b.name);
      if(!pa&&!pb) return String(a&&a.name||'').localeCompare(String(b&&b.name||''));
      if(!pa) return 1;
      if(!pb) return -1;
      return pa.serial-pb.serial;
    });
  }

  function csvFindMonthByName(monthName){
    let st=window.state;
    if(!st||!Array.isArray(st.months)) return null;
    return st.months.find(function(m){return m&&m.name===monthName;})||null;
  }

  function csvNearestMonthBefore(serial){
    let st=window.state;
    if(!st||!Array.isArray(st.months)) return null;
    let match=st.months
      .map(function(m){return {month:m,info:parseCsvMonthName(m&&m.name)};})
      .filter(function(x){return x.info&&x.info.serial<serial;})
      .sort(function(a,b){return b.info.serial-a.info.serial;})[0];
    return match||null;
  }

  function csvBlankMonth(monthName){
    let month={
      name: monthName,
      income: [
        starterIncomeRow('income-salary', 'Primary Income', 'Salary'),
        starterIncomeRow('income-other', 'Primary Income', 'Other Income'),
        starterIncomeRow('income-rollover', 'Adjustments', 'Spillover previous Month'),
        starterIncomeRow('income-splitwise', SHARED_EXPENSES_INCOME_GROUP, SHARED_EXPENSES_INCOME_NAME)
      ],
      savings: [],
      expenses: [],
      incomeCategoryOrder: ['Primary Income', 'Adjustments', SHARED_EXPENSES_INCOME_GROUP],
      savingsCategoryOrder: [],
      expenseCategoryOrder: [],
      allocationTargets: {},
      savingsCategoryAllocations: {},
      splitwise: {},
      splitwiseCategories: {},
      scenario: null,
      goals: [],
      goalRolloverLink: null,
      rolloverLink: null,
      forecastLockDay: 5,
      lockedForecast: null,
      specialFundingSource: { enabled: false, label: '', incomeName: '', expenseName: '', expenseTargetType: 'category', expenseTargetKey: '' }
    };
    if(typeof prepareMonth === 'function') prepareMonth(month,0,[month]);
    month.expenses = Array.isArray(month.expenses) ? month.expenses.filter(function(row){ return row && Array.isArray(row.transactions) && row.transactions.length; }) : [];
    month.expenseCategoryOrder = monthExpenseGroups(month);
    month.splitwiseCategories = {};
    return month;
  }

  function createStandaloneCsvMonth(monthName){
    return csvBlankMonth(monthName);
  }

  function createCsvRolloverMonth(sourceMonth,monthName){
    let month = csvBlankMonth(monthName);
    month.forecastLockDay = Number(sourceMonth && sourceMonth.forecastLockDay || 5);
    if(typeof setLinkedRollover === 'function') setLinkedRollover(month, sourceMonth);
    else month.rolloverLink = sourceMonth ? { sourceMonthName: sourceMonth.name } : null;
    month.goalRolloverLink = sourceMonth ? { sourceMonthName: sourceMonth.name } : null;
    if(sourceMonth && typeof applyLinkedRollover === 'function') applyLinkedRollover(month, sourceMonth);
    return month;
  }

  function ensureCsvMonthCategoryStructure(month,sourceMonth){
    if(!month) return;
    month.income = Array.isArray(month.income) ? month.income : [];
    month.savings = Array.isArray(month.savings) ? month.savings : [];
    month.expenses = Array.isArray(month.expenses) ? month.expenses : [];
    month.incomeCategoryOrder = Array.isArray(month.incomeCategoryOrder) ? month.incomeCategoryOrder : [];
    month.savingsCategoryOrder = Array.isArray(month.savingsCategoryOrder) ? month.savingsCategoryOrder : [];
    month.expenseCategoryOrder = monthExpenseGroups(month);
    month.allocationTargets = Object.assign({}, month.allocationTargets || {});
    month.splitwise = Object.assign({}, month.splitwise || {});
    month.splitwiseCategories = Object.assign({}, month.splitwiseCategories || {});
    ensureSharedExpensesIncomePreset(month);
    if(typeof syncDerivedRows === 'function') syncDerivedRows(month,(window.state&&window.state.months)||[month]);
  }

  function ensureCsvMonthChain(monthNames){
    let st=window.state;
    if(!st||!Array.isArray(st.months)) return;
    let parsed=(monthNames||[]).map(parseCsvMonthName).filter(Boolean).sort(function(a,b){return a.serial-b.serial;});
    let wanted={}; parsed.forEach(function(p){wanted[p.name]=p;});
    Object.keys(wanted).sort(function(a,b){return wanted[a].serial-wanted[b].serial;}).forEach(function(name){
      let existing=csvFindMonthByName(name);
      if(existing){
        ensureCsvMonthCategoryStructure(existing);
        return;
      }
      let info=wanted[name];
      let previousCalendarMonth=csvFindMonthByName(csvMonthNameFromSerial(info.serial-1));
      let nearestPrior=csvNearestMonthBefore(info.serial);
      let source=previousCalendarMonth||(nearestPrior&&nearestPrior.month)||null;
      let month=source ? createCsvRolloverMonth(source,name) : createStandaloneCsvMonth(name);
      ensureCsvMonthCategoryStructure(month,source);
      st.months.push(month);
      sortCsvMonths();
    });
    refreshCsvSharedExpenseDerivedState();
  }

  function ensureMonth(monthName){
    let st=window.state;
    if(!st||!Array.isArray(st.months)) return null;
    let month=st.months.find(function(m){return m&&m.name===monthName;});
    if(month) return month;
    ensureCsvMonthChain([monthName]);
    return st.months.find(function(m){return m&&m.name===monthName;})||null;
  }
  function ensureExpenseRow(month,cat,sub){
    if(!Array.isArray(month.expenseCategoryOrder)) month.expenseCategoryOrder=[];
    if(month.expenseCategoryOrder.indexOf(cat)<0) month.expenseCategoryOrder.push(cat);
    if(!Array.isArray(month.expenses)) month.expenses=[];
    let row=month.expenses.find(function(r){return r.group===cat&&r.name===sub;});
    if(!row){
      row={id:'csv-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),type:'VARIABLE',group:cat,name:sub,planned:0,fixed:false,transactions:[]};
      month.expenses.push(row);
    }
    if(!Array.isArray(row.transactions)) row.transactions=[];
    return row;
  }
  function ensureIncomeRow(month,group,name){
    if(!Array.isArray(month.income)) month.income=[];
    let row=month.income.find(function(r){return r.name===name;});
    if(!row){
      row={id:'csv-inc-'+Date.now()+'-'+Math.random().toString(36).slice(2,5),type:'VARIABLE',group:group||'Primary Income',name:name,planned:0,toggleBased:false,transactions:[]};
      month.income.push(row);
    }
    if(!Array.isArray(row.transactions)) row.transactions=[];
    return row;
  }
  function ensureSavingsRow(month,group,name){
    if(!Array.isArray(month.savings)) month.savings=[];
    let row=month.savings.find(function(r){return r.group===group&&r.name===name;})||month.savings.find(function(r){return r.name===name;});
    if(!row){
      row={id:'csv-sav-'+Date.now()+'-'+Math.random().toString(36).slice(2,5),type:'VARIABLE',group:group||'Savings',name:name,planned:0,transactions:[]};
      month.savings.push(row);
    }
    if(!Array.isArray(row.transactions)) row.transactions=[];
    return row;
  }

  function normalizeImportText(value,fallback){
    let clean=String(value==null?'':value).replace(/\s+/g,' ').trim();
    return clean || fallback || '';
  }

  function csvExpenseBehaviorForCadence(cadence){
    let key=String(cadence||'').toLowerCase();
    if(key==='monthly'||key==='semimonthly') return 'fixed';
    if(key==='learn') return 'candidate';
    return 'variable';
  }

  function csvExpectedMonthlyAmount(amount,cadence){
    let n=Math.abs(Number(amount||0));
    let key=String(cadence||'').toLowerCase();
    if(key==='semimonthly') return n*2;
    return n;
  }

  function applyCsvExpenseBehavior(row,amount,cadence,entry){
    if(!row) return row;
    let behavior=csvExpenseBehaviorForCadence(cadence);
    row.behaviorType=behavior;
    row.behaviorSource='csv-review';
    row.lastBehaviorReviewAt=new Date().toISOString();
    if(behavior==='fixed'){
      row.type='FIXED';
      row.fixed=true;
      let expected=csvExpectedMonthlyAmount(amount,cadence);
      if(!Number(row.planned||0)) row.planned=expected;
      row.protectedAllocation=true;
    }else if(row.fixed!==true){
      row.type=row.type||'VARIABLE';
      row.fixed=false;
      row.protectedAllocation=false;
    }
    row.behaviorMeta=Object.assign({}, row.behaviorMeta||{}, {
      cadenceHint:String(cadence||'learn'),
      ledgerFirst:true,
      importEntryId:entry&&entry.id||'',
      importBatchId:entry&&entry.importBatchId||''
    });
    return row;
  }

  function csvBankEntryNote(tx,fallback,notePrefix){
    let desc=normalizeImportText(tx&&tx.desc,fallback||'CSV import');
    desc=desc.replace(/^[\s>→➜➔↪↩-]+/u,'').trim();
    let prefix=normalizeImportText(notePrefix,'🏦 ');
    return normalizeImportText(prefix+desc,fallback||'CSV import');
  }

  function createCsvExpenseTransaction(tx,amount,cadence,source,notePrefix,batchId,entryId){
    let behavior=csvExpenseBehaviorForCadence(cadence);
    return {
      amount:amount,
      note:csvBankEntryNote(tx,'CSV import',notePrefix),
      date:tx.dateStamp,
      cadenceHint:cadence||'learn',
      behaviorType:behavior,
      ledgerSource:source||'csv',
      source:source||'csv',
      csvImport:true,
      importBatchId:batchId||'',
      importEntryId:entryId||'',
      recurringCandidate:behavior==='candidate'||behavior==='fixed',
      createsFinancialEntry:true
    };
  }

  function createCsvIncomeTransaction(tx,batchId,entryId){
    return {
      amount:Math.abs(Number(tx.amount||0)),
      note:csvBankEntryNote(tx,'CSV income import'),
      date:tx.dateStamp,
      source:'csv',
      csvImport:true,
      importBatchId:batchId||'',
      importEntryId:entryId||''
    };
  }
  function createCsvSavingsTransaction(tx,batchId,entryId){
    return {
      amount:Math.abs(Number(tx.amount||0)),
      note:csvBankEntryNote(tx,'CSV savings import'),
      date:tx.dateStamp,
      source:'csv-savings',
      csvImport:true,
      importBatchId:batchId||'',
      importEntryId:entryId||''
    };
  }

  function isCsvSharedExpenseSettlementEntry(entry){
    if(!entry || entry.skip) return false;
    return (!entry.isCredit && (entry.targetType || 'expense') === 'shared-expense-settlement')
      || (entry.isCredit && entry.creditType === 'shared-expense-settlement')
      || entry.kind === 'shared-expense-settlement';
  }

  function csvSharedSettlementSignedAmount(entry){
    let tx = entry && entry.tx || {};
    let amount = Math.abs(Number(tx.amount || 0));
    if(!(amount > 0)) return 0;
    return entry && entry.isCredit ? amount : -amount;
  }

  function csvSettlementAlreadyApplied(splitwiseEntry,batchId,entryId){
    return Array.isArray(splitwiseEntry && splitwiseEntry.csvSettlements)
      && splitwiseEntry.csvSettlements.some(function(item){ return item && item.batchId === batchId && item.entryId === entryId; });
  }

  function csvMonthsUpToSettlementMonth(monthName){
    let cutoff = parseCsvMonthName(monthName);
    let st = window.state;
    if(!st || !Array.isArray(st.months) || !cutoff) return [];
    return st.months.map(function(month){ return { month: month, info: parseCsvMonthName(month && month.name) }; })
      .filter(function(item){ return item.month && item.info && item.info.serial <= cutoff.serial; })
      .sort(function(a,b){ return a.info.serial - b.info.serial; })
      .map(function(item){ return item.month; });
  }

  function csvSharedSettlementCandidates(entry,direction){
    let months = csvMonthsUpToSettlementMonth(entry && entry.tx && entry.tx.monthName);
    let candidates = [];
    months.forEach(function(month){
      let monthInfo = parseCsvMonthName(month && month.name);
      Object.keys(month && month.splitwise || {}).forEach(function(key){
        (month.splitwise[key] || []).forEach(function(splitwiseEntry,index){
          if(!splitwiseEntry || splitwiseEntry.carriedFrom) return;
          let pending = splitwisePendingForEntry(splitwiseEntry);
          if(Math.abs(pending) <= 0.0049) return;
          if(direction > 0 && pending <= 0.0049) return;
          if(direction < 0 && pending >= -0.0049) return;
          candidates.push({
            month: month,
            key: key,
            entry: splitwiseEntry,
            pending: pending,
            index: index,
            serial: monthInfo ? monthInfo.serial : 0,
            date: String(splitwiseEntry.date || '')
          });
        });
      });
    });
    candidates.sort(function(a,b){
      if(a.serial !== b.serial) return a.serial - b.serial;
      if(a.date !== b.date) return a.date.localeCompare(b.date);
      return a.index - b.index;
    });
    return candidates;
  }

  function refreshCsvSharedExpenseDerivedState(){
    let st = window.state;
    if(!st || !Array.isArray(st.months)) return;
    let byName = {};
    st.months.forEach(function(month){ if(month && month.name) byName[month.name] = month; });

    // Rebuild linked carried Shared Expenses from their source months. This keeps
    // current-month native entries intact while removing stale carried entries.
    st.months.forEach(function(month){
      if(!month || !month.rolloverLink || !month.rolloverLink.sourceMonthName) return;
      let source = byName[month.rolloverLink.sourceMonthName];
      if(source && typeof applyLinkedRollover === 'function') applyLinkedRollover(month, source);
    });

    st.months.forEach(function(month){
      if(month && typeof syncDerivedRows === 'function') syncDerivedRows(month, st.months);
    });
  }

  function settleSharedExpensesFromCsv(entry,batchId){
    if(!isCsvSharedExpenseSettlementEntry(entry)) return { settled: 0, unmatched: 0 };
    entry.id = entry.id || makeCsvId('csventry');
    let signedAmount = csvSharedSettlementSignedAmount(entry);
    let direction = signedAmount >= 0 ? 1 : -1;
    let remaining = Math.abs(Number(signedAmount || 0));
    let settled = 0;
    if(!(remaining > 0)) return { settled: 0, unmatched: 0 };

    csvSharedSettlementCandidates(entry,direction).forEach(function(candidate){
      if(remaining <= 0.0049) return;
      let splitwiseEntry = candidate.entry;
      if(csvSettlementAlreadyApplied(splitwiseEntry,batchId,entry.id)) return;
      let pending = splitwisePendingForEntry(splitwiseEntry);
      if(Math.abs(pending) <= 0.0049) return;
      let applied = Math.min(remaining, Math.abs(pending));
      if(!(applied > 0)) return;
      let signedApplied = Number((applied * direction).toFixed(2));
      splitwiseEntry.settled = Number((Number(splitwiseEntry.settled || 0) + signedApplied).toFixed(2));
      splitwiseEntry.csvSettlements = Array.isArray(splitwiseEntry.csvSettlements) ? splitwiseEntry.csvSettlements : [];
      splitwiseEntry.csvSettlements.push({
        batchId: batchId,
        entryId: entry.id,
        amount: signedApplied,
        date: entry.tx && (entry.tx.dateStamp || entry.tx.date) || todayStamp(),
        note: normalizeImportText(entry.tx && entry.tx.desc, 'CSV Shared Expenses Settlement'),
        csvMonthName: entry.tx && entry.tx.monthName || '',
        sourceMonthName: candidate.month && candidate.month.name || ''
      });
      settled = Number((settled + applied).toFixed(2));
      remaining = Number((remaining - applied).toFixed(2));
    });

    entry.kind = 'shared-expense-settlement';
    entry.importBatchId = batchId;
    entry.sharedExpenseSettled = settled;
    entry.sharedExpenseUnmatched = Math.max(0, remaining);
    refreshCsvSharedExpenseDerivedState();
    return { settled: settled, unmatched: Math.max(0, remaining) };
  }

  function removeCsvSharedExpenseSettlementsForBatch(batchId){
    let st = window.state;
    if(!st || !Array.isArray(st.months) || !batchId) return;
    st.months.forEach(function(month){
      Object.keys(month && month.splitwise || {}).forEach(function(key){
        (month.splitwise[key] || []).forEach(function(splitwiseEntry){
          if(!splitwiseEntry || !Array.isArray(splitwiseEntry.csvSettlements)) return;
          let kept = [];
          splitwiseEntry.csvSettlements.forEach(function(item){
            if(item && item.batchId === batchId){
              splitwiseEntry.settled = Number((Number(splitwiseEntry.settled || 0) - Number(item.amount || 0)).toFixed(2));
            } else {
              kept.push(item);
            }
          });
          if(kept.length) splitwiseEntry.csvSettlements = kept;
          else delete splitwiseEntry.csvSettlements;
        });
      });
    });
    refreshCsvSharedExpenseDerivedState();
  }

  function validateImportRows(rows){
    let issues=[];
    rows.forEach(function(entry){
      if(!entry||entry.skip) return;
      if(!entry.tx||!entry.tx.monthName) issues.push('transaction date');
      if(!entry.isCredit&&(entry.targetType||'expense')==='expense'&&(!normalizeImportText(entry.cat)||!normalizeImportText(entry.sub))) issues.push('expense category');
      if(!entry.isCredit&&(entry.targetType||'expense')==='savings'&&(!normalizeImportText(entry.savingsGroup)||!normalizeImportText(entry.savingsSub))) issues.push('savings row');
      if(!entry.isCredit&&(entry.targetType||'expense')==='shared-expense-settlement') return;
      if(entry.isCredit&&entry.creditType==='income'&&!normalizeImportText(entry.incomeSub)) issues.push('income row');
      if(entry.isCredit&&entry.creditType==='reimburse'&&(!normalizeImportText(entry.cat)||!normalizeImportText(entry.sub))) issues.push('reimbursement category');
    });
    return Array.from(new Set(issues));
  }

  function removeTransactionsForBatch(batchId){
    let st=window.state;
    if(!st||!Array.isArray(st.months)||!batchId) return;
    removeCsvSharedExpenseSettlementsForBatch(batchId);
    st.months.forEach(function(month){
      (month.expenses||[]).forEach(function(row){
        if(Array.isArray(row.transactions)) row.transactions=row.transactions.filter(function(t){return t.importBatchId!==batchId;});
      });
      (month.income||[]).forEach(function(row){
        if(Array.isArray(row.transactions)) row.transactions=row.transactions.filter(function(t){return t.importBatchId!==batchId;});
      });
      (month.savings||[]).forEach(function(row){
        if(Array.isArray(row.transactions)) row.transactions=row.transactions.filter(function(t){return t.importBatchId!==batchId;});
      });
    });
  }

  function pruneEmptyCsvRows(){
    let st=window.state;
    if(!st||!Array.isArray(st.months)) return;
    st.months.forEach(function(month){
      if(Array.isArray(month.expenses)){
        month.expenses=month.expenses.filter(function(row){
          return !(String(row.id||'').indexOf('csv-')===0 && (!row.transactions||row.transactions.length===0) && !Number(row.planned||0));
        });
      }
      if(Array.isArray(month.income)){
        month.income=month.income.filter(function(row){
          return !(String(row.id||'').indexOf('csv-inc-')===0 && (!row.transactions||row.transactions.length===0) && !Number(row.planned||0));
        });
      }
      if(Array.isArray(month.savings)){
        month.savings=month.savings.filter(function(row){
          return !(String(row.id||'').indexOf('csv-sav-')===0 && (!row.transactions||row.transactions.length===0) && !Number(row.planned||0));
        });
      }
    });
  }

  function captureCcRepaymentRowsFromEntries(rows){
    return (rows||[]).filter(function(entry){
      return entry && !entry.skip && !entry.isCredit && (entry.targetType||'expense')==='cc-repayment' && entry.tx;
    }).map(function(entry){
      let tx=entry.tx||{};
      return {
        date: tx.dateStamp || tx.date || todayISO(),
        amount: Math.abs(Number(tx.amount||0)),
        desc: tx.desc || '',
        accountId: (window.CURRENT_IMPORT_ACCOUNT) || '',
        accountName: (typeof window.getAccountName === 'function' ? window.getAccountName(window.CURRENT_IMPORT_ACCOUNT) : '') || ''
      };
    }).filter(function(r){ return r.amount>0; });
  }

  function applyImportRows(rows,batchId){
    let imported={expenses:0,income:0,savings:0,reimbursements:0,ccRepayments:0};
    ensureCsvMonthChain((rows||[]).filter(function(entry){
      return entry && !entry.skip && entry.tx && entry.tx.monthName && !isCsvSharedExpenseSettlementEntry(entry);
    }).map(function(entry){return entry.tx.monthName;}));
    rows.slice().sort(function(a,b){
      let pa=parseCsvMonthName(a&&a.tx&&a.tx.monthName),pb=parseCsvMonthName(b&&b.tx&&b.tx.monthName);
      return (pa?pa.serial:0)-(pb?pb.serial:0);
    }).forEach(function(entry){
      entry.id=entry.id||makeCsvId('csventry');
      if(entry.skip) return;
      let tx=entry.tx;

      if(isCsvSharedExpenseSettlementEntry(entry)){
        settleSharedExpensesFromCsv(entry,batchId);
        imported.reimbursements++;
        return;
      }

      let month=ensureMonth(tx.monthName);

      if(!entry.isCredit){
        if((entry.targetType||'expense')==='cc-repayment'){
          entry.kind='cc-repayment';
          entry.importBatchId=batchId;
          imported.ccRepayments++;
          return;
        }
        if((entry.targetType||'expense')==='savings'){
          let sg=normalizeImportText(entry.savingsGroup,'Savings');
          let ss=normalizeImportText(entry.savingsSub,sg);
          ensureSavingsRow(month,sg,ss).transactions.push(createCsvSavingsTransaction(tx,batchId,entry.id));
          entry.kind='savings';
          imported.savings++;
          return;
        }
        let cat=normalizeImportText(entry.cat,'Imported');
        let sub=normalizeImportText(entry.sub,'Imported');
        learnMerchant(tx.desc,cat,sub);
        let expenseRow=ensureExpenseRow(month,cat,sub);
        entry.importBatchId=batchId;
        applyCsvExpenseBehavior(expenseRow,Math.abs(Number(tx.amount||0)),entry.cadence||'learn',entry);
        expenseRow.transactions.push(
          createCsvExpenseTransaction(tx,Math.abs(Number(tx.amount||0)),entry.cadence||'learn','csv','',batchId,entry.id)
        );
        entry.kind='expense';
        imported.expenses++;
        return;
      }

      if(entry.creditType==='income'){
        let group=normalizeImportText(entry.incomeGroup,'Primary Income');
        let name=normalizeImportText(entry.incomeSub,group);
        ensureIncomeRow(month,group,name).transactions.push(createCsvIncomeTransaction(tx,batchId,entry.id));
        entry.kind='income';
        imported.income++;
        return;
      }

      if(entry.creditType==='shared-expense-settlement'){
        settleSharedExpensesFromCsv(entry,batchId);
        imported.reimbursements++;
        return;
      }

      if(entry.creditType==='reimburse'){
        let rcat=normalizeImportText(entry.cat,'Imported');
        let rsub=normalizeImportText(entry.sub,'Imported');
        learnMerchant(tx.desc,rcat,rsub);
        let reimbRow=ensureExpenseRow(month,rcat,rsub);
        entry.importBatchId=batchId;
        if(reimbRow.fixed!==true) applyCsvExpenseBehavior(reimbRow,0,'oneoff',entry);
        reimbRow.transactions.push(
          createCsvExpenseTransaction(tx,-Math.abs(Number(tx.amount||0)),'oneoff','csv-reimburse','🏦 ',batchId,entry.id)
        );
        entry.kind='reimburse';
        imported.reimbursements++;
      }
    });
    if(typeof propagateLinkedRollovers==='function') propagateLinkedRollovers();
    sortCsvMonths();
    return imported;
  }

  function buildCsvBatch(rows,result,existingId){
    let now=new Date().toISOString();
    let batchId=existingId||makeCsvId('csvbatch');
    let months=Array.from(new Set(rows.filter(function(e){return !e.skip;}).map(function(e){return e.tx&&e.tx.monthName;}).filter(Boolean)));
    let accountId=(typeof window!=='undefined' && 'CURRENT_IMPORT_ACCOUNT' in window)?(window.CURRENT_IMPORT_ACCOUNT||''):'';
    let accountName=accountId&&typeof window.getAccountName==='function'?window.getAccountName(accountId):'';
    let baseTitle=(editBatchMeta&&editBatchMeta.title)||(_parsed&&_parsed.format)||(editBatchMeta&&editBatchMeta.format)||'Imported CSV';
    return {
      id:batchId,
      title:baseTitle,
      format:baseTitle,
      sourceFormat:(_parsed&&_parsed.format)||(editBatchMeta&&editBatchMeta.format)||baseTitle,
      accountId:accountId,
      accountName:accountName,
      createdAt:(editBatchMeta&&editBatchMeta.createdAt)||now,
      updatedAt:now,
      months:months,
      summary:result||{expenses:0,income:0,savings:0,reimbursements:0,ccRepayments:0},
      entries:rows.map(serializeImportEntry)
    };
  }

  function saveCsvBatch(batch){
    let batches=ensureCsvBatches();
    let idx=batches.findIndex(function(b){return b&&b.id===batch.id;});
    if(idx>=0) batches[idx]=batch;
    else batches.unshift(batch);
  }

  function commitImport(){
    let appState=window.state;
    if(!appState||!Array.isArray(appState.months)){
      alert('CSV import could not find the dashboard data state. Please reload the dashboard and try again.');
      return;
    }

    let rows=pendingTxs.slice();
    let toImport=rows.filter(function(e){return !e.skip;});
    if(!rows.length) return;

    let issues=validateImportRows(toImport);
    if(issues.length){
      updateCommitBtn();
      alert('Please finish these assignments before saving: '+issues.join(', ')+'.');
      return;
    }

    let result={expenses:0,income:0,savings:0,reimbursements:0,ccRepayments:0};
    let repaymentRows=captureCcRepaymentRowsFromEntries(rows);
    let batchId=editBatchId||makeCsvId('csvbatch');
    let wasEdit=!!editBatchId;
    let commitFn=function(){
      if(wasEdit) removeTransactionsForBatch(batchId);
      result=applyImportRows(rows,batchId);
      if(repaymentRows.length){
        if(typeof window.recordCapturedRepayments==='function') window.recordCapturedRepayments(repaymentRows);
        repaymentRows.forEach(function(r){ if(r.desc && typeof window.learnRepaymentPattern==='function') window.learnRepaymentPattern(r.desc); });
      }
      pruneEmptyCsvRows();
      saveCsvBatch(buildCsvBatch(rows,result,batchId));
      return result;
    };

    if(typeof window.withUserMutation==='function'){
      let committed=window.withUserMutation(commitFn,{hint:'rows'});
      if(committed===false) return;
    } else {
      if(typeof window.pushHistory==='function') window.pushHistory();
      commitFn();
      if(typeof window.markDirty==='function') window.markDirty();
      if(typeof window.saveState==='function') window.saveState(window.state);
      if(typeof window.render==='function') window.render('rows');
    }

    let parts=[];
    if(result.expenses) parts.push(result.expenses+' expense(s)');
    if(result.income) parts.push(result.income+' income entry/entries');
    if(result.savings) parts.push(result.savings+' savings/investment transfer(s)');
    if(result.reimbursements) parts.push(result.reimbursements+' reimbursement(s)');
    if(result.ccRepayments) parts.push(result.ccRepayments+' CC repayment(s)');
    if(!parts.length) parts.push('0 active transaction(s)');
    let months=Array.from(new Set(rows.filter(function(e){return !e.skip;}).map(function(e){return e.tx.monthName;})));
    editBatchId=batchId;
    editBatchMeta={title:(editBatchMeta&&editBatchMeta.title)||(_parsed&&_parsed.format)||'Imported CSV',format:(_parsed&&_parsed.format)||'Imported CSV',createdAt:(editBatchMeta&&editBatchMeta.createdAt)||new Date().toISOString(),updatedAt:new Date().toISOString(),total:rows.length};
    setCsvModalChrome('edit');
    let msg=document.getElementById('csvImportMsg');
    if(msg) msg.textContent=(wasEdit?'✓ Changes saved: ':'✓ Import saved: ')+parts.join(', ')+' across '+months.length+' month(s). You can keep editing or close this window.';
    let cb=document.getElementById('csvImportCommit');
    if(cb){ cb.disabled=false; cb.textContent='Save Changes'; }
  }

  function formatCsvDate(iso){
    if(!iso) return 'Unknown date';
    let d=new Date(iso);
    if(isNaN(d.getTime())) return 'Unknown date';
    return d.toLocaleDateString('en-BE',{year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  }

  function deleteCsvBatch(batchId){
    if(!batchId) return;
    let doDelete=function(){
      removeTransactionsForBatch(batchId);
      pruneEmptyCsvRows();
      let batches=ensureCsvBatches();
      let idx=batches.findIndex(function(b){return b&&b.id===batchId;});
      if(idx>=0) batches.splice(idx,1);
    };
    if(typeof window.withUserMutation==='function') window.withUserMutation(doDelete,{hint:'rows'});
    else {
      if(typeof window.pushHistory==='function') window.pushHistory();
      doDelete();
      if(typeof window.markDirty==='function') window.markDirty();
      if(typeof window.saveState==='function') window.saveState(window.state);
      if(typeof window.render==='function') window.render('rows');
    }
    openCsvImportHistory();
  }

  function openCsvImportHistory(){
    editBatchId=null; editBatchMeta=null; _parsed=null; pendingTxs=[];
    setCsvModalChrome('history');
    let selectedAccount=(typeof window!=='undefined' && 'CURRENT_IMPORT_ACCOUNT' in window)?(window.CURRENT_IMPORT_ACCOUNT||''):'';
    let allBatches=getCsvBatches();
    let batches=selectedAccount?allBatches.filter(function(b){return (b&&b.accountId||'')===selectedAccount;}):allBatches;
    let accountLabel=selectedAccount&&typeof window.getAccountName==='function'?window.getAccountName(selectedAccount):'';
    let html='';
    html+='<div class="csv-review-topbar"><span class="csv-format-badge">Confirmed CSV imports</span><button class="csv-remap-btn" id="csvUploadNewFromHistory" type="button">＋ Upload new CSV</button></div>';
    if(selectedAccount) html+='<div class="csv-import-history-filter-note">Showing imports linked to <strong>'+esc(accountLabel||selectedAccount)+'</strong>. Choose another source account above to filter.</div>';
    else html+='<div class="csv-import-history-filter-note">Showing all source accounts. Choose a source account above to filter this list.</div>';
    if(!batches.length){
      html+='<div style="padding:24px;text-align:center;color:var(--muted);">No editable CSV imports match this source account filter.</div>';
    } else {
      html+='<div class="csv-import-history-list">';
      batches.forEach(function(batch){
        let summary=batch.summary||{};
        let count=(batch.entries||[]).filter(function(e){return !e.skip;}).length;
        let months=(batch.months||[]).join(', ')||'No active months';
        let title=batch.title||batch.format||'Imported CSV';
        let acc=batch.accountName||(batch.accountId&&typeof window.getAccountName==='function'?window.getAccountName(batch.accountId):'');
        html+='<div class="csv-import-history-item">';
        html+='<div class="csv-import-history-main"><div class="csv-import-history-title">'+esc(title)+' · '+count+' active row(s)</div>';
        html+='<div class="csv-import-history-meta">'+esc(formatCsvDate(batch.updatedAt||batch.createdAt))+' · '+esc(months)+(acc?' · Source: '+esc(acc):'')+'</div>';
        html+='<div class="csv-import-history-meta">Expenses: '+(summary.expenses||0)+' · Income: '+(summary.income||0)+' · Reimbursements: '+(summary.reimbursements||0)+(summary.ccRepayments?' · CC repayments: '+summary.ccRepayments:'')+'</div></div>';
        html+='<div class="csv-import-history-actions"><button class="csv-remap-btn csv-rename-batch" data-batch-id="'+esc(batch.id)+'" type="button">Rename</button><button class="csv-remap-btn csv-edit-batch" data-batch-id="'+esc(batch.id)+'" type="button">Edit</button><button class="csv-skip-btn csv-delete-batch" data-batch-id="'+esc(batch.id)+'" type="button">Delete</button></div>';
        html+='</div>';
      });
      html+='</div>';
    }
    let body=document.getElementById('csvImportBody'); if(body) body.innerHTML=html;
    let msg=document.getElementById('csvImportMsg'); if(msg) msg.textContent=batches.length?('Showing '+batches.length+' confirmed import batch(es).'):'No matching confirmed imports.';
    openCSVImport();
    let up=document.getElementById('csvUploadNewFromHistory');
    if(up) up.addEventListener('click',function(){ closeCSVImport(); let f=document.getElementById('csvImportFile'); if(f) f.click(); });
    document.querySelectorAll('.csv-rename-batch').forEach(function(btn){
      btn.addEventListener('click',function(){
        let batch=findCsvBatch(this.dataset.batchId);
        if(!batch) return;
        let title=(prompt('CSV import reference title:',batch.title||batch.format||'Imported CSV')||'').trim();
        if(!title) return;
        batch.title=title; batch.format=title; batch.updatedAt=new Date().toISOString(); saveCsvBatch(batch);
        if(typeof window.saveState==='function') window.saveState(window.state);
        openCsvImportHistory();
      });
    });
    document.querySelectorAll('.csv-edit-batch').forEach(function(btn){
      btn.addEventListener('click',function(){
        let batch=findCsvBatch(this.dataset.batchId);
        if(!batch){alert('This CSV import could not be found.');return;}
        restorePendingFromBatch(batch);
        setCsvModalChrome('edit');
        buildReviewUI();
      });
    });
    document.querySelectorAll('.csv-delete-batch').forEach(function(btn){
      btn.addEventListener('click',function(){
        let batch=findCsvBatch(this.dataset.batchId);
        if(!batch) return;
        if(confirm('Delete this CSV import and remove its committed transactions from the dashboard?')) deleteCsvBatch(batch.id);
      });
    });
  }

  window.openCsvImportHistory = openCsvImportHistory;

  // ── Modal lifecycle ─────────────────────────────────────────────────────────
  function openCSVImport(){let o=document.getElementById('csvImportOverlay');if(o){o.classList.add('csv-open');o.setAttribute('aria-hidden','false');}}
  function closeCSVImport(){
    let o=document.getElementById('csvImportOverlay');
    if(o){
      if(document.activeElement && o.contains(document.activeElement)){ try{ document.activeElement.blur(); }catch(e){} }
      o.classList.remove('csv-open');
      o.setAttribute('aria-hidden','true');
    }
    pendingTxs=[];_parsed=null;editBatchId=null;editBatchMeta=null;setCsvModalChrome('new');
    let b=document.getElementById('csvImportBody');if(b)b.innerHTML='';
    let m=document.getElementById('csvImportMsg');if(m)m.textContent='';
    let cb=document.getElementById('csvImportCommit');if(cb)cb.disabled=true;
  }

  // ── Bootstrap ───────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded',function(){
    let csvHistoryBtn=document.getElementById('csvImportHistoryBtn'),csvFile=document.getElementById('csvImportFile');
    let closeBtn=document.getElementById('csvImportClose'),cancelBtn=document.getElementById('csvImportCancel');
    let commitBtn=document.getElementById('csvImportCommit'),overlay=document.getElementById('csvImportOverlay');
    if(csvHistoryBtn) csvHistoryBtn.addEventListener('click',openCsvImportHistory);
    if(closeBtn) closeBtn.addEventListener('click',closeCSVImport);
    if(cancelBtn)cancelBtn.addEventListener('click',closeCSVImport);
    if(commitBtn)commitBtn.addEventListener('click',commitImport);
    if(overlay)  overlay.addEventListener('click',function(e){if(e.target===overlay)closeCSVImport();});
    if(csvFile){
      csvFile.addEventListener('change',function(e){
        let file=e.target.files&&e.target.files[0]; if(!file) return;
        let reader=new FileReader();
        reader.onload=function(ev){
          let result=parseCSVText(ev.target.result);
          if(result.error){alert('\u26A0\uFE0F CSV Import Error:\n\n'+result.error);csvFile.value='';return;}
          openCSVImport();
          if(_parsed.confidence<6) buildMappingUI(); else buildReviewUI();
        };
        reader.onerror=function(){alert('Could not read file. Please try again.');};
        reader.readAsText(file,'UTF-8');
        csvFile.value='';
      });
    }
  });

  window.autoExpenseCategory = autoExpenseCategory;
  window.learnMerchant = learnMerchant;

})();

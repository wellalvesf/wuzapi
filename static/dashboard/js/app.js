let baseUrl = window.location.origin;
let scanned = false;
let updateAdminTimeout = null;
let updateUserTimeout = null;
let updateInterval = 5000;
let instanceToDelete = null;
let isAdminLogin = false;
let currentInstanceData = null;
let instancesCache = [];

// Clipboard helper com fallback para ambientes embutidos (iframe) e contextos inseguros
async function copyToClipboard(text) {
  try {
    if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(String(text || ''));
      return true;
    }
  } catch (err) {
    // continuará para fallback
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = String(text || '');
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.left = '-1000px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) return true;
  } catch (_) { /* noop */ }
  return false;
}

document.addEventListener('DOMContentLoaded', function() {

  let isHandlingChange = false;

  const loginForm = document.getElementById('loginForm');
  const loginTokenInput = document.getElementById('loginToken');
  const regularLoginBtn = document.getElementById('regularLoginBtn');
  const adminLoginBtn = document.getElementById('loginAsAdminBtn');
 
  hideWidgets();

  $('#deleteInstanceModal').modal({
    closable: true,
    onDeny: function() {
      instanceToDelete = null;
    }
  });

  // Initialize dropdowns for webhook events
  $('#webhookEvents').dropdown({
    onChange: function(value, text, $selectedItem) {
      if (isHandlingChange) return;
      if (value.includes('All')) {
        // If "All" is selected, clear selection and select only "All"
        isHandlingChange = true;
        $('#webhookEvents').dropdown('clear');
        $('#webhookEvents').dropdown('set selected', 'All');
        isHandlingChange = false;
      }
    }
  });

  $('#webhookEventsInstance').dropdown({
    onChange: function(value, text, $selectedItem) {
      if (isHandlingChange) return;
      if (value.includes('All')) {
        // If "All" is selected, clear selection and select only "All"
        isHandlingChange = true;
        $('#webhookEventsInstance').dropdown('clear');
        $('#webhookEventsInstance').dropdown('set selected', 'All');
        isHandlingChange = false;
      }
    }
  });

  // Initialize S3 media delivery dropdown (if present)
  if ($('#s3MediaDelivery').length) { $('#s3MediaDelivery').dropdown(); }
  if ($('#addInstanceS3MediaDelivery').length) { $('#addInstanceS3MediaDelivery').dropdown(); }

  // Initialize table filters dropdowns (instances list)
  if ($('#filterConnected').length) { try { $('#filterConnected').dropdown(); } catch (_) {} }
  if ($('#filterLoggedIn').length) { try { $('#filterLoggedIn').dropdown(); } catch (_) {} }

  // Initialize proxy enabled checkbox with onChange handler
  $('#proxyEnabledToggle').checkbox({
    onChange: function() {
      const enabled = $('#proxyEnabled').is(':checked');
      if (enabled) {
        $('#proxyUrlField').addClass('show');
      } else {
        $('#proxyUrlField').removeClass('show');
      }
    }
  });

  // Initialize add instance proxy toggle
  $('#addInstanceProxyToggle').checkbox({
    onChange: function() {
      const enabled = $('input[name="proxy_enabled"]').is(':checked');
      if (enabled) {
        $('#addInstanceProxyUrlField').show();
      } else {
        $('#addInstanceProxyUrlField').hide();
        $('input[name="proxy_url"]').val('');
      }
    }
  });

  // Initialize add instance S3 toggle (if present)
  if ($('#addInstanceS3Toggle').length) { $('#addInstanceS3Toggle').checkbox({
    onChange: function() {
      const enabled = $('input[name="s3_enabled"]').is(':checked');
      if (enabled) {
        $('#addInstanceS3Fields').show();
      } else {
        $('#addInstanceS3Fields').hide();
        // Clear S3 fields when disabled
        $('input[name="s3_endpoint"]').val('');
        $('input[name="s3_access_key"]').val('');
        $('input[name="s3_secret_key"]').val('');
        $('input[name="s3_bucket"]').val('');
        $('input[name="s3_region"]').val('');
        $('input[name="s3_public_url"]').val('');
        $('input[name="s3_retention_days"]').val('30');
        $('input[name="s3_path_style"]').prop('checked', false);
        if ($('#addInstanceS3MediaDelivery').length) { $('#addInstanceS3MediaDelivery').dropdown('set selected', 'base64'); }
      }
    }
  }); }

  // Handle admin login button click
  adminLoginBtn.addEventListener('click', function() {
    isAdminLogin = true;
    loginForm.classList.add('loading');
    
    // Change button appearance to show admin mode
    adminLoginBtn.classList.add('teal');
    adminLoginBtn.innerHTML = '<i class="shield alternate icon"></i> Admin Mode';
    $('#loginToken').val('').focus();
    
    // Show admin-specific instructions
    $('.ui.info.message').html(`
        <div class="header mb-4">
            <i class="user shield icon"></i>
            Admin Login
        </div>
        <p>Please enter your admin credentials:</p>
        <ul>
            <li>Use your admin token in the field above</li>
        </ul>
    `);
    
    // Focus on token input
    loginTokenInput.focus();
    loginForm.classList.remove('loading');
  });

  // Handle form submission
  loginForm.addEventListener('submit', function(e) {
    e.preventDefault();
    
    const token = loginTokenInput.value.trim();
    
    if (!token) {
        showError('Please enter your access token');
        $('#loginToken').focus();
        return;
    }
    
    loginForm.classList.add('loading');
     
    setTimeout(() => {
        if (isAdminLogin) {
            handleAdminLogin(token,true);
        } else {
            handleRegularLogin(token,true);
        }
        
        loginForm.classList.remove('loading');
    }, 1000);
  });

  $('#menulogout').on('click',function(e) {
    $('.adminlogin').hide();
    e.preventDefault();
    removeLocalStorageItem('isAdmin');
    removeLocalStorageItem('admintoken');
    removeLocalStorageItem('token');
    removeLocalStorageItem('currentInstance');
    currentInstanceData = null; // Clear instance data
    window.location.reload();
    return false;
  });

  // Atalho de logout no dropdown
  const menuLogout = document.getElementById('menuLogout');
  if (menuLogout) {
    menuLogout.addEventListener('click', function(e){
      e.preventDefault();
      $('#menulogout').trigger('click');
    });
  }

  document.getElementById('pairphoneinput').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      const phone = pairPhoneInput.value.trim();
      if (phone) {
        connect().then((data) => {
          if(data.success==true) {
            pairPhone(phone)
              .then((data) => {
                document.getElementById('pairHelp').classList.add('hidden');;
                // Success case
                if (data.success && data.data && data.data.LinkingCode) {
                  document.getElementById('pairInfo').innerHTML = `Your link code is: ${data.data.LinkingCode}`;
                  scanInterval = setInterval(checkStatus, 1000);
                } else {
                  document.getElementById('pairInfo').innerHTML = "Problem getting pairing code";
                }
              })
              .catch((error) => {
                // Error case
                document.getElementById('pairInfo').innerHTML = "Problem getting pairing code";
                console.error('Pairing error:', error);
              });
          }
      });
      }
    }
  });

  document.getElementById('userinfoinput').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      doUserInfo();
    }
  });
 
  document.getElementById('useravatarinput').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
      doUserAvatar();
    }
  });

  document.getElementById('userInfo').addEventListener('click', function() {
    document.getElementById('userInfoContainer').innerHTML='';
    document.getElementById("userInfoContainer").classList.add('hidden');
    $('#modalUserInfo').modal({onApprove: function() {
      doUserInfo();
      return false;
    }}).modal('show');
  });

  document.getElementById('userAvatar').addEventListener('click', function() {
    document.getElementById('userAvatarContainer').innerHTML='';
    document.getElementById("userAvatarContainer").classList.add('hidden');
    $('#modalUserAvatar').modal({onApprove: function() {
      doUserAvatar();
      return false;
    }}).modal('show');
  });

  document.getElementById('sendTextMessage').addEventListener('click', function() {
    document.getElementById('sendMessageContainer').innerHTML='';
    document.getElementById("sendMessageContainer").classList.add('hidden');
    $('#modalSendTextMessage').modal({onApprove: function() {
      sendTextMessage().then((result)=>{
        document.getElementById("sendMessageContainer").classList.remove('hidden');
        if(result.success===true) {
           document.getElementById('sendMessageContainer').innerHTML=`Message sent successfully. Id: ${result.data.Id}`
        } else {
           document.getElementById('sendMessageContainer').innerHTML=`Problem sending message: ${result.error}`
        }
      });
      return false;
    }}).modal('show');
  });
 
  document.getElementById('deleteMessage').addEventListener('click', function() {
    document.getElementById('deleteMessageContainer').innerHTML='';
    document.getElementById("deleteMessageContainer").classList.add('hidden');
    $('#modalDeleteMessage').modal({onApprove: function() {
      deleteMessage().then((result)=>{
        console.log(result);
        document.getElementById("deleteMessageContainer").classList.remove('hidden');
        if(result.success===true) {
           document.getElementById('deleteMessageContainer').innerHTML=`Message deleted successfully.`
        } else {
           document.getElementById('deleteMessageContainer').innerHTML=`Problem deleting message: ${result.error}`
        }
      });
      return false;
    }}).modal('show');
  });
  
  document.getElementById('userContacts').addEventListener('click', function() {
    getContacts();
  });

  // Card: Configurações Gerais GHL (placeholder para futuras ações)
  const ghlCard = document.getElementById('ghlGeneralSettings');
  if (ghlCard) {
    ghlCard.addEventListener('click', function(){
      // Abre modal GHL estilizado
      $('#modalGHLSettings')
        .modal({
          onVisible: function(){
            // ativa abas
            $('.menu .item').tab();
            // hidrata estado inicial
            // nada a hidratar por enquanto (somente outros toggles visuais)
            refreshGHLStatus();
            // Hidratar Voice IA ao abrir o modal
            try { hydrateVoiceAI(); } catch(_){}
          },
          onApprove: function(){ return false; }
        })
        .modal('show');
    });
  }

  // Salvar configurações GHL (sem ignore-groups no modal)
  const ghlSave = document.getElementById('ghlSaveSettings');
  if (ghlSave) {
    ghlSave.addEventListener('click', async function(){
      const token = getLocalStorageItem('token');
      if (ghlSave) ghlSave.classList.add('loading','disabled');
      const sendOrigin = document.getElementById('ghl-toggle-send-origin')?.querySelector('input')?.checked || document.getElementById('ghl-toggle-send-origin')?.checked;
      const userInConv = document.getElementById('ghl-toggle-agent-tag')?.querySelector('input')?.checked || document.getElementById('ghl-toggle-agent-tag')?.checked;
      const phoneRaw = (document.getElementById('ghl-disconnect-phone')?.value || '').trim();
      const phone = phoneRaw.replace(/[^0-9]/g, '').replace(/^\+/, '');
      const alertOn = document.getElementById('ghl-toggle-disconnect-alert')?.querySelector('input')?.checked || document.getElementById('ghl-toggle-disconnect-alert')?.checked;
      // Trigger tab
      const triggerEnabled = document.getElementById('ghl-trigger-enabled')?.checked || false;
      const trigger1 = (document.getElementById('ghl-trigger-1')?.value || '').trim();
      const trigger2 = (document.getElementById('ghl-trigger-2')?.value || '').trim();
      const trigger3 = (document.getElementById('ghl-trigger-3')?.value || '').trim();
      const trigger4 = (document.getElementById('ghl-trigger-4')?.value || '').trim();
      const trigger5 = (document.getElementById('ghl-trigger-5')?.value || '').trim();
      try {
        // Voice IA payload (salvar junto com o restante)
        const openaiKey = (document.getElementById('openaiKeyInput')?.value || '').trim();
        const openaiVoice = (document.getElementById('openaiVoiceValue')?.value || '').trim();
        const elevenKey = (document.getElementById('elevenKeyInput')?.value || '').trim();
        const elevenVoice = (document.getElementById('elevenVoiceValue')?.value || '').trim();

        await Promise.all([
          fetch('/integration/ghl/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'token': token },
            body: JSON.stringify({
              env_source: !!sendOrigin,
              user_in_conv: !!userInConv,
              disconnect_alert_phone: phone,
              disconnect_alert: !!alertOn,
              trigger: !!triggerEnabled,
              trigger_1: trigger1,
              trigger_2: trigger2,
              trigger_3: trigger3,
              trigger_4: trigger4,
              trigger_5: trigger5,
              ref_instance: (document.getElementById('ghl-ref-instance')?.value || '').trim()
            })
          }),
          fetch('/integration/voiceai/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'token': token },
            body: JSON.stringify({
              openai_key: openaiKey,
              openai_gpt_voice: openaiVoice,
              elevenlabs_keys: elevenKey,
              elevenlabs_voice_id: elevenVoice
            })
          })
        ]);
        $('#modalGHLSettings').modal('hide');
        showSuccess('Configurações salvas');
      } catch(_){
        showError('Falha ao salvar configurações');
      } finally { if (ghlSave) ghlSave.classList.remove('loading','disabled'); }
    });
  }

  // Botão Conectar GHL: chama nosso backend, que resolve Supabase e retorna redirect_url
  document.addEventListener('click', async function(e){
    if (e.target && e.target.id === 'btnConnectGHL') {
      const btn = e.target;
      const isDisconnect = btn.innerText.trim().toLowerCase().includes('desconectar');
      const token = getLocalStorageItem('token');
      try {
        if (isDisconnect) {
          const res = await fetch('/integration/ghl/disconnect', { method: 'POST', headers: { 'token': token } });
          if (!res.ok) throw new Error('Falha ao desconectar do GHL');
          showSuccess('GHL desconectado');
          await refreshGHLStatus();
          return;
        }
        const instanceId = getLocalStorageItem('currentInstance');
        const res = await fetch('/integration/ghl/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'token': token },
          body: JSON.stringify({ instanceId })
        });
        const json = await res.json();
        if (!res.ok || !json.redirect_url) throw new Error(json.error || 'Falha ao gerar URL de autorização do GHL');
        window.open(json.redirect_url, '_blank');
        setTimeout(refreshGHLStatus, 1500);
      } catch(err) {
        showError(err.message || 'Erro ao processar GHL');
      }
    }
  });

  async function refreshGHLStatus(){
    const token = getLocalStorageItem('token');
    try {
      const res = await fetch('/integration/ghl/status', { headers: { 'token': token } });
      const json = await res.json();
      const btn = document.getElementById('btnConnectGHL');
      const label = document.getElementById('ghlConnInfo');
      if (json.connected) {
        if (btn) btn.innerText = 'Desconectar GHL';
        if (label) label.textContent = `Conectado: ${json.ghl_location_id}`;
      } else {
        if (btn) btn.innerText = 'Conectar GHL';
        if (label) label.textContent = '';
      }
      // Hidrata toggle de envio de origem
      try {
        const v = !!json.env_source;
        const el = document.getElementById('ghl-toggle-send-origin');
        if (el) {
          const input = el.querySelector ? el.querySelector('input') : null;
          if (input) input.checked = v; else if (typeof el.checked !== 'undefined') el.checked = v;
        }
      } catch(_){ }
      try {
        const tel = json.disconnect_alert_phone || '';
        const input = document.getElementById('ghl-disconnect-phone');
        if (input) input.value = tel || '';
        const toggle = document.getElementById('ghl-toggle-disconnect-alert');
        if (toggle) {
          const isOn = !!tel && tel.length > 3;
          const inputInner = toggle.querySelector ? toggle.querySelector('input') : null;
          if (inputInner) inputInner.checked = isOn; else if (typeof toggle.checked !== 'undefined') toggle.checked = isOn;
        }
      } catch(_){ }
      try {
        const ref = json.ref_instance || '';
        const refDisplay = document.getElementById('ghl-ref-display');
        if (refDisplay) refDisplay.textContent = ref || '-';
        const refInputLegacy = document.getElementById('ghl-ref-instance');
        if (refInputLegacy) refInputLegacy.value = ref || '';
      } catch(_){ }
      try {
        const v2 = !!json.user_in_conv;
        const el2 = document.getElementById('ghl-toggle-agent-tag');
        if (el2) {
          const input2 = el2.querySelector ? el2.querySelector('input') : null;
          if (input2) input2.checked = v2; else if (typeof el2.checked !== 'undefined') el2.checked = v2;
        }
      } catch(_){ }
      try {
        const tgl = document.getElementById('ghl-trigger-enabled');
        if (tgl) tgl.checked = !!json.trigger;
        const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
        setVal('ghl-trigger-1', json.trigger_1);
        setVal('ghl-trigger-2', json.trigger_2);
        setVal('ghl-trigger-3', json.trigger_3);
        setVal('ghl-trigger-4', json.trigger_4);
        setVal('ghl-trigger-5', json.trigger_5);
      } catch(_){ }
    } catch(_){}
  }

  // Edit logo button
  const editLogoBtn = document.getElementById('editLogoBtn');
  const menuEditLogo = document.getElementById('menuEditLogo');
  function openLogoModal(){
      $('#modalEditLogo').modal({
        onApprove: function() { return false; }
      }).modal('show');
      // preload from status cache if available
      const current = getLocalStorageItem('currentInstance');
      try {
        const cached = localStorage.getItem('logo:'+current);
        if (cached) { const input = document.getElementById('logoUrlInput'); if (input) input.value = JSON.parse(cached).url; }
      } catch(_){}
      // no direct cache; will fetch from status on update
  }
  if (editLogoBtn) editLogoBtn.addEventListener('click', openLogoModal);
  if (menuEditLogo) menuEditLogo.addEventListener('click', openLogoModal);

  // Dropdown do header
  if ($('#headerActions').dropdown) {
    try { $('#headerActions').dropdown({ action: 'hide' }); } catch (_) {}
  }
  const saveLogoBtn = document.getElementById('saveLogoBtn');
  if (saveLogoBtn) {
    saveLogoBtn.addEventListener('click', async function() {
      const token = getLocalStorageItem('token');
      const url = (document.getElementById('logoUrlInput').value || '').trim();
      try {
        const res = await fetch(baseUrl + '/session/branding', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'token': token },
          body: JSON.stringify({ logo_url: url })
        });
        if (!res.ok) throw new Error('failed');
        // refetch status e aplica imediatamente
        try { await status(); } catch (_) {}
        const logo = document.getElementById('instanceLogo');
        if (logo) { logo.src = url || 'https://storage.googleapis.com/msgsndr/2cDhyWVcBPF6fKMDd4fi/media/689c31d3df61c23b596f0131.png'; }
        $('#modalEditLogo').modal('hide');
        showSuccess('Logo atualizada');
      } catch (_) {
        showError('Não foi possível salvar a logo');
      }
    });
  }

  // S3 Configuration removed (guard in case element remains)
  if (document.getElementById('s3Config')) {
    document.getElementById('s3Config').addEventListener('click', function() { return; });
  }

  // Proxy Configuration
  document.getElementById('proxyConfig').addEventListener('click', function() {
    $('#modalProxyConfig').modal({
      onApprove: function() {
        saveProxyConfig();
        return false;
      }
    }).modal('show');
    loadProxyConfig();
  });

  // Webhook Configuration
  document.getElementById('webhookConfig').addEventListener('click', function() {
    webhookModal();
  });

  // S3 handlers removed

  // Proxy checkbox toggle is now initialized in DOMContentLoaded

  $('#addInstanceButton').click(function() {
    $('#addInstanceModal').modal({
      onApprove: function(e,pp) {
         $('#addInstanceForm').submit();
         return false;
      }
    }).modal('show');
  });
  
  $('#addInstanceForm').form({
    fields: {
      name: {
        identifier: 'name',
        rules: [{
          type: 'empty',
          prompt: 'Please enter a name for the instance'
        }]
      },
      token: {
        identifier: 'token',
        rules: [{
          type: 'empty',
          prompt: 'Please enter an authentication token for the instance'
        }]
      },
      events: {
        identifier: 'events',
        rules: [{
          type: 'empty',
          prompt: 'Please select at least one event'
        }]
      },
      proxy_url: {
        identifier: 'proxy_url',
        optional: true,
        rules: [{
          type: 'regExp[^(https?|socks5)://.*]',
          prompt: 'Proxy URL must start with http://, https://, or socks5://'
        }]
      },
       
    },
    onSuccess: function(event, fields) {
      event.preventDefault();
      
      // Validate conditional fields
      const proxyEnabled = fields.proxy_enabled === 'on' || fields.proxy_enabled === true;
      const s3Enabled = false;
      
      if (proxyEnabled && !fields.proxy_url) {
        showError('Proxy URL is required when proxy is enabled');
        return false;
      }
      
      // S3 validations removed
      
      addInstance(fields).then((result) => {
        if (result.success) {
          showSuccess('Instance created successfully');
          // Refresh the instances list
          updateAdmin();
        } else {
          showError('Failed to create instance: ' + (result.error || 'Unknown error'));
        }
      }).catch((error) => {
        showError('Error creating instance: ' + error.message);
      });
      
      $('#addInstanceModal').modal('hide');
      $('#addInstanceForm').form('reset');
      $('.ui.dropdown').dropdown('restore defaults');
      // Reset toggles
      $('#addInstanceProxyToggle').checkbox('set unchecked');
      if ($('#addInstanceS3Toggle').length) { $('#addInstanceS3Toggle').checkbox('set unchecked'); }
      $('#addInstanceProxyUrlField').hide();
      if ($('#addInstanceS3Fields').length) { $('#addInstanceS3Fields').hide(); }
    }
  });

  init();
});

// ===== Stevo Voice (Front) =====
document.addEventListener('DOMContentLoaded', function(){
  const openVoice = document.getElementById('openVoicePanelMainBtn');
  if (openVoice) openVoice.addEventListener('click', ()=> window.open('https://voice.stevo.chat','_blank'));
  const copyVoice = document.getElementById('copyVoicePanelBtn');
  if (copyVoice) copyVoice.addEventListener('click', async ()=>{
    const ok = await copyToClipboard('https://voice.stevo.chat');
    if (ok) showSuccess('URL copiada'); else showError('Falha ao copiar');
  });

  const createBtn = document.getElementById('btnCreateStevoVoice');
  const refreshBtn = document.getElementById('btnVoiceRefreshQR');
  const statusBtn = document.getElementById('btnVoiceStatus');
  const deleteBtn = document.getElementById('btnVoiceDelete');
  const copyTokenBtn = document.getElementById('copyVoiceTokenBtn');
  const voiceQRRefreshBtn = document.getElementById('voiceQRRefreshBtn');
  const voiceQRStatusBtn = document.getElementById('voiceQRStatusBtn');
  const voiceQRBackBtn = document.getElementById('voiceQRBackBtn');

  let qrTimer = null; let qrCountdown = 40;
  function startQRCountdown(){
    clearInterval(qrTimer); qrCountdown = 40; updateCountdown();
    qrTimer = setInterval(()=>{ qrCountdown--; updateCountdown(); if (qrCountdown<=0){ clearInterval(qrTimer); document.getElementById('voiceQRInfo').innerHTML = 'QR expirado. Clique em Atualizar QRCode.'; } }, 1000);
  }
  function updateCountdown(){ const el=document.getElementById('voiceQRCountdown'); if (el) el.textContent = String(qrCountdown); }
  function showQR(base64){ const container=document.getElementById('voiceQRContainer'); if(container){ container.innerHTML = base64 ? `<img src="${base64}" style="max-width:240px;">` : '<div class="ui text">Sem QR</div>'; } }

  async function voiceCreate(btn){
    try {
      if (btn) btn.classList.add('loading','disabled');
      const token = getLocalStorageItem('token');
      const res = await fetch('/integration/voice/create', { method:'POST', headers:{ 'token': token }});
      const j = await res.json();
      if (!res.ok || !j.qr_base64 && !j.QRBase64) throw new Error(j.error||'Falha ao criar');
      const b64 = j.qr_base64 || j.QRBase64; showQR(b64); startQRCountdown();
      $('#modalVoiceQR').modal('show');
      if (createBtn) createBtn.classList.add('disabled');
    } catch(err){ showError(err.message||'Erro ao criar'); }
    finally { if (btn) btn.classList.remove('loading','disabled'); }
  }

  async function voiceRefresh(btn){
    try {
      if (btn) btn.classList.add('loading','disabled');
      const token = getLocalStorageItem('token');
      const res = await fetch('/integration/voice/refresh', { method:'POST', headers:{ 'token': token }});
      const j = await res.json();
      if (!res.ok || !j.qr_base64 && !j.QRBase64) throw new Error(j.error||'Falha ao atualizar QR');
      const b64 = j.qr_base64 || j.QRBase64; showQR(b64); startQRCountdown();
      if (!$('#modalVoiceQR').modal('is active')) { $('#modalVoiceQR').modal('show'); }
    } catch(err){ showError(err.message||'Erro ao atualizar QR'); }
    finally { if (btn) btn.classList.remove('loading','disabled'); }
  }

  async function voiceStatus(btn){
    try {
      if (btn) btn.classList.add('loading','disabled');
      const token = getLocalStorageItem('token');
      const res = await fetch('/integration/voice/status', { headers:{ 'token': token }});
      const j = await res.json();
      const status = j.status || j.wavoip_status || 'desconhecido';
      const el = document.getElementById('voiceStatusText'); if (el) el.textContent = status;
      showSuccess('Status: '+status);
      // Após verificar, recarrega info do Supabase para refletir mudanças
      setTimeout(loadVoiceInfo, 300);
    } catch(err){ showError('Erro ao consultar status'); }
    finally { if (btn) btn.classList.remove('loading','disabled'); }
  }

  async function voiceDelete(btn){
    try {
      if (btn) btn.classList.add('loading','disabled');
      const token = getLocalStorageItem('token');
      const res = await fetch('/integration/voice/delete', { method:'POST', headers:{ 'token': token }});
      const j = await res.json();
      if (!res.ok || !j.success) throw new Error(j.error||'Falha ao excluir');
      showSuccess('Stevo Voice excluído'); if (createBtn) createBtn.classList.remove('disabled');
    } catch(err){ showError(err.message||'Erro ao excluir'); }
    finally { if (btn) btn.classList.remove('loading','disabled'); }
  }

  if (createBtn) createBtn.addEventListener('click', function(e){ voiceCreate(e.currentTarget); });
  if (refreshBtn) refreshBtn.addEventListener('click', function(e){ voiceRefresh(e.currentTarget); });
  if (statusBtn) statusBtn.addEventListener('click', function(e){ voiceStatus(e.currentTarget); });
  if (deleteBtn) deleteBtn.addEventListener('click', function(e){ voiceDelete(e.currentTarget); });
  if (voiceQRRefreshBtn) voiceQRRefreshBtn.addEventListener('click', function(e){ voiceRefresh(e.currentTarget); });
  if (voiceQRStatusBtn) voiceQRStatusBtn.addEventListener('click', function(e){ voiceStatus(e.currentTarget); });
  if (voiceQRBackBtn) voiceQRBackBtn.addEventListener('click', function(){
    try { $('#modalVoiceQR').modal('hide'); } catch(_){ }
    // Reabrir o modal de configurações GHL diretamente na aba Stevo Voice
    try {
      $('#modalGHLSettings').modal({
        onVisible: function(){ $('.menu .item').tab('change tab', 'ghl-voice-stevo'); },
        onApprove: function(){ return false; }
      }).modal('show');
      // garante que a aba correta esteja ativa
      setTimeout(function(){ $('.menu .item').tab('change tab', 'ghl-voice-stevo'); }, 50);
    } catch(_){ }
  });
  if (copyTokenBtn) copyTokenBtn.addEventListener('click', async ()=>{
    const txt = document.getElementById('voiceTokenText')?.textContent||'';
    if (!txt || txt==='-') return;
    const ok = await copyToClipboard(txt.trim());
    if (ok) showSuccess('Token copiado'); else showError('Falha ao copiar');
  });

  // Hidratar UI Stevo Voice ao abrir modal: quando for exibido, buscar info atual
  document.addEventListener('click', function(e){ if (e.target && e.target.id === 'ghlGeneralSettings') { setTimeout(loadVoiceInfo, 300); } });

  async function loadVoiceInfo(){
    try {
      const token = getLocalStorageItem('token');
      const res = await fetch('/integration/voice/info', { headers:{ 'token': token }});
      const j = await res.json();
      const status = j.wavoip_status || '';
      const number = j.id_wavoip || '-';
      const vtoken = j.wavoip_token || '-';
      const statusEl = document.getElementById('voiceStatusText'); if (statusEl) statusEl.textContent = status || 'desconhecido';
      const numEl = document.getElementById('voiceNumberText'); if (numEl) numEl.textContent = number || '-';
      const tokEl = document.getElementById('voiceTokenText'); if (tokEl) tokEl.textContent = vtoken || '-';
      // Desabilitar Criar se já existe algo nas colunas
      if (createBtn) {
        const hasData = (vtoken && vtoken !== '-') || (number && number !== '-') || (status && status !== '');
        if (hasData) createBtn.classList.add('disabled'); else createBtn.classList.remove('disabled');
      }
    } catch(_){ /* ignore */ }
  }
  // também tentar carregar ao fim da página
  loadVoiceInfo();
});

// ===== Voice IA (OpenAI / ElevenLabs) =====
async function hydrateVoiceAI(){
  const token = getLocalStorageItem('token');
  try {
    const res = await fetch('/integration/voiceai/info', { headers:{ 'token': token }});
    const j = await res.json();
    if (j.openai_key !== undefined) document.getElementById('openaiKeyInput').value = j.openai_key || '';
    if (j.openai_gpt_voice) { setDropdownSelection('#openaiVoiceDropdown','#openaiVoiceMenu', j.openai_gpt_voice, j.openai_gpt_voice); document.getElementById('openaiVoiceSelected').textContent = j.openai_gpt_voice; }
    if (j.elevenlabs_key !== undefined) document.getElementById('elevenKeyInput').value = j.elevenlabs_key || '';
    if (j.elevenlabs_voice_id) { setDropdownSelection('#elevenVoiceDropdown','#elevenVoiceMenu', j.elevenlabs_voice_id, j.elevenlabs_voice_id); document.getElementById('elevenVoiceSelected').textContent = j.elevenlabs_voice_id; }
  } catch(_){ }

  bindVoiceAIHandlersOnce();
}

let _voiceAIBound = false;
function bindVoiceAIHandlersOnce(){ if (_voiceAIBound) return; _voiceAIBound = true;
  const token = getLocalStorageItem('token');
  $('#openaiVoiceDropdown').dropdown();
  $('#elevenVoiceDropdown').dropdown();

  const loadOpenAI = document.getElementById('loadOpenAIVoicesBtn');
  if (loadOpenAI) loadOpenAI.addEventListener('click', async function(e){
    const btn = e.currentTarget; btn.classList.add('loading','disabled');
    try {
      const key = (document.getElementById('openaiKeyInput').value||'').trim();
      let res = await fetch('/integration/voiceai/voices', { method:'POST', headers:{ 'Content-Type':'application/json','token': token }, body: JSON.stringify({ provider:'openai', api_key: key||undefined })});
      if (!res.ok) res = await fetch('/integration/ghl/voices', { method:'POST', headers:{ 'Content-Type':'application/json','token': token }, body: JSON.stringify({ provider:'openai', api_key: key||undefined })});
      const j = await res.json();
      fillVoiceMenu('#openaiVoiceMenu', '#openaiVoiceDropdown', '#openaiVoiceSelected', j.voices||[]);
    } catch(_){ showError('Falha ao carregar vozes OpenAI'); }
    finally { btn.classList.remove('loading','disabled'); }
  });

  const loadEleven = document.getElementById('loadElevenVoicesBtn');
  if (loadEleven) loadEleven.addEventListener('click', async function(e){
    const btn = e.currentTarget; btn.classList.add('loading','disabled');
    try {
      const key = (document.getElementById('elevenKeyInput').value||'').trim();
      let res = await fetch('/integration/voiceai/voices', { method:'POST', headers:{ 'Content-Type':'application/json','token': token }, body: JSON.stringify({ provider:'elevenlabs', api_key: key||undefined })});
      if (!res.ok) res = await fetch('/integration/ghl/voices', { method:'POST', headers:{ 'Content-Type':'application/json','token': token }, body: JSON.stringify({ provider:'elevenlabs', api_key: key||undefined })});
      const j = await res.json();
      fillVoiceMenu('#elevenVoiceMenu', '#elevenVoiceDropdown', '#elevenVoiceSelected', j.voices||[]);
    } catch(_){ showError('Falha ao carregar vozes ElevenLabs'); }
    finally { btn.classList.remove('loading','disabled'); }
  });

  const saveBtn = document.getElementById('saveVoiceAISettings');
  if (saveBtn) saveBtn.addEventListener('click', async function(e){
    const btn = e.currentTarget; btn.classList.add('loading','disabled');
    try {
      const openaiKey = (document.getElementById('openaiKeyInput').value||'').trim();
      const openaiVoiceId = (document.getElementById('openaiVoiceValue').value||'').trim();
      const elKey = (document.getElementById('elevenKeyInput').value||'').trim();
      const elVoiceId = (document.getElementById('elevenVoiceValue').value||'').trim();
      // Enviar campos explicitamente; strings vazias indicam limpeza
      const payload = {
        openai_key: openaiKey,
        openai_gpt_voice: openaiVoiceId,
        elevenlabs_keys: elKey, // backend aceita limpar/atualizar e mapeia para elevenlabs_key
        elevenlabs_voice_id: elVoiceId
      };
      const res = await fetch('/integration/voiceai/save', { method:'POST', headers:{ 'Content-Type':'application/json','token': token }, body: JSON.stringify(payload)});
      if (!res.ok) throw new Error('save failed');
      // Recarrega estado salvo para garantir persistência visual
      await hydrateVoiceAI();
      showSuccess('Configurações de Voice IA salvas');
    } catch(_){ showError('Falha ao salvar Voice IA'); }
    finally { btn.classList.remove('loading','disabled'); }
  });
}

function fillVoiceMenu(menuSel, dropdownSel, labelSel, voices){
  const $menu = $(menuSel); $menu.empty();
  voices.forEach(v => { const name = v.name || v.id; const id = v.id; $menu.append(`<div class="item" data-value="${id}">${name}</div>`); });
  $(dropdownSel).dropdown('refresh');
  $(dropdownSel).dropdown({ onChange: function(val, text){ $(labelSel).text(text||val||''); $(dropdownSel+' input[type=hidden]').val(val||''); } });
}

function setDropdownSelection(dropdownSel, menuSel, id, name){
  const $menu = $(menuSel);
  if ($menu.find(`[data-value='${id}']`).length === 0) { $menu.append(`<div class="item" data-value="${id}">${name||id}</div>`); }
  $(dropdownSel).dropdown('refresh');
  $(dropdownSel).dropdown('set selected', id);
}

async function addInstance(data) {
  console.log("Add Instance...");
  const admintoken = getLocalStorageItem('admintoken');
  const myHeaders = new Headers();
  myHeaders.append('authorization', admintoken);
  myHeaders.append('Content-Type', 'application/json');
  
  // Build proxy configuration
  const proxyEnabled = data.proxy_enabled === 'on' || data.proxy_enabled === true;
  const proxyConfig = {
    enabled: proxyEnabled,
    proxyURL: proxyEnabled ? (data.proxy_url || '') : ''
  };
  
  // S3 removed from UI: always disabled
  const s3Config = { enabled: false };
  
  const payload = {
    name: data.name,
    token: data.token,
    events: data.events.join(','),
    webhook: data.webhook_url || '',
    expiration: 0,
    proxyConfig: proxyConfig,
    s3Config: s3Config
  };
  
  console.log("Payload being sent:", payload);
  
  res = await fetch(baseUrl + "/admin/users", {
    method: "POST",
    headers: myHeaders,
    body: JSON.stringify(payload)
  });
  
  const responseData = await res.json();
  console.log("Response:", responseData);
  return responseData;
}

function webhookModal() {
  getWebhook().then((response)=>{
    if(response.success==true) {
      $('#webhookEvents').val(response.data.subscribe);
      $('#webhookEvents').dropdown('set selected', response.data.subscribe);
      $('#webhookinput').val(response.data.webhook);
      $('#modalSetWebhook').modal({onApprove: function() {
        setWebhook().then((result)=>{
          if(result.success===true) {
             $.toast({ class: 'success', message: `Webhook set successfully !`});
          } else {
             $.toast({ class: 'error', message: `Problem setting webhook: ${result.error}`});
          }
        });
        return true;
      }}).modal('show');
    }
  });
}

function modalPairPhone() {
  $('#modalLoginWithCode').modal({
     onVisible: function() {
       document.getElementById('pairInfo').classList.remove('hidden');;
       document.getElementById('pairHelp').classList.remove('hidden');;
     },
     onHidden: function() {
       if(scanned==true) {
           document.getElementById('loginQR').classList.add('hidden');
           document.getElementById('loginCode').classList.add('hidden');
           document.getElementById('logoutWidget').classList.remove('hidden');
       }
     }
   })
   .modal('show');
}

function handleRegularLogin(token,notifications=false) {
  console.log('Regular login with token:', token);
  setLocalStorageItem('token', token, 6);
  removeLocalStorageItem('isAdmin');
  $('.adminlogin').hide();
  return statusRequest()
  .then((status) => {
    if(status.success==true) {
      console.log(status.data);
      setLocalStorageItem('currentInstance', status.data.id, 6);
      // Save current user JID for groups functionality
      if(status.data.jid) {
        setLocalStorageItem('currentUserJID', status.data.jid, 6);
        window.currentUserJID = status.data.jid;
      }
      populateInstances([status.data]);
      showRegularUser();
      $('.logingrid').addClass('hidden');
      $('.admingrid').addClass('hidden');
      $('.maingrid').removeClass('hidden');
      $('.adminlogin').hide();
      showWidgets();
      $('#'+status.data.instanceId).removeClass('hidden');
      updateUser();
    } else {
      removeLocalStorageItem('token');
      showError("Invalid credentials");
      $('#loginToken').focus();
    }
  })
  .catch((err) => {
    console.error('Auto login failed:', err);
    removeLocalStorageItem('token');
    // Fallback seguro: volta para tela de login
    hideWidgets();
    $('.maingrid').addClass('hidden');
    $('.admingrid').addClass('hidden');
    $('.logingrid').removeClass('hidden');
    showError('Falha ao autenticar automaticamente. Tente novamente.');
  });
}
  
function updateUser() {
  // retrieves one instance status at regular interval
  status().then((result)=> {
    if(result.success==true) {
      // Save current user JID for groups functionality
      if(result.data.jid) {
        setLocalStorageItem('currentUserJID', result.data.jid, 6);
        window.currentUserJID = result.data.jid;
      }
      // Update header logo if available
      try {
          const logo = (result.data.logo_url || '').trim();
        const el = document.getElementById('instanceLogo');
        if (el) {
          const finalUrl = logo || 'https://storage.googleapis.com/msgsndr/2cDhyWVcBPF6fKMDd4fi/media/689c31d3df61c23b596f0131.png';
          if (el.src !== finalUrl) el.src = finalUrl;
        }
        const input = document.getElementById('logoUrlInput');
        if (input) input.value = logo;
        try { localStorage.setItem('logo:'+getLocalStorageItem('currentInstance'), JSON.stringify({url: logo})); } catch(_){}
      } catch (_) {}
      populateInstances([result.data]);
    } 
  });
  clearTimeout(updateUserTimeout)
  updateUserTimeout = setTimeout(function() { updateUser() }, updateInterval);
}

function updateAdmin() {
  // retrieves all instances status at regular intervals
  const current = getLocalStorageItem("currentInstance")
  if(!current) {
    // get all instances status
    getUsers().then((result) => {
      if(result.success==true) {
        populateInstances(result.data)
      } 
    });
  } else {
    // get only active instance status
    status().then((result)=> {
      if(result.success==true) {
        // Atualiza a logo do header de acordo com a instância atual
        try {
          const logo = (result.data.logo_url || '').trim();
          const el = document.getElementById('instanceLogo');
          if (el) {
            const finalUrl = logo || 'https://storage.googleapis.com/msgsndr/2cDhyWVcBPF6fKMDd4fi/media/689c31d3df61c23b596f0131.png';
            if (el.src !== finalUrl) el.src = finalUrl;
          }
          const input = document.getElementById('logoUrlInput');
          if (input) input.value = logo;
          try { localStorage.setItem('logo:'+getLocalStorageItem('currentInstance'), JSON.stringify({url: logo})); } catch(_){}
        } catch (_) {}
        populateInstances([result.data]);
      } 
    });
  }
  clearTimeout(updateAdminTimeout)
  updateAdminTimeout = setTimeout(function() { updateAdmin() }, updateInterval);
}

function handleAdminLogin(token,notifications=false) {
  console.log('Admin login with token:', token);
  setLocalStorageItem('admintoken', token, 6);
  setLocalStorageItem('isAdmin', true, 6);
  $('.adminlogin').show();
  const currentInstance = getLocalStorageItem("currentInstance");

  return getUsers()
  .then((result) => {
    if(result.success==true) {

      showAdminUser();

      if(currentInstance == null) {
        $('.admingrid').removeClass('hidden');
        populateInstances(result.data);
      } else {
        populateInstances(result.data);
        $('.maingrid').removeClass('hidden');
        showWidgets();
        const showInstanceId=`instance-card-${currentInstance}`
        $('#'+showInstanceId).removeClass('hidden');
      }
      $('#loading').removeClass('active');
      $('.logingrid').addClass('hidden');
      updateAdmin();
    } else {
      removeLocalStorageItem('admintoken');
      removeLocalStorageItem('token');
      removeLocalStorageItem('isAdmin');
      showError("Admin login failed");
      $('#loginToken').focus();
    }
  })
  .catch((err) => {
    console.error('Admin auto login failed:', err);
    removeLocalStorageItem('admintoken');
    removeLocalStorageItem('token');
    removeLocalStorageItem('isAdmin');
    hideWidgets();
    $('.maingrid').addClass('hidden');
    $('.admingrid').addClass('hidden');
    $('.logingrid').removeClass('hidden');
    showError('Falha ao autenticar como admin automaticamente. Informe o token.');
  });
}
    
function showError(message) {
  $('body').toast({
    class: 'error',
    message: message,
    showIcon: 'exclamation circle',
    position: 'top center',
    showProgress: 'bottom'
  });
}
    
function showSuccess(message) {
  $('body').toast({
    class: 'success',
    message: message,
    showIcon: 'check circle',
    position: 'top center',
    showProgress: 'bottom'
  });
}

function deleteInstance(id) {
  instanceToDelete = id;
  $('#deleteInstanceModal').modal({
    onApprove: function() {
      performDelete(instanceToDelete);
    }
  }).modal('show');
}

async function performDelete(id) {
  console.log('Deleting instance with ID:', id);
  const admintoken = getLocalStorageItem('admintoken');
  const myHeaders = new Headers();
  myHeaders.append('authorization', admintoken);
  myHeaders.append('Content-Type', 'application/json');
  res = await fetch(baseUrl + "/admin/users/"+id+"/full", {
    method: "DELETE",
    headers: myHeaders
  });
  data = await res.json();
  if(data.success===true) {
    $('#instance-row-' + id).remove();
    showDeleteSuccess();
  } else {
    showError('Error deleting instance');
  }
}

function showDeleteSuccess() {
  $('body').toast({
    class: 'success',
    message: 'Instance deleted successfully',
    position: 'top right',
    showProgress: 'bottom'
  });
}

function openDashboard(id,token) {
  setLocalStorageItem('currentInstance', id, 6);
  setLocalStorageItem('token', token, 6);
  $(`#instance-card-${id}`).removeClass('hidden');
  console.log($(`#instance-card-${id}`));
  showWidgets();
  $('.admingrid').addClass('hidden');
  $('.maingrid').removeClass('hidden');
  $('.card.no-hover').addClass('hidden');
  $(`#instance-card-${id}`).removeClass('hidden');
  $('.adminlogin').show();
  // Assim que abrir, força atualização da logo para esta instância
  status().then((result)=>{
    if (result && result.success && result.data) {
      try {
        const logo = (result.data.logo_url || '').trim();
        const el = document.getElementById('instanceLogo');
        if (el) {
          el.src = logo || 'https://storage.googleapis.com/msgsndr/2cDhyWVcBPF6fKMDd4fi/media/689c31d3df61c23b596f0131.png';
        }
        const input = document.getElementById('logoUrlInput');
        if (input) input.value = logo;
      } catch (_) {}
    }
  });
}

function goBackToList() {
  $('#instances-cards > div').addClass('hidden');
  removeLocalStorageItem('currentInstance');
  currentInstanceData = null; // Clear instance data
  updateAdmin();
  removeLocalStorageItem('token');
  hideWidgets();
  $('.maingrid').addClass('hidden');
  $('.admingrid').removeClass('hidden');
  $('.adminlogin').hide();
}

async function sendTextMessage() {
  const token = getLocalStorageItem('token');
  const sendPhone = document.getElementById('messagesendphone').value.trim();
  const sendBody = document.getElementById('messagesendtext').value;
  const myHeaders = new Headers();
  const uuid = generateMessageUUID();
  myHeaders.append('token', token);
  myHeaders.append('Content-Type', 'application/json');
  res = await fetch(baseUrl + "/chat/send/text", {
    method: "POST",
    headers: myHeaders,
    body: JSON.stringify({Phone: sendPhone, Body: sendBody, Id: uuid})
  });
  data = await res.json();
  return data;
}
 
async function deleteMessage() {
  const deletePhone = document.getElementById('messagedeletephone').value.trim();
  const deleteId = document.getElementById('messagedeleteid').value;
  const myHeaders = new Headers();
  myHeaders.append('token', token);
  myHeaders.append('Content-Type', 'application/json');
  res = await fetch(baseUrl + "/chat/delete", {
    method: "POST",
    headers: myHeaders,
    body: JSON.stringify({Phone: deletePhone, Id: deleteId})
  });
  data = await res.json();
  return data;
}
 
async function setWebhook() {
  const token = getLocalStorageItem('token');
  const webhook = document.getElementById('webhookinput').value.trim();
  const events = $('#webhookEvents').dropdown('get value')
  if (events.includes("All")) {
    events.length = 0;
    events.push("All");
  }
  const myHeaders = new Headers();
  myHeaders.append('token', token);
  myHeaders.append('Content-Type', 'application/json');
  res = await fetch(baseUrl + "/webhook", {
    method: "POST",
    headers: myHeaders,
    body: JSON.stringify({webhookurl: webhook, events: events})
  });
  data = await res.json();
  return data;
}
 
function doUserAvatar() {
  const userAvatarInput = document.getElementById('useravatarinput');
  let phone = userAvatarInput.value.trim();
  if (phone) {
    if (!phone.endsWith('@s.whatsapp.net')) {
      phone = phone.includes('@') ? phone.split('@')[0] + '@s.whatsapp.net' : phone + '@s.whatsapp.net';
    }
    userAvatar(phone).then((data) => {
      document.getElementById("userAvatarContainer").classList.remove('hidden');
      if (data.success && data.data && data.data.url) {
        const userAvatarDiv = document.getElementById('userAvatarContainer');
        userAvatarDiv.innerHTML=`<img src="${data.data.url}" alt="Profile Picture" class="user-avatar">`;
      } else {
          document.getElementById('userAvatarContainer').innerHTML = 'No user avatar found';
      }
    }).catch(error => {
      document.getElementById('userAvatarContainer').innerHTML = 'Error fetching user avatar';
      console.error('Error:', error);
    });
  }
} 

function doUserInfo() {
  const userInfoInput = document.getElementById('userinfoinput');
  let phone = userInfoInput.value.trim();
  if (phone) {
    if (!phone.endsWith('@s.whatsapp.net')) {
      phone = phone.includes('@') ? phone.split('@')[0] + '@s.whatsapp.net' : phone + '@s.whatsapp.net';
    }
    userInfo(phone).then((data) => {
      document.getElementById("userInfoContainer").classList.remove('hidden');
      if (data.success && data.data && data.data.Users) {
          const userInfoDiv = document.getElementById('userInfoContainer');
          userInfoDiv.innerHTML = '';
          
          for (const [userJid, userData] of Object.entries(data.data.Users)) {
              const userElement = document.createElement('div');
              userElement.className = 'user-entry';
              
              const phoneNumber = userJid.split('@')[0];
              userElement.innerHTML += `<strong>Phone: ${phoneNumber}</strong><br>`;
              userElement.innerHTML += `Status: ${userData.Status || 'Not available'}<br>`;
              userElement.innerHTML += `Verified Name: ${userData.VerifiedName || 'Not verified'}<br>`;
              if (userData.Devices && userData.Devices.length > 0) {
                  userElement.innerHTML += `Devices: ${userData.Devices.length}<br>`;
              }
              userInfoDiv.appendChild(userElement);
          }
      } else {
          document.getElementById('userInfoContainer').innerHTML = 'No user data found';
      }
    }).catch(error => {
      document.getElementById('userInfoContainer').innerHTML = 'Error fetching user info';
      console.error('Error:', error);
    });
  }
}

function showWidgets() {
  document.querySelectorAll('.widget').forEach(widget => {
    widget.classList.remove('hidden');
  });
}

function hideWidgets() {
  document.querySelectorAll('.widget').forEach(widget => {
    widget.classList.add('hidden');
  });
}

async function connect(token='') {
  console.log("Connecting...");
  if(token=='') {
     token = getLocalStorageItem('token');
  }
  const myHeaders = new Headers();
  myHeaders.append('token', token);
  myHeaders.append('Content-Type', 'application/json');
  res = await fetch(baseUrl + "/session/connect", {
    method: "POST",
    headers: myHeaders,
    body: JSON.stringify({Subscribe: ['All'], Immediate: true})
  });
  data = await res.json();
  updateInterval=1000; // Decrease interval to react quicker to QR scan
  return data;
}

async function disconnect(token) {
  console.log("Disconnecting...");
  if(token=='') {
     token = getLocalStorageItem('token');
  }
  const myHeaders = new Headers();
  myHeaders.append('token', token);
  myHeaders.append('Content-Type', 'application/json');
  res = await fetch(baseUrl + "/session/disconnect", {
    method: "POST",
    headers: myHeaders,
  });
  data = await res.json();
  return data;
}

async function status() {
  console.log("Get status...");
  const token = getLocalStorageItem('token');
  const myHeaders = new Headers();
  myHeaders.append('token', token);
  myHeaders.append('Content-Type', 'application/json');
  res = await fetch(baseUrl + "/session/status", {
    method: "GET",
    headers: myHeaders
  });
  data = await res.json();
  if(data.data.loggedIn==true) updateInterval=5000;
  return data;
}

async function getUsers() {
  console.log("Get users...");
  const admintoken = getLocalStorageItem('admintoken');
  const myHeaders = new Headers();
  myHeaders.append('authorization', admintoken);
  myHeaders.append('Content-Type', 'application/json');
  res = await fetch(baseUrl + "/admin/users", {
    method: "GET",
    headers: myHeaders
  });
  data = await res.json();
  return data;
}

async function getWebhook(token='') {
  console.log("Getting webhook...");
  if(token=='') {
    token = getLocalStorageItem('token');
  }
  const myHeaders = new Headers();
  myHeaders.append('token', token);
  myHeaders.append('Content-Type', 'application/json');
  try {
    const res = await fetch(baseUrl + "/webhook", {
      method: "GET",
      headers: myHeaders,
    });
    data = await res.json();
    return data;
  } catch (error) {
    return '{}';
    throw error;
  }
}

async function getContacts() {
  console.log("Getting contacts...");
  const token = getLocalStorageItem('token');
  const myHeaders = new Headers();
  myHeaders.append('token', token);
  myHeaders.append('Content-Type', 'application/json');
  try {
    const res = await fetch(baseUrl + "/user/contacts", {
      method: "GET",
      headers: myHeaders,
    });
    data = await res.json();
    if (data.code === 200) {
      const transformedContacts = Object.entries(data.data).map(([phone, contact]) => ({
          FullName: contact.FullName || "",
          PushName: contact.PushName || "",
          Phone: phone.split('@')[0] // Remove the @s.whatsapp.net part
      }));
      downloadJson(transformedContacts, 'contacts.json');
      return transformedContacts;
    } else {
      throw new Error(`API returned code ${data.code}`);
    }
  } catch (error) {
    console.error("Error fetching contacts:", error);
    throw error;
  }
}

async function userAvatar(phone) {
  console.log("Requesting user avatar...");
  const token = getLocalStorageItem('token');
  const myHeaders = new Headers();
  myHeaders.append('token', token);
  myHeaders.append('Content-Type', 'application/json');
  res = await fetch(baseUrl + "/user/avatar", {
    method: "POST",
    headers: myHeaders,
    body: JSON.stringify({Phone: phone, Preview: false})
  });
  data = await res.json();
  return data;
}

async function userInfo(phone) {
  console.log("Requesting user info...");
  const token = getLocalStorageItem('token');
  const myHeaders = new Headers();
  myHeaders.append('token', token);
  myHeaders.append('Content-Type', 'application/json');
  res = await fetch(baseUrl + "/user/info", {
    method: "POST",
    headers: myHeaders,
    body: JSON.stringify({Phone: [phone]})
  });
  data = await res.json();
  return data;
}

async function pairPhone(phone) {
  console.log("Requesting pairing code...");
  const token = getLocalStorageItem('token');
  const myHeaders = new Headers();
  myHeaders.append('token', token);
  myHeaders.append('Content-Type', 'application/json');
  res = await fetch(baseUrl + "/session/pairphone", {
    method: "POST",
    headers: myHeaders,
    body: JSON.stringify({Phone: phone})
  });
  data = await res.json();
  return data;
}

async function logout(token='') {
  console.log("Login out...");
  if(token=='') {
    token = getLocalStorageItem('token');
  }
  const myHeaders = new Headers();
  myHeaders.append('token', token);
  myHeaders.append('Content-Type', 'application/json');
  res = await fetch(baseUrl + "/session/logout", {
    method: "POST",
    headers: myHeaders,
  });
  data = await res.json();
  return data;
}

async function getQr() {
  const myHeaders = new Headers();
  const token = getLocalStorageItem('token');
  myHeaders.append('token', token);
  res = await fetch(baseUrl + "/session/qr", {
    method: "GET",
    headers: myHeaders,
  });
  data = await res.json();
  return data;
}

async function statusRequest() {
  const myHeaders = new Headers();
  const token = getLocalStorageItem('token');
  const isAdminLogin = getLocalStorageItem('isAdmin');
  if(token!=null && isAdminLogin==null) {
    myHeaders.append('token', token);
    res = await fetch(baseUrl + "/session/status", {
      method: "GET",
      headers: myHeaders,
    });
    data = await res.json();
    return data;
  }
}

function parseURLParams(url) {
  var queryStart = url.indexOf("?") + 1,
      queryEnd   = url.indexOf("#") + 1 || url.length + 1,
      query = url.slice(queryStart, queryEnd - 1),
      pairs = query.replace(/\+/g, " ").split("&"),
      parms = {}, i, n, v, nv;

  if (query === url || query === "") return;
    for (i = 0; i < pairs.length; i++) {
      nv = pairs[i].split("=", 2);
      n = decodeURIComponent(nv[0]);
      v = decodeURIComponent(nv[1]);
      if (!parms.hasOwnProperty(n)) parms[n] = [];
      parms[n].push(nv.length === 2 ? v : null);
  }
  return parms;
}

function downloadJson(data, filename) {
  const jsonStr = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  
  // Cleanup
  setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  }, 100);
}

function generateMessageUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function init() { 

  // Starting
  let notoken=0;
  let scanInterval;
  // Deep-link via URL or hash: ?token=...&instance=... [&admin=1] [&chat=1]
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const hash = window.location.hash ? window.location.hash.substring(1) : '';
    const hashParams = new URLSearchParams(hash);
    const tokenFromUrl = urlParams.get('token') || urlParams.get('t') || hashParams.get('token') || hashParams.get('t');
    const instanceFromUrl = urlParams.get('instance') || urlParams.get('id') || hashParams.get('instance') || hashParams.get('id');
    const adminFlag = (urlParams.get('admin') || hashParams.get('admin') || '').toLowerCase();
    const chatFlag = urlParams.get('chat') || hashParams.get('chat');

    if (tokenFromUrl) {
      if (instanceFromUrl) {
        setLocalStorageItem('currentInstance', instanceFromUrl, 6);
      }
      // Prefer hash usage to avoid server logs; in any case, clean URL afterwards
      history.replaceState({}, document.title, window.location.pathname);
      const loginPromise = (adminFlag === '1' || adminFlag === 'true' || adminFlag === 'yes')
        ? handleAdminLogin(tokenFromUrl)
        : handleRegularLogin(tokenFromUrl);
      // Show loading state while trying auto-login
      try { $('#loading').addClass('active'); } catch (_) {}
      Promise.resolve(loginPromise).finally(()=>{
        try { $('#loading').removeClass('active'); } catch (_) {}
        
        // Auto-abrir chat se o parâmetro chat=1 estiver presente
        if (chatFlag === '1' || chatFlag === 'true') {
          setTimeout(() => {
            autoOpenChatFromUrl(instanceFromUrl, tokenFromUrl);
          }, 2000); // Aguardar 2 segundos para garantir que a interface foi carregada
        }
      });
      return;
    }
  } catch (_) { /* noop */ }

  let token = getLocalStorageItem('token');
  let admintoken = getLocalStorageItem('admintoken');
  let isAdminLogin = getLocalStorageItem('isAdmin');
  $('.adminlogin').hide();

  if(token == null && admintoken == null) {
    $('.logingrid').removeClass('hidden');
    $('.maingrid').addClass('hidden');
  } else {
    if (isAdminLogin) {
      handleAdminLogin(admintoken);
    } else {
      handleRegularLogin(token);
    }
  }
}

function populateInstances(instances) {
  const tableBody = $('#instances-body');
  const cardsContainer = $('#instances-cards'); // Assuming you have a container for cards
  tableBody.empty();
  cardsContainer.empty();
  const currentInstance = getLocalStorageItem('currentInstance');
  // cache and bind filters
  instancesCache = Array.isArray(instances) ? instances.slice() : [];
  bindInstanceFiltersOnce();
  applyInstanceFilters();
}

let _filtersBound = false;
function bindInstanceFiltersOnce(){
  if (_filtersBound) return; _filtersBound = true;
  const debounced = debounce(applyInstanceFilters, 250);
  $('#instancesSearch').on('input', debounced);
  $('#filterConnected').on('change', applyInstanceFilters);
  $('#filterLoggedIn').on('change', applyInstanceFilters);
  $('#instancesFiltersClear').on('click', function(){
    $('#instancesSearch').val('');
    try { $('#filterConnected').dropdown('clear'); } catch(_) { $('#filterConnected').val(''); }
    try { $('#filterLoggedIn').dropdown('clear'); } catch(_) { $('#filterLoggedIn').val(''); }
    applyInstanceFilters();
  });
}

function applyInstanceFilters(){
  const q = ($('#instancesSearch').val()||'').toLowerCase().trim();
  const fConn = $('#filterConnected').val();
  const fLogin = $('#filterLoggedIn').val();

  let list = instancesCache.slice();
  if (q) {
    list = list.filter(it => (it.id||'').toLowerCase().includes(q) || (it.name||'').toLowerCase().includes(q));
  }
  if (fConn !== '' && fConn !== null && typeof fConn !== 'undefined') {
    const want = (fConn === 'true');
    list = list.filter(it => !!it.connected === want);
  }
  if (fLogin !== '' && fLogin !== null && typeof fLogin !== 'undefined') {
    const want = (fLogin === 'true');
    list = list.filter(it => !!it.loggedIn === want);
  }

  updateInstancesStats(instancesCache); // Always calculate stats from all instances
  renderInstances(list);
}

function updateInstancesStats(instances) {
  if (!instances || !Array.isArray(instances)) {
    // Hide stats if no data
    $('#instances-stats-bar').hide();
    return;
  }

  const total = instances.length;
  const connected = instances.filter(inst => !!inst.connected).length;
  const disconnected = total - connected;
  const loggedIn = instances.filter(inst => !!inst.loggedIn).length;

  // Update the stats display
  $('#stat-total').text(total);
  $('#stat-connected').text(connected);
  $('#stat-disconnected').text(disconnected);
  $('#stat-logged-in').text(loggedIn);

  // Show stats bar
  $('#instances-stats-bar').show();
}

function renderInstances(list){
  const tableBody = $('#instances-body');
  const cardsContainer = $('#instances-cards');
  tableBody.empty();
  cardsContainer.empty();

  if(!list || list.length===0) {
    const nodatarow = '<tr><td style="text-align:center;" colspan=5>No instances found</td></tr>'
    tableBody.append(nodatarow);
    return;
  }

  list.forEach(instance => {
    const row = `
        <tr>
          <td>${instance.id}</td>
          <td>${instance.name}</td>
          <td><i class="${instance.connected ? 'check green' : 'times red'} icon"></i> <span class="status ${instance.connected}">${instance.connected ? 'Yes' : 'No'}</span></td>
          <td><i class="${instance.loggedIn ? 'check green' : 'times red'} icon"></i> <span class="status ${instance.loggedIn}">${instance.loggedIn ? 'Yes' : 'No'}</span></td>
          <td>
            <button class="ui primary button dashboard-button" onclick="openDashboard('${instance.id}', '${instance.token}')">
              <i class="external alternate icon"></i> Open
            </button>
            <button class="ui negative button dashboard-button" onclick="deleteInstance('${instance.id}')">
              <i class="trash alternate icon"></i> Delete
            </button>
          </td>
        </tr>
    `;
    tableBody.append(row);

    const card = `
        <div class="ui fluid card hidden no-hover" id="instance-card-${instance.id}">
            <div class="content">
                <div class="ui ${instance.loggedIn ? 'one' : 'two'} column stackable grid">
                    <!-- Left Column - Instance Info -->
                    <div class="column">
                        <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
                          ${instance.profile_pic_url ? `<img src="${instance.profile_pic_url}" alt="avatar" style="width:48px;height:48px;border-radius:50%;object-fit:cover;border:1px solid rgba(255,255,255,0.1);"/>` : `<div class=\"chat-avatar\" style=\"width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#2b2f31;color:#9aa0a6;border:1px solid rgba(255,255,255,0.08);\">${(instance.name||'S').slice(0,1).toUpperCase()}</div>`}
                          <div>
                            <div class="header" style="font-size: 1.3em; margin-bottom: 0.25rem;">${instance.name}</div>
                            ${instance.profile_name ? `<div class="meta" style="opacity:.8;">${instance.profile_name}</div>` : ''}
                          </div>
                        </div>
                            <div class="ui labels" style="margin-top: 0.25em;">
                                <div class="ui ${instance.connected ? 'green' : 'red'} horizontal label">
                                    <i class="${instance.connected ? 'check' : 'times'} icon"></i>
                                    ${instance.connected ? 'Connected' : 'Disconnected'}
                                </div>
                                <div class="ui ${instance.loggedIn ? 'green' : 'red'} horizontal label">
                                    <i class="${instance.loggedIn ? 'check' : 'times'} icon"></i>
                                    ${instance.loggedIn ? 'Logged In' : 'Logged Out'}
                                </div>
                            </div>
                        
                        <div class="meta" style="margin-bottom: .5rem; opacity:.8;">Instance ID: ${instance.id}</div>
                        <div style="display:grid;grid-template-columns:160px 1fr;gap:6px 12px;align-items:center;">
                          <div style="opacity:.7;">Token</div>
                          <div style="display:flex;align-items:center;gap:8px;word-break:break-all;">
                            <span id="masked-token-${instance.id}">${maskToken(instance.token)}</span>
                            <button class="ui tiny basic button copy-token-btn" id="copy-token-${instance.id}" title="Copy token"><i class="copy icon"></i></button>
                          </div>
                          <div style="opacity:.7;">JID</div>
                          <div>${instance.jid || 'Not available'}</div>
                          <div style="opacity:.7;">Webhook</div>
                          <div style="word-break:break-all;">${instance.webhook || 'Not configured'}</div>
                          <div style="opacity:.7;">Subscribed Events</div>
                          <div>${instance.events || 'Not configured'}</div>
                          <div style="opacity:.7;">Proxy</div>
                          <div>${instance.proxy_config && instance.proxy_config.enabled ? 'Enabled' : 'Disabled'}</div>
                          <div style="opacity:.7;">Proxy URL</div>
                          <div>${instance.proxy_config ? (instance.proxy_config.proxy_url || 'Not configured') : 'Not configured'}</div>
                        </div>
                    </div>
                    ${!instance.loggedIn ? `
                    <div class="column" style="display: flex; flex-direction: column; justify-content: center; align-items: center;">
                        <div class="ui segment" style="width: 100%; max-width: 200px; height: 200px; display: flex; justify-content: center; align-items: center;">
                          ${instance.qrcode ? 
                            `<img src="${instance.qrcode}" style="max-height: 100%; max-width: 100%;">`
                            :
                            `<div class=\"ui icon header\" style=\"text-align: center;\">
                                    <i class=\"qrcode icon\" style=\"font-size: 3em;\"></i>
                                    <div class=\"sub header\">QR Code will appear here</div>
                               </div>`}
                        </div>
                        <div>
                          Open WhatsApp on your phone and tap<br/><i class="ellipsis vertical icon"></i>> Linked devices > Link a device.
                        </div>
                      </div>
                      ` : `
                      <!--one column when no qr to display-->
                      `}
                  </div>
              </div>
              
              <div class="extra content">
                <button class="ui primary positive button dashboard-button ${instance.connected === true ? 'hidden' : ''}" id="button-connect-${instance.id}" onclick="connect('${instance.token}')">Connect</button>
                <button class="ui primary negative button dashboard-button ${instance.connected === true ? '' : 'hidden'}" id="button-logout-${instance.id}" onclick="logout('${instance.token}')">Logout</button>
                <button class="ui blue button dashboard-button ${instance.connected === true && instance.loggedIn === true ? '' : 'hidden'}" id="button-chat-${instance.id}" onclick="openInstanceChat('${instance.id}', '${instance.token}', '${instance.name}')">
                  <i class="comments icon"></i> Chat
                </button>
                <button class="ui teal button dashboard-button ${instance.connected === true && instance.loggedIn === true ? '' : 'hidden'}" id="button-chat-link-${instance.id}" onclick="copyChatLink('${instance.id}', '${instance.token}', '${instance.name}')" title="Copiar link direto do chat">
                  <i class="linkify icon"></i> Link
                </button>
                <div class="ui toggle checkbox" style="margin-left:10px;">
                  <input type="checkbox" id="toggle-ignore-groups-${instance.id}" ${instance.ignore_groups ? 'checked' : ''}>
                  <label>Ignore group messages</label>
                </div>
                <button class="ui primary positive button dashboard-button ${instance.connected === true && instance.loggedIn === false ? '' : 'hidden'} id="button-logout-${instance.id}" onclick="modalPairPhone()">Login with Pairing Code</button>
                </div>
        </div>
        `;
    cardsContainer.append(card);
    setTimeout(() => {
      const el = document.getElementById(`toggle-ignore-groups-${instance.id}`);
      if (el) {
        el.addEventListener('change', async (e) => {
          try {
            const res = await fetch(baseUrl + '/settings/ignore-groups', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'token': instance.token },
              body: JSON.stringify({ ignore: e.target.checked })
            });
            if (!res.ok) throw new Error('Failed to update');
          } catch (err) {
            console.error(err);
            e.target.checked = !e.target.checked;
            alert('Failed to update ignore groups');
          }
        });
      }
      const copyBtn = document.getElementById(`copy-token-${instance.id}`);
      if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
          const ok = await copyToClipboard(String(instance.token || ''));
          if (ok) { showSuccess('Token copiado para a área de transferência'); }
          else { showError('Não foi possível copiar o token'); }
        });
      }
    }, 0);
  });

  // Keep previously selected card visible (if any)
  const currentInstance = getLocalStorageItem('currentInstance');
  if (currentInstance) {
    const showInstanceId = `instance-card-${currentInstance}`;
    try { $(`#${showInstanceId}`).removeClass('hidden'); } catch(_) {}
    const currentInstanceObj = list.find(inst => inst.id === currentInstance) || instancesCache.find(inst => inst.id === currentInstance);
    if (currentInstanceObj) { currentInstanceData = currentInstanceObj; }
  }
}

function debounce(fn, wait){
  let t; return function(){
    const args = arguments; const ctx = this;
    clearTimeout(t); t = setTimeout(()=>fn.apply(ctx,args), wait);
  }
}

function maskToken(token) {
  try {
    const s = String(token || '');
    if (s.length <= 6) return s;
    const visible = s.slice(-6);
    return '•••••••••••••••••••••••• ' + visible;
  } catch(_) {
    return String(token || '');
  }
}

/**
 * Set an item in localStorage with expiry time (in hours)
 * @param {string} key - Key to store under
 * @param {*} value - Value to store
 * @param {number} hours - Expiry time in hours (default: 1 hour)
 */
function setLocalStorageItem(key, value, hours = 1) {
  const now = new Date();
  const expiryTime = now.getTime() + hours * 60 * 60 * 1000; // Convert hours to milliseconds

  const item = {
    value: value,
    expiry: expiryTime,
  };

  localStorage.setItem(key, JSON.stringify(item));
}

/**
 * Get an item from localStorage. Returns null if expired or not found.
 * @param {string} key - Key to retrieve
 * @returns {*|null} - Stored value or null
 */
function getLocalStorageItem(key) {
  const itemStr = localStorage.getItem(key);
  if (!itemStr) return null;

  try {
    const item = JSON.parse(itemStr);
    const now = new Date().getTime();

    // Check if expired (only if the parsed item has an expiry property)
    if (item.expiry && now > item.expiry) {
      localStorage.removeItem(key); // Clean up expired item
      return null;
    }

    // Return value only if the parsed item has a value property
    return item.value !== undefined ? item.value : null;
  } catch (e) {
    // If JSON parsing fails, treat it as not found
    return null;
  }
}

/**
 * Remove an item from localStorage
 * @param {string} key - Key to remove
 */
function removeLocalStorageItem(key) {
  localStorage.removeItem(key);
}

/**
 * Clear all localStorage items (with or without expiry)
 */
function clearLocalStorage() {
  localStorage.clear();
}

function showAdminUser() {
  const indicator = document.getElementById('user-role-indicator');
  const text = document.getElementById('user-role-text');
  
  indicator.className = 'item admin';
  indicator.innerHTML = `
    <i class="user shield icon"></i>
    <div class="ui mini label">ADMIN</div>
  `;
}
  
function showRegularUser() {
  const indicator = document.getElementById('user-role-indicator');
  const text = document.getElementById('user-role-text');
  
  indicator.className = 'item user';
  indicator.innerHTML = `
    <i class="user icon"></i>
    <div class="ui mini label">USER</div>
  `;
}

// S3 Configuration Functions
async function loadS3Config() {
  // Check if we have instance data available (admin viewing specific instance)
  if (currentInstanceData && currentInstanceData.s3_config) {
    const s3Config = currentInstanceData.s3_config;
    const hasConfig = s3Config.enabled || s3Config.endpoint || s3Config.bucket;
    
    $('#s3Endpoint').val(s3Config.endpoint || '');
    $('#s3AccessKey').val(s3Config.access_key === '***' ? '' : s3Config.access_key || '');
    $('#s3SecretKey').val(''); // Never show secret key
    $('#s3Bucket').val(s3Config.bucket || '');
    $('#s3Region').val(s3Config.region || '');
    $('#s3ForcePathStyle').prop('checked', s3Config.path_style || false);
    $('#s3PublicUrl').val(s3Config.public_url || '');
    
    // Media delivery dropdown
    $('#s3MediaDelivery').dropdown('set selected', s3Config.media_delivery || 'base64');
    
    // Retention days
    $('#s3RetentionDays').val(s3Config.retention_days || 30);
    
    // Show/hide delete button based on whether config exists
    if (hasConfig) {
      $('#deleteS3Config').show();
    } else {
      $('#deleteS3Config').hide();
    }
    
    return;
  }
  
  // Fallback to API call for regular users or when instance data is not available
  const token = getLocalStorageItem('token');
  const myHeaders = new Headers();
  myHeaders.append('token', token);
  
  try {
    const res = await fetch(baseUrl + "/session/s3/config", {
      method: "GET",
      headers: myHeaders
    });
    
    if (res.ok) {
      const data = await res.json();
      if (data.code === 200 && data.data) {
        const hasConfig = data.data.enabled || data.data.endpoint || data.data.bucket;
        
        $('#s3Endpoint').val(data.data.endpoint || '');
        $('#s3AccessKey').val(data.data.access_key === '***' ? '' : data.data.access_key);
        $('#s3SecretKey').val(''); // Never show secret key
        $('#s3Bucket').val(data.data.bucket || '');
        $('#s3Region').val(data.data.region || '');
        $('#s3ForcePathStyle').prop('checked', data.data.path_style || false);
        $('#s3PublicUrl').val(data.data.public_url || '');
        
        // Media delivery dropdown
        $('#s3MediaDelivery').dropdown('set selected', data.data.media_delivery || 'base64');
        
        // Retention days
        $('#s3RetentionDays').val(data.data.retention_days || 30);
        
        // Show/hide delete button based on whether config exists
        if (hasConfig) {
          $('#deleteS3Config').show();
        } else {
          $('#deleteS3Config').hide();
        }
      } else {
        // No config found, hide delete button and set defaults
        $('#deleteS3Config').hide();
        $('#s3Endpoint').val('');
        $('#s3AccessKey').val('');
        $('#s3SecretKey').val('');
        $('#s3Bucket').val('');
        $('#s3Region').val('');
        $('#s3ForcePathStyle').prop('checked', false);
        $('#s3PublicUrl').val('');
        $('#s3MediaDelivery').dropdown('set selected', 'base64');
        $('#s3RetentionDays').val(30);
      }
    }
  } catch (error) {
    console.error('Error loading S3 config:', error);
    $('#deleteS3Config').hide();
  }
}

async function saveS3Config() {
  const token = getLocalStorageItem('token');
  const myHeaders = new Headers();
  myHeaders.append('token', token);
  myHeaders.append('Content-Type', 'application/json');
  
  const config = {
    enabled: true,
    endpoint: $('#s3Endpoint').val().trim(),
    access_key: $('#s3AccessKey').val().trim(),
    secret_key: $('#s3SecretKey').val().trim(),
    bucket: $('#s3Bucket').val().trim(),
    region: $('#s3Region').val().trim(),
    path_style: $('#s3ForcePathStyle').is(':checked'),
    public_url: $('#s3PublicUrl').val().trim(),
    media_delivery: $('#s3MediaDelivery').val() || 'base64',
    retention_days: parseInt($('#s3RetentionDays').val()) || 30
  };
  
  try {
    const res = await fetch(baseUrl + "/session/s3/config", {
      method: "POST",
      headers: myHeaders,
      body: JSON.stringify(config)
    });
    
    const data = await res.json();
    if (data.success) {
      showSuccess('S3 configuration saved successfully');
      // Show delete button since we now have a configuration
      $('#deleteS3Config').show();
      $('#modalS3Config').modal('hide');
    } else {
      showError('Failed to save S3 configuration: ' + (data.error || 'Unknown error'));
    }
  } catch (error) {
    showError('Error saving S3 configuration');
    console.error('Error:', error);
  }
}

async function testS3Connection() {
  const token = getLocalStorageItem('token');
  const myHeaders = new Headers();
  myHeaders.append('token', token);
  
  // Show loading state
  $('#testS3Connection').addClass('loading disabled');
  
  try {
    const res = await fetch(baseUrl + "/session/s3/test", {
      method: "POST",
      headers: myHeaders
    });
    
    const data = await res.json();
    if (data.success) {
      showSuccess('S3 connection test successful!');
    } else {
      showError('S3 connection test failed: ' + (data.error || 'Unknown error'));
    }
  } catch (error) {
    showError('Error testing S3 connection');
    console.error('Error:', error);
  } finally {
    $('#testS3Connection').removeClass('loading disabled');
  }
}

async function deleteS3Config() {
  // Show confirmation dialog
  if (!confirm('Are you sure you want to delete the S3 configuration? This action cannot be undone.')) {
    return;
  }
  
  const token = getLocalStorageItem('token');
  const myHeaders = new Headers();
  myHeaders.append('token', token);
  
  // Show loading state
  $('#deleteS3Config').addClass('loading disabled');
  
  try {
    const res = await fetch(baseUrl + "/session/s3/config", {
      method: "DELETE",
      headers: myHeaders
    });
    
    const data = await res.json();
    if (data.success) {
      showSuccess('S3 configuration deleted successfully');
      
      // Clear all form fields
      $('#s3Endpoint').val('');
      $('#s3AccessKey').val('');
      $('#s3SecretKey').val('');
      $('#s3Bucket').val('');
      $('#s3Region').val('');
      $('#s3ForcePathStyle').prop('checked', false);
      $('#s3PublicUrl').val('');
      $('#s3MediaDelivery').dropdown('set selected', 'base64');
      $('#s3RetentionDays').val(30);
      
      // Hide delete button
      $('#deleteS3Config').hide();
      
      $('#modalS3Config').modal('hide');
    } else {
      showError('Failed to delete S3 configuration: ' + (data.error || 'Unknown error'));
    }
  } catch (error) {
    showError('Error deleting S3 configuration');
    console.error('Error:', error);
  } finally {
    $('#deleteS3Config').removeClass('loading disabled');
  }
}

// Proxy Configuration Functions
async function loadProxyConfig() {
  const token = getLocalStorageItem('token');
  const myHeaders = new Headers();
  myHeaders.append('token', token);
  
  try {
    // Get user status to check proxy_config
    const res = await fetch(baseUrl + "/session/status", {
      method: "GET",
      headers: myHeaders
    });
    
    if (res.ok) {
      const data = await res.json();
      if (data.code === 200 && data.data && data.data.proxy_config) {
        const proxyConfig = data.data.proxy_config;
        const proxyUrl = proxyConfig.proxy_url || '';
        const enabled = proxyConfig.enabled || false;
        
        // Set checkbox state
        $('#proxyEnabled').prop('checked', enabled);
        $('#proxyEnabledToggle').checkbox(enabled ? 'set checked' : 'set unchecked');
        
        // Set proxy URL
        $('#proxyUrl').val(proxyUrl);
        
        // Show/hide URL field based on enabled state
        if (enabled) {
          $('#proxyUrlField').addClass('show');
        } else {
          $('#proxyUrlField').removeClass('show');
        }
      } else {
        // No proxy config, set defaults
        $('#proxyEnabled').prop('checked', false);
        $('#proxyEnabledToggle').checkbox('set unchecked');
        $('#proxyUrl').val('');
        $('#proxyUrlField').removeClass('show');
      }
    }
  } catch (error) {
    console.error('Error loading proxy config:', error);
  }
}

async function saveProxyConfig() {
  const token = getLocalStorageItem('token');
  const myHeaders = new Headers();
  myHeaders.append('token', token);
  myHeaders.append('Content-Type', 'application/json');
  
  const enabled = $('#proxyEnabled').is(':checked');
  const proxyUrl = $('#proxyUrl').val().trim();
  
  // If proxy is disabled, send disable request
  if (!enabled) {
    const config = {
      enable: false,
      proxy_url: ''
    };
    
    try {
      const res = await fetch(baseUrl + "/session/proxy", {
        method: "POST",
        headers: myHeaders,
        body: JSON.stringify(config)
      });
      
      const data = await res.json();
      if (data.success) {
        showSuccess('Proxy disabled successfully');
        $('#modalProxyConfig').modal('hide');
      } else {
        showError('Failed to disable proxy: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      showError('Error disabling proxy');
      console.error('Error:', error);
    }
    return;
  }
  
  // If enabled, validate proxy URL
  if (!proxyUrl) {
    showError('Proxy URL is required when proxy is enabled');
    return;
  }
  
  // Validate proxy URL has correct protocol
  if (!proxyUrl.startsWith('http://') && !proxyUrl.startsWith('https://') && !proxyUrl.startsWith('socks5://')) {
    showError('Proxy URL must start with http://, https://, or socks5://');
    return;
  }
  
  const config = {
    enable: true,
    proxy_url: proxyUrl
  };
  
  try {
    const res = await fetch(baseUrl + "/session/proxy", {
      method: "POST",
      headers: myHeaders,
      body: JSON.stringify(config)
    });
    
    const data = await res.json();
    if (data.success) {
      showSuccess('Proxy configuration saved successfully');
      $('#modalProxyConfig').modal('hide');
    } else {
      showError('Failed to save proxy configuration: ' + (data.error || 'Unknown error'));
    }
  } catch (error) {
    showError('Error saving proxy configuration');
    console.error('Error:', error);
  }
}

  // Editar Nº de Referência
  const refEditBtn = document.getElementById('ghlRefEditBtn');
  if (refEditBtn) {
    refEditBtn.addEventListener('click', function(){
      const current = document.getElementById('ghl-ref-display')?.textContent || '';
      const input = document.getElementById('inputRefInstance');
      if (input) input.value = (current === '-' ? '' : current);
      try { $('#modalEditRef').modal({ closable: true }).modal('show'); } catch(_){ document.getElementById('modalEditRef').style.display='block'; }
    });
  }
  const saveRefBtn = document.getElementById('saveRefEditBtn');
  if (saveRefBtn) {
    saveRefBtn.addEventListener('click', async function(){
      const token = getLocalStorageItem('token');
      const value = (document.getElementById('inputRefInstance')?.value || '').trim();
      saveRefBtn.classList.add('loading','disabled');
      try {
        const res = await fetch('/integration/ghl/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'token': token },
          body: JSON.stringify({ ref_instance: value })
        });
        if (!res.ok) throw new Error('Falha ao salvar referência');
        try { $('#modalEditRef').modal('hide'); } catch(_){ document.getElementById('modalEditRef').style.display='none'; }
        showSuccess('Referência atualizada');
        if (typeof refreshGHLStatus === 'function') {
          await refreshGHLStatus();
        } else {
          const disp = document.getElementById('ghl-ref-display');
          if (disp) disp.textContent = value || '-';
        }
      } catch(err){
        showError(err.message || 'Erro ao salvar referência');
      } finally { saveRefBtn.classList.remove('loading','disabled'); }
    });
  }
  const cancelRefBtn = document.getElementById('cancelRefEditBtn');
  if (cancelRefBtn) {
    cancelRefBtn.addEventListener('click', function(){ try { $('#modalEditRef').modal('hide'); } catch(_){ document.getElementById('modalEditRef').style.display='none'; } });
  }

// =====================================
// CHAT INTEGRADO - FUNCTIONS
// =====================================

// Chat state management
let chatState = {
  active: false,
  instanceId: null,
  instanceToken: null,
  instanceName: null,
  activeContact: null,
  conversations: [],
  messages: {},
  websocket: null
};

// Abrir modal de chat para uma instância específica
function openInstanceChat(instanceId, token, instanceName) {
  console.log('Opening chat for instance:', instanceId, instanceName);
  
  // Validar se a instância está conectada e logada
  const instance = instancesCache.find(inst => inst.id === instanceId);
  if (!instance || !instance.connected || !instance.loggedIn) {
    showError('Instância deve estar conectada e logada para usar o chat');
    return;
  }

  // Atualizar estado do chat
  chatState.active = true;
  chatState.instanceId = instanceId;
  chatState.instanceToken = token;
  chatState.instanceName = instanceName;
  
  // Abrir modal de chat
  $('#chatModal').modal({
    closable: false,
    onShow: function() {
      initializeChat();
    },
    onHidden: function() {
      cleanupChat();
    }
  }).modal('show');
}

// Inicializar chat (carregar conversas, conectar WebSocket)
async function initializeChat() {
  console.log('Initializing chat for:', chatState.instanceName);
  
  try {
    // Mostrar loading
    $('.chat-loading').removeClass('hidden');
    $('.chat-content').addClass('hidden');
    
    // Configurar título do chat
    document.getElementById('chatInstanceTitle').textContent = `Chat - ${chatState.instanceName}`;
    document.getElementById('chatInstanceStatus').textContent = 'Online';
    
    // Carregar conversas (placeholder - será implementado)
    await loadConversations();
    
    // Mostrar estado inicial
    if (chatState.conversations.length === 0) {
      document.getElementById('chatEmptyMessages').style.display = 'flex';
      document.getElementById('chatConversationHeader').classList.add('hidden');
      document.getElementById('chatInputContainer').classList.add('hidden');
    } else {
      document.getElementById('chatEmptyMessages').style.display = 'none';
      document.getElementById('chatConversationHeader').classList.remove('hidden');
      document.getElementById('chatInputContainer').classList.remove('hidden');
    }
    
    // Conectar WebSocket para tempo real
    connectChatWebSocket();
    
    // Mostrar conteúdo
    $('.chat-loading').addClass('hidden');
    $('.chat-content').removeClass('hidden');
    
    showSuccess(`Chat aberto para ${chatState.instanceName}`);
  } catch (error) {
    console.error('Error initializing chat:', error);
    showError('Erro ao inicializar chat: ' + error.message);
  }
}

// Cache para informações de contatos (nome + foto)
const contactCache = new Map();

// Buscar informações do contato (nome + foto)
async function getContactProfile(contactJid) {
  // Verificar cache primeiro
  if (contactCache.has(contactJid)) {
    return contactCache.get(contactJid);
  }
  
  try {
    // Extrair número do JID (remover @s.whatsapp.net)
    const phoneNumber = contactJid.replace('@s.whatsapp.net', '');
    
    const response = await fetch('/user/profile', {
      method: 'POST',
      headers: {
        'token': chatState.instanceToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        phone: phoneNumber
      })
    });
    
    if (response.ok) {
      const profileData = await response.json();
      
      const contactInfo = {
        jid: profileData.jid || contactJid,
        number: profileData.number || phoneNumber,
        profileName: profileData.profileName || phoneNumber,
        profilePicUrl: profileData.profilePicUrl || null,
        displayName: profileData.profileName || phoneNumber
      };
      
      // Salvar no cache
      contactCache.set(contactJid, contactInfo);
      
      // Salvar no banco de dados via API
      try {
        await fetch('/chat/profile/update', {
          method: 'POST',
          headers: {
            'token': chatState.instanceToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            jid: contactJid,
            displayName: contactInfo.displayName,
            profilePicUrl: contactInfo.profilePicUrl
          })
        });
        console.log('Profile saved to database:', contactJid);
      } catch (error) {
        console.warn('Failed to save profile to database:', error);
      }
      
      console.log('Contact profile loaded:', contactInfo);
      return contactInfo;
    } else {
      console.warn('Failed to load profile for:', contactJid);
    }
  } catch (error) {
    console.error('Error loading contact profile:', error);
  }
  
  // Fallback: retornar dados básicos
  const fallbackInfo = {
    jid: contactJid,
    number: contactJid.replace('@s.whatsapp.net', ''),
    profileName: contactJid.replace('@s.whatsapp.net', ''),
    profilePicUrl: null,
    displayName: contactJid.replace('@s.whatsapp.net', '')
  };
  
  contactCache.set(contactJid, fallbackInfo);
  return fallbackInfo;
}

// Carregar lista de conversas (dados reais)
async function loadConversations() {
  console.log('Loading conversations...');
  
  try {
    const response = await fetch('/chat/conversations', {
      method: 'GET',
      headers: {
        'token': chatState.instanceToken,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    chatState.conversations = data || [];
    
    console.log('Loaded conversations:', chatState.conversations.length);
    
    // Buscar informações de perfil para cada conversa
    await loadContactProfiles();
    
    renderConversationsList();
    
  } catch (error) {
    console.error('Error loading conversations:', error);
    // Fallback to mock data for testing
    chatState.conversations = [
      {
        id: '5511999999999@s.whatsapp.net',
        name: 'João Silva',
        lastMessage: 'Oi, como você está?',
        timestamp: new Date().getTime() - 300000,
        unread: 2,
        avatar: null
      },
      {
        id: '5511888888888@s.whatsapp.net', 
        name: 'Maria Santos',
        lastMessage: 'Perfeito! Obrigada',
        timestamp: new Date().getTime() - 600000,
        unread: 0,
        avatar: null
      }
    ];
    renderConversationsList();
  }
}

// Carregar informações de perfil para todas as conversas
async function loadContactProfiles() {
  console.log('Loading contact profiles...');
  
  // Buscar perfis em paralelo (limitado para evitar sobrecarga)
  const batchSize = 5;
  for (let i = 0; i < chatState.conversations.length; i += batchSize) {
    const batch = chatState.conversations.slice(i, i + batchSize);
    
    await Promise.all(batch.map(async (conversation) => {
      try {
        const profile = await getContactProfile(conversation.id);
        
        // Atualizar conversa com informações do perfil
        conversation.profileName = profile.profileName;
        conversation.profilePicUrl = profile.profilePicUrl;
        conversation.displayName = profile.displayName;
        conversation.number = profile.number;
        
        // Usar profileName como nome se existir, senão usar número
        if (!conversation.name || conversation.name === conversation.id) {
          conversation.name = profile.displayName;
        }
        
        console.log('Updated conversation with profile:', conversation);
      } catch (error) {
        console.warn('Failed to load profile for conversation:', conversation.id);
      }
    }));
  }
  
  console.log('Contact profiles loaded');
}

// Atualizar avatar do header da conversa
function updateHeaderAvatar(conversation) {
  const avatarContainer = document.querySelector('.chat-contact-avatar');
  if (!avatarContainer) return;
  
  if (conversation.profilePicUrl) {
    avatarContainer.innerHTML = `
      <img src="${conversation.profilePicUrl}" 
           alt="${conversation.displayName || conversation.name}" 
           class="chat-avatar-img"
           onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
      <i class="user circle large icon" style="display: none;"></i>
    `;
  } else {
    avatarContainer.innerHTML = '<i class="user circle large icon"></i>';
  }
}

// Renderizar lista de conversas
function renderConversationsList() {
  const container = document.getElementById('chatConversationsList');
  if (!container) return;
  
  container.innerHTML = '';
  
  chatState.conversations.forEach(conv => {
    const lastMessageTime = formatChatTime(conv.timestamp);
    const unreadBadge = conv.unread > 0 ? 
      `<div class="ui tiny red circular label">${conv.unread}</div>` : '';
    
    // Avatar: usar foto se disponível, senão ícone padrão
    const avatarContent = conv.profilePicUrl ? 
      `<img src="${conv.profilePicUrl}" alt="${conv.name}" class="chat-avatar-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
       <i class="user circle icon" style="display: none;"></i>` :
      `<i class="user circle icon"></i>`;
    
    // Nome: usar displayName se disponível
    const displayName = conv.displayName || conv.name || conv.id.replace('@s.whatsapp.net', '');
    
    const conversationItem = `
      <div class="chat-conversation-item ${chatState.activeContact === conv.id ? 'active' : ''}" 
           data-contact="${conv.id}" 
           onclick="selectConversation('${conv.id}')">
        <div class="chat-conversation-avatar">
          ${avatarContent}
        </div>
        <div class="chat-conversation-content">
          <div class="chat-conversation-header">
            <span class="chat-conversation-name">${displayName}</span>
            <span class="chat-conversation-time">${lastMessageTime}</span>
          </div>
          <div class="chat-conversation-preview">
            <span class="chat-last-message">${conv.lastMessage}</span>
            ${unreadBadge}
          </div>
        </div>
      </div>
    `;
    
    container.innerHTML += conversationItem;
  });
  
  // Selecionar primeira conversa se nenhuma ativa
  if (!chatState.activeContact && chatState.conversations.length > 0) {
    selectConversation(chatState.conversations[0].id);
  }
}

// Selecionar uma conversa
function selectConversation(contactId) {
  console.log('Selecting conversation:', contactId);
  
  chatState.activeContact = contactId;
  
  // Zerar contador de mensagens não lidas da conversa ativa
  const activeConversation = chatState.conversations.find(c => c.id === contactId);
  if (activeConversation && activeConversation.unread > 0) {
    activeConversation.unread = 0;
    renderConversationsList(); // Re-renderizar para atualizar o badge
  }
  
  // Atualizar visual da lista
  document.querySelectorAll('.chat-conversation-item').forEach(item => {
    item.classList.remove('active');
  });
  
  document.querySelector(`[data-contact="${contactId}"]`)?.classList.add('active');
  
  // Atualizar header da conversa
  const conversation = activeConversation;
  if (conversation) {
    const displayName = conversation.displayName || conversation.name || contactId.replace('@s.whatsapp.net', '');
    document.getElementById('chatContactName').textContent = displayName;
    document.getElementById('chatContactStatus').textContent = 'Online';
    
    // Atualizar avatar do header
    updateHeaderAvatar(conversation);
    
    // Buscar perfil se ainda não carregado
    if (!conversation.profileName && !conversation.profilePicUrl) {
      getContactProfile(contactId).then(profile => {
        conversation.profileName = profile.profileName;
        conversation.profilePicUrl = profile.profilePicUrl;
        conversation.displayName = profile.displayName;
        
        // Atualizar nome no header
        document.getElementById('chatContactName').textContent = profile.displayName;
        
        // Atualizar avatar do header
        updateHeaderAvatar(conversation);
        
        // Re-renderizar lista para atualizar avatar
        renderConversationsList();
      });
    }
  }
  
  // Mostrar header e input da conversa
  document.getElementById('chatConversationHeader').classList.remove('hidden');
  document.getElementById('chatInputContainer').classList.remove('hidden');
  document.getElementById('chatEmptyMessages').style.display = 'none';
  
  // Carregar mensagens da conversa
  loadConversationMessages(contactId);
}

// Carregar mensagens de uma conversa
async function loadConversationMessages(contactId) {
  console.log('Loading messages for:', contactId);
  
  const messagesContainer = document.getElementById('chatMessagesContainer');
  if (!messagesContainer) return;
  
  try {
    const response = await fetch(`/chat/messages/${encodeURIComponent(contactId)}?limit=50&offset=0`, {
      method: 'GET',
      headers: {
        'token': chatState.instanceToken,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    chatState.messages[contactId] = data || [];
    
    console.log('Loaded messages:', chatState.messages[contactId].length);
    renderMessages(contactId);
    
  } catch (error) {
    console.error('Error loading messages:', error);
    // Fallback to mock data for testing
    const mockMessages = [
      {
        id: 'msg1',
        from: contactId,
        text: 'Oi, tudo bem?',
        timestamp: new Date().getTime() - 600000,
        fromMe: false,
        status: 'read'
      },
      {
        id: 'msg2', 
        from: 'me',
        text: 'Oi! Tudo ótimo, e você?',
        timestamp: new Date().getTime() - 300000,
        fromMe: true,
        status: 'read'
      },
      {
        id: 'msg3',
        from: contactId,
        text: 'Também estou bem, obrigado!',
        timestamp: new Date().getTime() - 100000,
        fromMe: false,
        status: 'delivered'
      }
    ];
    
    chatState.messages[contactId] = mockMessages;
    renderMessages(contactId);
  }
  
  // Scroll para baixo
  setTimeout(() => {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }, 100);
}

// Renderizar mensagens com suporte a mídia
function renderMessages(contactId) {
  const container = document.getElementById('chatMessagesContainer');
  if (!container) return;
  
  const messages = chatState.messages[contactId] || [];
  container.innerHTML = '';
  
  // Buscar informações do contato (só para referência futura se necessário)
  const conversation = chatState.conversations.find(conv => conv.jid === contactId);
  
  messages.forEach(msg => {
    const messageTime = formatChatTime(msg.timestamp);
    const messageClass = msg.fromMe ? 'sent' : 'received';
    const statusIcon = msg.fromMe ? getMessageStatusIcon(msg.status) : '';
    
    // Renderizar conteúdo baseado no tipo de mensagem
    let messageContent = '';
    
    if (msg.messageType === 'image' && msg.mediaURL) {
      messageContent = `
        <div class="chat-media-container">
          <img src="${msg.mediaURL}" alt="Imagem" class="chat-media-image" 
               onclick="openImageModal('${msg.mediaURL}')"
               onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
          <div class="chat-media-fallback" style="display: none;">
            <i class="image icon"></i>
            <span>📷 Imagem</span>
          </div>
          ${msg.text ? `<div class="chat-media-caption">${msg.text}</div>` : ''}
        </div>
      `;
    } else if (msg.messageType === 'video' && msg.mediaURL) {
      messageContent = `
        <div class="chat-media-container">
          <video controls class="chat-media-video">
            <source src="${msg.mediaURL}" type="${msg.mediaType || 'video/mp4'}">
            <div class="chat-media-fallback">
              <i class="video icon"></i>
              <span>🎥 Vídeo</span>
            </div>
          </video>
          ${msg.text ? `<div class="chat-media-caption">${msg.text}</div>` : ''}
        </div>
      `;
    } else if (msg.messageType === 'audio' && msg.mediaURL) {
      const audioId = `audio-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      messageContent = `
        <div class="chat-media-container whatsapp-audio-player" data-audio-id="${audioId}">
          <div class="audio-player-container">
            <div class="audio-controls">
              <button class="audio-play-btn" data-audio="${audioId}">
                <i class="play icon"></i>
              </button>
            </div>
            <div class="audio-waveform-container">
              <div class="audio-waveform" data-audio="${audioId}">
                <div class="waveform-bars">
                  ${Array.from({length: 40}, (_, i) => `<div class="bar" style="height: ${Math.random() * 80 + 20}%"></div>`).join('')}
                </div>
                <div class="audio-progress-overlay"></div>
              </div>
              <div class="audio-time-container">
                <span class="audio-current-time">0:00</span>
                <div class="audio-speed-control">
                  <button class="speed-btn" data-audio="${audioId}" data-speed="1">1x</button>
                </div>
                <span class="audio-duration">--:--</span>
              </div>
            </div>
          </div>
          <audio preload="metadata" data-id="${audioId}" style="display: none;">
            <source src="${msg.mediaURL}" type="${msg.mediaType || 'audio/mpeg'}">
          </audio>
          ${msg.text ? `<div class="chat-media-caption">${msg.text}</div>` : ''}
        </div>
      `;
    } else if (msg.messageType === 'document' && msg.mediaURL) {
      const fileName = msg.fileName || 'Documento';
      const fileSize = msg.fileSize ? formatFileSize(msg.fileSize) : '';
      messageContent = `
        <div class="chat-media-container chat-document">
          <i class="file outline icon"></i>
          <div class="chat-document-info">
            <div class="chat-document-name">${fileName}</div>
            ${fileSize ? `<div class="chat-document-size">${fileSize}</div>` : ''}
          </div>
          <a href="${msg.mediaURL}" target="_blank" class="ui mini primary button">
            <i class="download icon"></i>
            Baixar
          </a>
        </div>
      `;
    } else if (msg.messageType === 'sticker' && msg.mediaURL) {
      messageContent = `
        <div class="chat-media-container">
          <img src="${msg.mediaURL}" alt="Figurinha" class="chat-media-sticker">
        </div>
      `;
    } else {
      // Mensagem de texto normal
      messageContent = `<div class="chat-message-text">${msg.text}</div>`;
    }
    
    const messageElement = `
      <div class="chat-message ${messageClass}">
        <div class="chat-message-content">
          ${messageContent}
          <div class="chat-message-meta">
            <span class="chat-message-time">${messageTime}</span>
            ${statusIcon}
          </div>
        </div>
      </div>
    `;
    
    container.innerHTML += messageElement;
  });
  
  // Inicializar áudios simples
  setTimeout(() => {
    // Carregar metadados dos áudios
    document.querySelectorAll('audio[data-id]').forEach(audio => {
      const durationEl = audio.closest('.whatsapp-audio-player')?.querySelector('.audio-duration');
      audio.addEventListener('loadedmetadata', () => {
        if (durationEl && audio.duration && isFinite(audio.duration)) {
          durationEl.textContent = formatAudioTime(audio.duration);
        }
      });
    });
  }, 100);
}

// Função auxiliar para formatar tamanho de arquivo
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Função para abrir modal de imagem
function openImageModal(imageUrl) {
  // Criar modal simples para visualizar imagem
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
    background: rgba(0,0,0,0.8); z-index: 9999; display: flex; 
    align-items: center; justify-content: center; cursor: pointer;
  `;
  
  const img = document.createElement('img');
  img.src = imageUrl;
  img.style.cssText = `
    max-width: 90%; max-height: 90%; object-fit: contain; 
    border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);
  `;
  
  modal.appendChild(img);
  document.body.appendChild(modal);
  
  // Fechar ao clicar
  modal.onclick = () => {
    document.body.removeChild(modal);
  };
}

// =========================================
// WHATSAPP AUDIO PLAYER FUNCTIONS
// =========================================

// Inicializar todos os players de áudio
function initializeAudioPlayers() {
  document.addEventListener('click', function(e) {
    // Play/Pause button
    if (e.target.closest('.audio-play-btn')) {
      const btn = e.target.closest('.audio-play-btn');
      const audioId = btn.getAttribute('data-audio');
      toggleAudioPlayPause(audioId);
      return;
    }
    
    // Speed control button
    if (e.target.closest('.speed-btn')) {
      const btn = e.target.closest('.speed-btn');
      const audioId = btn.getAttribute('data-audio');
      changeAudioSpeed(audioId);
      return;
    }
    
    // Waveform click
    if (e.target.closest('.audio-waveform')) {
      const waveform = e.target.closest('.audio-waveform');
      const audioId = waveform.getAttribute('data-audio');
      const rect = waveform.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const percentage = clickX / rect.width;
      seekAudio(audioId, percentage);
      return;
    }
  });
}

// Toggle play/pause audio
function toggleAudioPlayPause(audioId) {
  const audio = document.querySelector(`audio[data-id="${audioId}"]`);
  const playBtn = document.querySelector(`.audio-play-btn[data-audio="${audioId}"]`);
  const icon = playBtn?.querySelector('i');
  
  if (!audio || !playBtn || !icon) return;
  
  if (audio.paused) {
    // Pausar todos os outros áudios
    document.querySelectorAll('audio').forEach(a => {
      if (a !== audio) {
        a.pause();
        const otherBtn = document.querySelector(`.audio-play-btn[data-audio="${a.getAttribute('data-id')}"]`);
        if (otherBtn) {
          const otherIcon = otherBtn.querySelector('i');
          otherIcon.className = 'play icon';
        }
      }
    });
    
    // Reproduzir áudio
    const playPromise = audio.play();
    
    if (playPromise !== undefined) {
      playPromise.then(() => {
        icon.className = 'pause icon';
        setupAudioEventListeners(audioId);
      }).catch((error) => {
        console.error('Erro ao reproduzir áudio:', error);
      });
    } else {
      icon.className = 'pause icon';
      setupAudioEventListeners(audioId);
    }
    
  } else {
    audio.pause();
    icon.className = 'play icon';
  }
}

// Setup event listeners para áudio específico  
function setupAudioEventListeners(audioId) {
  const audio = document.querySelector(`audio[data-id="${audioId}"]`);
  if (!audio) return;
  
  // Remove listeners existentes para evitar duplicação
  audio.removeEventListener('timeupdate', audio._timeUpdateHandler);
  audio.removeEventListener('loadedmetadata', audio._metadataHandler);
  audio.removeEventListener('ended', audio._endedHandler);
  
  // Duration display quando metadata carrega
  audio._metadataHandler = function() {
    const durationEl = audio.closest('.whatsapp-audio-player').querySelector('.audio-duration');
    if (durationEl && audio.duration) {
      durationEl.textContent = formatAudioTime(audio.duration);
    }
  };
  
  // Update progress durante reprodução
  audio._timeUpdateHandler = function() {
    const currentTimeEl = audio.closest('.whatsapp-audio-player').querySelector('.audio-current-time');
    const progressOverlay = audio.closest('.whatsapp-audio-player').querySelector('.audio-progress-overlay');
    
    if (currentTimeEl) {
      currentTimeEl.textContent = formatAudioTime(audio.currentTime);
    }
    
    if (progressOverlay && audio.duration > 0) {
      const progress = (audio.currentTime / audio.duration) * 100;
      progressOverlay.style.width = `${progress}%`;
    }
  };
  
  // Reset quando áudio termina
  audio._endedHandler = function() {
    const playBtn = document.querySelector(`.audio-play-btn[data-audio="${audioId}"]`);
    const icon = playBtn.querySelector('i');
    const progressOverlay = audio.closest('.whatsapp-audio-player').querySelector('.audio-progress-overlay');
    
    icon.className = 'play icon';
    if (progressOverlay) {
      progressOverlay.style.width = '0%';
    }
  };
  
  audio.addEventListener('loadedmetadata', audio._metadataHandler);
  audio.addEventListener('timeupdate', audio._timeUpdateHandler);
  audio.addEventListener('ended', audio._endedHandler);
}

// Mudar velocidade do áudio
function changeAudioSpeed(audioId) {
  const audio = document.querySelector(`audio[data-id="${audioId}"]`);
  const speedBtn = document.querySelector(`.speed-btn[data-audio="${audioId}"]`);
  
  if (!audio || !speedBtn) return;
  
  const currentSpeed = parseFloat(speedBtn.getAttribute('data-speed'));
  let newSpeed;
  
  switch (currentSpeed) {
    case 1:
      newSpeed = 1.5;
      break;
    case 1.5:
      newSpeed = 2;
      break;
    case 2:
      newSpeed = 1;
      break;
    default:
      newSpeed = 1;
  }
  
  audio.playbackRate = newSpeed;
  speedBtn.setAttribute('data-speed', newSpeed);
  speedBtn.textContent = `${newSpeed}x`;
}

// Seek no áudio baseado na posição do clique
function seekAudio(audioId, percentage) {
  const audio = document.querySelector(`audio[data-id="${audioId}"]`);
  if (!audio || !audio.duration) return;
  
  audio.currentTime = audio.duration * percentage;
}

// Formatar tempo do áudio (mm:ss)
function formatAudioTime(seconds) {
  if (!seconds || !isFinite(seconds)) return '0:00';
  
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Função simples para debug de áudio
function debugAudio(audioId) {
  const audio = document.querySelector(`audio[data-id="${audioId}"]`);
  if (audio) {
    console.log('Audio encontrado:', audio.src, 'Ready state:', audio.readyState, 'Duration:', audio.duration);
  } else {
    console.log('Audio não encontrado:', audioId);
  }
}

// Inicializar quando DOM carrega
document.addEventListener('DOMContentLoaded', initializeAudioPlayers);

// Formatar tempo para exibição no chat
function formatChatTime(timestamp) {
  const now = new Date();
  const date = new Date(timestamp);
  const diff = now.getTime() - timestamp;
  
  // Menos de 1 minuto
  if (diff < 60000) {
    return 'agora';
  }
  
  // Menos de 1 hora
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes}m`;
  }
  
  // Mesmo dia
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  
  // Outros dias
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

// Ícone de status da mensagem
function getMessageStatusIcon(status) {
  return `<span class="chat-message-status ${status}"></span>`;
}

// Enviar mensagem
async function sendChatMessage() {
  const input = document.getElementById('chatMessageInput');
  if (!input || !chatState.activeContact) return;
  
  const text = input.value.trim();
  if (!text) return;
  
  console.log('Sending message:', text, 'to:', chatState.activeContact);
  
  // Extrair número do telefone do JID (formato: 5527981120473@s.whatsapp.net)
  const phoneNumber = chatState.activeContact.split('@')[0];
  
  // Limpar input imediatamente para UX responsiva
  input.value = '';
  
  // Adicionar mensagem localmente com status "sending"
  const timestamp = new Date().getTime();
  const tempMessageId = 'temp_' + timestamp;
  const newMessage = {
    id: tempMessageId,
    from: 'me',
    text: text,
    timestamp: timestamp,
    fromMe: true,
    status: 'sending'
  };
  
  // Adicionar à lista local
  if (!chatState.messages[chatState.activeContact]) {
    chatState.messages[chatState.activeContact] = [];
  }
  chatState.messages[chatState.activeContact].push(newMessage);
  
  // Re-renderizar mensagens
  renderMessages(chatState.activeContact);
  
  // Scroll para baixo
  const messagesContainer = document.getElementById('chatMessagesContainer');
  if (messagesContainer) {
    setTimeout(() => {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }, 100);
  }
  
  try {
    // Enviar via API real
    const response = await fetch('/chat/send/text', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'token': chatState.instanceToken
      },
      body: JSON.stringify({
        Phone: phoneNumber,
        Body: text
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const result = await response.json();
    console.log('Message sent successfully:', result);
    
    // Atualizar status da mensagem para "sent"
    const messageIndex = chatState.messages[chatState.activeContact].findIndex(msg => msg.id === tempMessageId);
    if (messageIndex >= 0) {
      chatState.messages[chatState.activeContact][messageIndex].status = 'sent';
      if (result.data && result.data.id) {
        // Usar ID real da mensagem se disponível
        chatState.messages[chatState.activeContact][messageIndex].id = result.data.id;
      }
      renderMessages(chatState.activeContact);
    }
    
  } catch (error) {
    console.error('Error sending message:', error);
    
    // Marcar mensagem como erro
    const messageIndex = chatState.messages[chatState.activeContact].findIndex(msg => msg.id === tempMessageId);
    if (messageIndex >= 0) {
      chatState.messages[chatState.activeContact][messageIndex].status = 'error';
      renderMessages(chatState.activeContact);
    }
    
    // Mostrar erro para o usuário
    showError('Erro ao enviar mensagem: ' + error.message);
  }
}

// Cleanup quando fechar o chat
function cleanupChat() {
  console.log('Cleaning up chat...');
  
  // Desconectar WebSocket se ativo
  if (chatState.websocket) {
    chatState.websocket.close();
    chatState.websocket = null;
  }
  
  // Reset do estado
  chatState.active = false;
  chatState.instanceId = null;
  chatState.instanceToken = null;
  chatState.instanceName = null;
  chatState.activeContact = null;
}

// =====================================
// WEBSOCKET REAL-TIME FUNCTIONS  
// =====================================

// Formatar JID para exibição amigável
function formatJIDForDisplay(jid) {
  if (!jid) return 'Contato Desconhecido';
  
  // Remover sufixos do WhatsApp
  let displayJID = jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
  
  // Se for um número, formatá-lo
  if (/^\d+$/.test(displayJID)) {
    if (displayJID.startsWith('55') && displayJID.length >= 12) {
      // Formato brasileiro: +55 11 99999-9999
      const ddd = displayJID.substring(2, 4);
      const number = displayJID.substring(4);
      if (number.length === 9) {
        return `+55 ${ddd} ${number.substring(0, 5)}-${number.substring(5)}`;
      } else if (number.length === 8) {
        return `+55 ${ddd} ${number.substring(0, 4)}-${number.substring(4)}`;
      }
    }
    
    // Formato genérico para outros países
    return `+${displayJID}`;
  }
  
  return displayJID;
}

// =====================================
// CHAT DIRECT LINK FUNCTIONS
// =====================================

// Gerar link direto para o chat
function generateChatLink(instanceId, token, instanceName) {
  const baseUrl = window.location.origin;
  const path = window.location.pathname;
  return `${baseUrl}${path}#token=${token}&instance=${instanceId}&chat=1`;
}

// Copiar link direto do chat
async function copyChatLink(instanceId, token, instanceName) {
  try {
    const chatLink = generateChatLink(instanceId, token, instanceName);
    const success = await copyToClipboard(chatLink);
    
    if (success) {
      showSuccess('Link do chat copiado! Compartilhe para acesso direto ao chat.');
    } else {
      // Fallback: mostrar o link em modal para copiar manualmente
      showChatLinkModal(chatLink, instanceName);
    }
  } catch (error) {
    console.error('Error copying chat link:', error);
    showError('Erro ao copiar link do chat');
  }
}

// Mostrar modal com link para cópia manual
function showChatLinkModal(chatLink, instanceName) {
  const modalHtml = `
    <div class="ui modal" id="chatLinkModal">
      <div class="header">
        <i class="linkify icon"></i> Link Direto do Chat - ${instanceName}
      </div>
      <div class="content">
        <div class="ui message info">
          <div class="header">Compartilhe este link para acesso direto ao chat:</div>
          <p>Qualquer pessoa com este link poderá acessar o chat da instância <strong>${instanceName}</strong> diretamente.</p>
        </div>
        <div class="ui form">
          <div class="field">
            <label>Link do Chat:</label>
            <div class="ui action input">
              <input type="text" value="${chatLink}" readonly id="chatLinkInput">
              <button class="ui button" onclick="copyFromInput()">
                <i class="copy icon"></i> Copiar
              </button>
            </div>
          </div>
        </div>
      </div>
      <div class="actions">
        <button class="ui button" onclick="$('#chatLinkModal').modal('hide')">Fechar</button>
        <button class="ui primary button" onclick="window.open('${chatLink}', '_blank')">
          <i class="external icon"></i> Testar Link
        </button>
      </div>
    </div>
  `;
  
  // Remover modal anterior se existir
  $('#chatLinkModal').remove();
  
  // Adicionar e mostrar novo modal
  $('body').append(modalHtml);
  $('#chatLinkModal').modal('show');
}

// Copiar do input no modal
function copyFromInput() {
  const input = document.getElementById('chatLinkInput');
  input.select();
  document.execCommand('copy');
  showSuccess('Link copiado para área de transferência!');
  $('#chatLinkModal').modal('hide');
}

// Auto-abrir chat quando acessado via link direto
function autoOpenChatFromUrl(instanceId, token) {
  console.log('Auto-opening chat for instance:', instanceId);
  
  // Verificar se temos dados das instâncias carregados
  if (!instancesCache || instancesCache.length === 0) {
    // Se não tem cache ainda, tentar novamente em 1 segundo
    setTimeout(() => {
      autoOpenChatFromUrl(instanceId, token);
    }, 1000);
    return;
  }
  
  // Procurar a instância na cache
  const instance = instancesCache.find(inst => inst.id === instanceId);
  
  if (!instance) {
    showError('Instância não encontrada ou não acessível');
    return;
  }
  
  // Verificar se a instância está conectada e logada
  if (!instance.connected || !instance.loggedIn) {
    showError(`Instância "${instance.name}" deve estar conectada e logada para usar o chat`);
    return;
  }
  
  // Abrir o chat da instância
  try {
    openInstanceChat(instanceId, token, instance.name);
    showSuccess(`Chat da instância "${instance.name}" aberto automaticamente!`);
  } catch (error) {
    console.error('Error auto-opening chat:', error);
    showError('Erro ao abrir o chat automaticamente');
  }
}

// =====================================
// NOTIFICATION SOUND FUNCTIONS
// =====================================

// Verificar se deve tocar notificação
function shouldPlayNotification(message) {
  return !message.from_me; // Só tocar se não for mensagem nossa
}

// Som de notificação ICQ
window.testSimpleSound = function() {
  try {
    const audio = new Audio('https://api.stevo.chat/storage/v1/object/public/imagens-sistema/icq-old-sound.mp3');
    audio.volume = 0.7;
    audio.play().catch(() => {
      // Falha silenciosa - usuário pode precisar interagir primeiro
    });
  } catch (error) {
    // Falha silenciosa - áudio não é crítico
  }
};

// =====================================
// WEBSOCKET REAL-TIME FUNCTIONS  
// =====================================

// Conectar WebSocket para atualizações em tempo real
function connectChatWebSocket() {
  console.log('Connecting to chat WebSocket...');
  
  // Determinar protocolo WebSocket baseado no protocolo atual
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}/chat/stream?token=${chatState.instanceToken}`;
  
  try {
    chatState.websocket = new WebSocket(wsUrl);
    
    chatState.websocket.onopen = function(event) {
      console.log('Chat WebSocket connected');
      document.getElementById('chatInstanceStatus').textContent = 'Online • Tempo Real';
    };
    
    chatState.websocket.onmessage = function(event) {
      console.log('WebSocket message received:', event.data);
      
      try {
        const message = JSON.parse(event.data);
        handleChatWebSocketMessage(message);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };
    
    chatState.websocket.onclose = function(event) {
      console.log('Chat WebSocket disconnected', event.code, event.reason);
      document.getElementById('chatInstanceStatus').textContent = 'Offline';
      
      // Tentar reconectar em 5 segundos se o chat ainda estiver ativo
      if (chatState.active) {
        setTimeout(() => {
          if (chatState.active) {
            console.log('Attempting to reconnect WebSocket...');
            connectChatWebSocket();
          }
        }, 5000);
      }
    };
    
    chatState.websocket.onerror = function(error) {
      console.error('Chat WebSocket error:', error);
      document.getElementById('chatInstanceStatus').textContent = 'Erro de Conexão';
    };
    
    // Enviar ping periodicamente para manter conexão viva
    chatState.pingInterval = setInterval(() => {
      if (chatState.websocket && chatState.websocket.readyState === WebSocket.OPEN) {
        chatState.websocket.send(JSON.stringify({
          type: 'ping',
          timestamp: new Date().getTime()
        }));
      }
    }, 30000);
    
  } catch (error) {
    console.error('Error creating WebSocket connection:', error);
    document.getElementById('chatInstanceStatus').textContent = 'Erro de Conexão';
  }
}

// Processar mensagens do WebSocket
function handleChatWebSocketMessage(message) {
  console.log('Processing WebSocket message:', message);
  
  switch (message.type) {
    case 'pong':
      // Resposta do ping - conexão ativa
      break;
      
    case 'message':
      if (message.event === 'new_message') {
        handleNewMessage(message.data);
      }
      break;
      
    case 'system':
      if (message.event === 'connected') {
        console.log('WebSocket system message:', message.data);
      }
      break;
      
    default:
      console.log('Unknown WebSocket message type:', message.type);
  }
}

// Processar nova mensagem recebida via WebSocket
function handleNewMessage(data) {
  console.log('New message received:', data);
  
  const conversation = data.conversation;
  const message = data.message;
  
  if (!conversation || !message) {
    console.error('Invalid message data received');
    return;
  }
  
  // Atualizar lista de conversas preservando dados de perfil
  const existingConvIndex = chatState.conversations.findIndex(c => c.id === conversation.jid);
  
  if (existingConvIndex >= 0) {
    // Atualizar conversa existente PRESERVANDO dados de perfil
    const existingConv = chatState.conversations[existingConvIndex];
    
    // Atualizar apenas os campos necessários, preservando perfil
    existingConv.lastMessage = message.text_content || '[Media message]';
    existingConv.timestamp = message.timestamp;
    
    // Incrementar contador de não lidas apenas se não for mensagem nossa
    if (!message.from_me && conversation.jid !== chatState.activeContact) {
      existingConv.unread = (existingConv.unread || 0) + 1;
    }
    
    // Mover conversa para o topo da lista (ordenação por última mensagem)
    chatState.conversations.splice(existingConvIndex, 1);
    chatState.conversations.unshift(existingConv);
    
  } else {
    // Adicionar nova conversa (pode não ter dados de perfil ainda)
    const newConversation = {
      id: conversation.jid,
      name: conversation.display_name || formatJIDForDisplay(conversation.jid),
      displayName: conversation.display_name || formatJIDForDisplay(conversation.jid),
      lastMessage: message.text_content || '[Media message]',
      timestamp: message.timestamp,
      unread: message.from_me ? 0 : 1, // Se não é nossa mensagem, marcar como não lida
      avatar: null,
      profilePicUrl: null,
      profileName: null
    };
    
    // Adicionar no topo da lista
    chatState.conversations.unshift(newConversation);
    
    // Tentar carregar perfil da nova conversa
    getContactProfile(conversation.jid).then(profile => {
      newConversation.profileName = profile.profileName;
      newConversation.profilePicUrl = profile.profilePicUrl;
      newConversation.displayName = profile.displayName;
      newConversation.number = profile.number;
      
      if (!newConversation.name || newConversation.name === newConversation.id) {
        newConversation.name = profile.displayName;
      }
      
      // Re-renderizar após carregar perfil
      renderConversationsList();
    }).catch(err => {
      console.warn('Failed to load profile for new conversation:', conversation.jid);
    });
  }
  
  // Re-renderizar lista de conversas
  renderConversationsList();
  
  // 🔊 Reproduzir som de notificação ICQ se não for nossa mensagem
  if (shouldPlayNotification(message)) {
    window.testSimpleSound();
  }
  
  // Se a conversa ativa for a mesma da mensagem, adicionar mensagem à lista
  if (chatState.activeContact === conversation.jid) {
    const frontendMessage = {
      id: message.message_id,
      from: message.from_jid,
      text: message.text_content,
      timestamp: message.timestamp,
      fromMe: message.from_me,
      status: message.status,
      messageType: message.message_type || 'text',
      mediaURL: message.media_url || '',
      mediaType: message.media_type || '',
      fileName: message.file_name || '',
      fileSize: message.file_size || 0,
      thumbnailURL: message.thumbnail_url || ''
    };
    
    // Adicionar à lista de mensagens se não existir
    if (!chatState.messages[conversation.jid]) {
      chatState.messages[conversation.jid] = [];
    }
    
    const existingMessageIndex = chatState.messages[conversation.jid].findIndex(m => m.id === message.message_id);
    if (existingMessageIndex === -1) {
      chatState.messages[conversation.jid].push(frontendMessage);
      renderMessages(conversation.jid);
      
      // Scroll para baixo
      const messagesContainer = document.getElementById('chatMessagesContainer');
      if (messagesContainer) {
        setTimeout(() => {
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }, 100);
      }
    }
  }
  
  // Reproduzir som de notificação se a mensagem não for nossa
  if (!message.from_me) {
    playNotificationSound();
  }
}

// Reproduzir som de notificação (placeholder)
function playNotificationSound() {
  // Pode implementar reprodução de som aqui se necessário
  console.log('🔔 Nova mensagem recebida');
}

// Event listener para Enter no input de mensagem
document.addEventListener('keypress', function(e) {
  if (e.target && e.target.id === 'chatMessageInput' && e.key === 'Enter') {
    e.preventDefault();
    sendChatMessage();
  }
});

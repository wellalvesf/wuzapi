let baseUrl = window.location.origin;
let scanned = false;
let updateAdminTimeout = null;
let updateUserTimeout = null;
let updateInterval = 5000;
let instanceToDelete = null;
let isAdminLogin = false;
let currentInstanceData = null;

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
      const sendOrigin = document.getElementById('ghl-toggle-send-origin')?.querySelector('input')?.checked || document.getElementById('ghl-toggle-send-origin')?.checked;
      const userInConv = document.getElementById('ghl-toggle-agent-tag')?.querySelector('input')?.checked || document.getElementById('ghl-toggle-agent-tag')?.checked;
      const phoneRaw = (document.getElementById('ghl-disconnect-phone')?.value || '').trim();
      const phone = phoneRaw.replace(/[^0-9]/g, '').replace(/^\+/, '');
      const alertOn = document.getElementById('ghl-toggle-disconnect-alert')?.querySelector('input')?.checked || document.getElementById('ghl-toggle-disconnect-alert')?.checked;
      try {
        await fetch('/integration/ghl/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'token': token },
          body: JSON.stringify({ env_source: !!sendOrigin, user_in_conv: !!userInConv, disconnect_alert_phone: phone, disconnect_alert: !!alertOn })
        });
        $('#modalGHLSettings').modal('hide');
        showSuccess('Configurações salvas');
      } catch(_){
        showError('Falha ao salvar configurações');
      }
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
        const v2 = !!json.user_in_conv;
        const el2 = document.getElementById('ghl-toggle-agent-tag');
        if (el2) {
          const input2 = el2.querySelector ? el2.querySelector('input') : null;
          if (input2) input2.checked = v2; else if (typeof el2.checked !== 'undefined') el2.checked = v2;
        }
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
  // Deep-link via URL or hash: ?token=...&instance=... [&admin=1]
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const hash = window.location.hash ? window.location.hash.substring(1) : '';
    const hashParams = new URLSearchParams(hash);
    const tokenFromUrl = urlParams.get('token') || urlParams.get('t') || hashParams.get('token') || hashParams.get('t');
    const instanceFromUrl = urlParams.get('instance') || urlParams.get('id') || hashParams.get('instance') || hashParams.get('id');
    const adminFlag = (urlParams.get('admin') || hashParams.get('admin') || '').toLowerCase();

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

  if(instances.length==0) {
    const nodatarow = '<tr><td style="text-align:center;" colspan=5>No instances found</td></tr>'
    tableBody.append(nodatarow);
  }
  instances.forEach(instance => {

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
                        ${instance.profile_pic_url ? `<img src="${instance.profile_pic_url}" alt="avatar" style="width:48px;height:48px;border-radius:50%;object-fit:cover;border:1px solid rgba(255,255,255,0.1);"/>` : `<div class="chat-avatar" style="width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#2b2f31;color:#9aa0a6;border:1px solid rgba(255,255,255,0.08);">${(instance.name||'S').slice(0,1).toUpperCase()}</div>`}
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
                        <div style="word-break:break-all;">${instance.token}</div>
                        <div style="opacity:.7;">JID</div>
                        <div>${instance.jid || 'Not available'}</div>
                        <div style="opacity:.7;">Webhook</div>
                        <div style="word-break:break-all;">${instance.webhook || 'Not configured'}</div>
                        <div style="opacity:.7;">Subscribed Events</div>
                        <div>${instance.events || 'Not configured'}</div>
                        <div style="opacity:.7;">Proxy</div>
                        <div>${instance.proxy_config.enabled ? 'Enabled' : 'Disabled'}</div>
                        <div style="opacity:.7;">Proxy URL</div>
                        <div>${instance.proxy_config.proxy_url || 'Not configured'}</div>
                      </div>
                  </div>
                  
                  <!-- Right Column - QR Code (only shown if not logged in) -->
                  ${!instance.loggedIn ? `
                  <div class="column" style="display: flex; flex-direction: column; justify-content: center; align-items: center;">
                      <div class="ui segment" style="width: 100%; max-width: 200px; height: 200px; display: flex; justify-content: center; align-items: center;">
                        ${instance.qrcode ? 
                          `<img src="${instance.qrcode}" style="max-height: 100%; max-width: 100%;">
                      </div>
                      <div>
                        Open WhatsApp on your phone and tap<br/><i class="ellipsis vertical icon"></i>> Linked devices > Link a device.
                          ` : 
                                `<div class="ui icon header" style="text-align: center;">
                                    <i class="qrcode icon" style="font-size: 3em;"></i>
                                    <div class="sub header">QR Code will appear here</div>
                                </div>`
                           }
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
              <div class="ui toggle checkbox" style="margin-left:10px;">
                <input type="checkbox" id="toggle-ignore-groups-${instance.id}" ${instance.ignore_groups ? 'checked' : ''}>
                <label>Ignore group messages</label>
              </div>
              <button class="ui primary positive button dashboard-button ${instance.connected === true && instance.loggedIn === false ? '' : 'hidden'} id="button-logout-${instance.id}" onclick="modalPairPhone()">Login with Pairing Code</button>
              </div>
        </div>
        `;
    cardsContainer.append(card);
    // bind toggle event
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
    }, 0);
  });
  if(currentInstance!==null) {
     const showInstanceId=`instance-card-${currentInstance}`
     $('#'+showInstanceId).removeClass('hidden');
     
     // Store current instance data globally for use in modals
     const currentInstanceObj = instances.find(inst => inst.id === currentInstance);
     if (currentInstanceObj) {
       currentInstanceData = currentInstanceObj;
     }
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

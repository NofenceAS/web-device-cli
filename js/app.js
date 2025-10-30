'use strict';

const bleNusServiceUUID  = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const bleNusCharRXUUID   = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const bleNusCharTXUUID   = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
const MTU = 20;

/* ---------- Filter (persisted) ---------- */
const FILTER_KEY = 'bt_nus_filter';
function getSavedFilter(){
  try { return (localStorage.getItem(FILTER_KEY) || '').trim(); }
  catch(e){ return ''; }
}
function saveFilter(){
  const el = document.getElementById('filterInput');
  if(!el) return;
  const val = (el.value || '').trim();
  try { localStorage.setItem(FILTER_KEY, val); } catch(_) {}
  if(window.term_?.io) window.term_.io.println('\r\nSaved filter: "' + val + '"');
}

/* ---------- BLE state ---------- */
let bleDevice, nusService, rxCharacteristic, txCharacteristic;
let connected = false;

/* ---------- Connection controls ---------- */
function connectionToggle(){ connected ? disconnect() : connect(); document.getElementById('terminal').focus(); }
function setConnButtonState(on){ document.getElementById('clientConnectButton').innerHTML = on ? 'Disconnect' : 'Connect'; }

/* ---------- Connect / Disconnect ---------- */
function connect(){
  if(!navigator.bluetooth){
    window.term_?.io.println('WebBluetooth not available in this browser.');
    return;
  }
  const filter = getSavedFilter();
  let options = { optionalServices:[bleNusServiceUUID], acceptAllDevices:true };
  if(filter){ options = { optionalServices:[bleNusServiceUUID], filters:[{ namePrefix: filter }] }; }

  navigator.bluetooth.requestDevice(options)
  .then(device => {
    bleDevice = device;
    bleDevice.addEventListener('gattserverdisconnected', onDisconnected);
    return device.gatt.connect();
  })
  .then(server => server.getPrimaryService(bleNusServiceUUID))
  .then(service => nusService = service)
  .then(() => nusService.getCharacteristic(bleNusCharRXUUID))
  .then(ch => rxCharacteristic = ch)
  .then(() => nusService.getCharacteristic(bleNusCharTXUUID))
  .then(ch => txCharacteristic = ch)
  .then(() => txCharacteristic.startNotifications())
  .then(() => {
    txCharacteristic.addEventListener('characteristicvaluechanged', handleNotifications);
    connected = true;
    window.term_.io.println('\r\n' + bleDevice.name + ' Connected.');
    nusSendString('\r');
    setConnButtonState(true);
  })
  .catch(err => {
    window.term_?.io.println(String(err));
    if(bleDevice?.gatt?.connected) bleDevice.gatt.disconnect();
  });
}

function disconnect(){
  if(!bleDevice) return;
  if(bleDevice.gatt.connected){
    bleDevice.gatt.disconnect();
    connected = false;
    setConnButtonState(false);
  }
}

function onDisconnected(){
  connected = false;
  window.term_?.io.println('\r\n' + (bleDevice?.name || 'Device') + ' Disconnected.');
  setConnButtonState(false);
}

/* ---------- NUS data path ---------- */
function handleNotifications(event){
  const dv = event.target.value;
  let s = '';
  for(let i=0;i<dv.byteLength;i++) s += String.fromCharCode(dv.getUint8(i));
  window.term_.io.print(s);
}

/* Send data (chunked by MTU) */
function nusSendString(s){
  if(!(bleDevice?.gatt?.connected)) return window.term_.io.println('Not connected to a device yet.');
  const a = new Uint8Array(s.length);
  for(let i=0;i<s.length;i++) a[i] = s.charCodeAt(i);
  (function sendNext(o){
    const chunk = o.slice(0, MTU);
    rxCharacteristic.writeValue(chunk).then(()=>{ if(o.length>MTU) sendNext(o.slice(MTU)); });
  })(a);
}

/* ---------- Terminal setup ---------- */
function initContent(io) {
    io.println("\r\n\
Welcome to Web Device CLI V0.1.2 (30.10.2025)\r\n\
Copyright (C) 2019  makerdiary.\r\n\
Copyright (C) 2025  tsotnekarchava.\r\n\
\r\n\
This is a Web Command Line Interface via NUS (Nordic UART Service) using Web Bluetooth.\r\n\
\r\n\
  * Source: https://github.com/NofenceAS/web-device-cli\r\n\
  * Live:   https://nofenceas.github.io/web-device-cli/\r\n\
");
}

function setupHterm(){
  const term = new hterm.Terminal();

  term.onTerminalReady = function(){
    const io = this.io.push();
    io.onVTKeystroke = (str)=>{ nusSendString(str); };
    io.sendString = nusSendString;
    initContent(io);
    this.setCursorVisible(true);
    this.keyboard.characterEncoding = 'raw';
  };

  term.decorate(document.querySelector('#terminal'));
  term.installKeyboard();
  window.term_ = term;

  // Inject bottom padding INSIDE hterm scrollport for extra empty space.
  // (Simple, robust, and doesn't fight hterm's own scrolling.)
  waitForScrollport(doc => {
    const sp = doc.querySelector('.hterm-scrollport') || doc.scrollingElement || doc.documentElement || doc.body;
    sp.style.paddingBottom = '50vh';   // lots of empty space below the last line
  });
}

/* Wait until hterm iframe DOM exists, then run callback with iframe document */
function waitForScrollport(cb){
  const poll = setInterval(()=>{
    const iframe = document.querySelector('#terminal iframe');
    const idoc = iframe && (iframe.contentDocument || iframe.contentWindow?.document);
    if(idoc){
      clearInterval(poll);
      cb(idoc);
    }
  }, 50);
}

/* ---------- Layout: keep terminal below panel, also on small screens ---------- */
function positionTerminal(){
  const panel = document.getElementById('connection-panel');
  const termEl = document.getElementById('terminal');
  if(!panel || !termEl) return;
  const top = panel.offsetTop + panel.offsetHeight + 15; // panel + 15px gap
  termEl.style.top = top + 'px';
}
window.addEventListener('resize', () => positionTerminal());
window.addEventListener('orientationchange', () => positionTerminal());

/* ---------- On-load ---------- */
window.onload = function(){
  lib.init(setupHterm);
  const f = document.getElementById('filterInput');
  if(f) f.value = getSavedFilter();
  positionTerminal();
};

/* Expose functions used in HTML */
window.connectionToggle = connectionToggle;
window.saveFilter = saveFilter;

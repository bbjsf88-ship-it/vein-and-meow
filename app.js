// 和Vein的小世界 v2 - 带云端保存

// ===== 配置 =====
const REPO_OWNER = 'bbjsf88';
const REPO_NAME = 'vein-and-meow';
const DIARY_FOLDER = 'diary';
const TOKEN_KEY = 'vein-meow-token';
const STORAGE_KEY = 'vein-and-meow-data-v2';

// ===== 工具函数 =====
function todayStr() {
const d = new Date();
return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatDateChinese(dateStr) {
const d = new Date(dateStr + 'T00:00:00');
const weekDays = ['周日','周一','周二','周三','周四','周五','周六'];
return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日 · ${weekDays[d.getDay()]}`;
}

function shiftDate(dateStr, days) {
const d = new Date(dateStr + 'T00:00:00');
d.setDate(d.getDate() + days);
return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// 简单的UTF-8 base64编码(GitHub API需要)
function utf8ToBase64(str) {
return btoa(unescape(encodeURIComponent(str)));
}
function base64ToUtf8(str) {
return decodeURIComponent(escape(atob(str)));
}

// ===== Token管理 =====
function getToken() {
return localStorage.getItem(TOKEN_KEY);
}
function saveToken(token) {
localStorage.setItem(TOKEN_KEY, token);
}
function clearToken() {
localStorage.removeItem(TOKEN_KEY);
}

// ===== GitHub API =====
async function githubGet(path) {
const token = getToken();
if (!token) return null;
const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;
try {
const res = await fetch(url, {
headers: {
'Authorization': `token ${token}`,
'Accept': 'application/vnd.github.v3+json'
}
});
if (res.status === 404) return { notFound: true };
if (!res.ok) throw new Error(`GitHub API错误: ${res.status}`);
return await res.json();
} catch (e) {
console.error('githubGet error:', e);
throw e;
}
}

async function githubPut(path, content, message, sha) {
const token = getToken();
if (!token) throw new Error('没有token');
const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;
const body = {
message: message,
content: utf8ToBase64(content)
};
if (sha) body.sha = sha;
const res = await fetch(url, {
method: 'PUT',
headers: {
'Authorization': `token ${token}`,
'Accept': 'application/vnd.github.v3+json',
'Content-Type': 'application/json'
},
body: JSON.stringify(body)
});
if (!res.ok) {
const err = await res.json();
throw new Error(`保存失败: ${err.message || res.status}`);
}
return await res.json();
}

async function githubList(folderPath) {
const token = getToken();
if (!token) return [];
const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${folderPath}`;
try {
const res = await fetch(url, {
headers: {
'Authorization': `token ${token}`,
'Accept': 'application/vnd.github.v3+json'
}
});
if (res.status === 404) return [];
if (!res.ok) throw new Error(`列表错误: ${res.status}`);
return await res.json();
} catch(e) {
console.error('githubList error:', e);
return [];
}
}

// ===== 日记格式 =====
// 一篇日记存成一个json文件: diary/2026-04-30.json
function buildDayData(date, mood_meow, mood_vein, stickies, diary) {
return {
date: date,
mood_meow: mood_meow || '🌸',
mood_vein: mood_vein || '🌙',
stickies: stickies || [],
diary: diary || ''
};
}

// ===== 状态 =====
let currentDate = todayStr();
let currentDay = buildDayData(currentDate, '🌸', '🌙', [], '');
let currentSha = null; // 用于GitHub更新
let archiveDates = []; // 已有日记的日期列表

// 同步状态显示
function setSyncStatus(text, type) {
const el = document.getElementById('sync-status');
el.textContent = text;
el.className = 'small sync-status ' + (type || '');
}

// ===== 本地缓存(降级用) =====
function localGet(date) {
const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
return all[date] || null;
}
function localSet(date, data) {
const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
all[date] = data;
localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}
function localList() {
const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
return Object.keys(all).sort().reverse();
}

// ===== 加载某一天 =====
async function loadDay(date) {
currentDate = date;
setSyncStatus('加载中…', 'syncing');

const token = getToken();
if (token) {
try {
const result = await githubGet(`${DIARY_FOLDER}/${date}.json`);
if (result && !result.notFound) {
currentDay = JSON.parse(base64ToUtf8(result.content));
currentSha = result.sha;
setSyncStatus('已同步 ♡', 'synced');
renderAll();
return;
} else {
// 该日期没有日记
currentDay = buildDayData(date, '🌸', '🌙', [], '');
currentSha = null;
setSyncStatus('新的一天 ♡', 'synced');
renderAll();
return;
}
} catch (e) {
console.error(e);
setSyncStatus('云端连不上,用本地数据', 'error');
}
}

// 降级到本地
const local = localGet(date);
if (local) {
currentDay = local;
} else {
currentDay = buildDayData(date, '🌸', '🌙', [], '');
}
currentSha = null;
if (!token) setSyncStatus('本地保存中', '');
renderAll();
}

// ===== 保存当前一天 =====
let saveTimer = null;
function scheduleSave() {
if (saveTimer) clearTimeout(saveTimer);
setSyncStatus('保存中…', 'syncing');
saveTimer = setTimeout(doSave, 800);
}

async function doSave() {
// 总是先存本地(可靠)
localSet(currentDate, currentDay);

const token = getToken();
if (!token) {
setSyncStatus('本地保存中', '');
return;
}

try {
const content = JSON.stringify(currentDay, null, 2);
const result = await githubPut(
`${DIARY_FOLDER}/${currentDate}.json`,
content,
`更新 ${currentDate}`,
currentSha
);
currentSha = result.content.sha;
setSyncStatus('已同步 ♡', 'synced');
// 更新归档
if (!archiveDates.includes(currentDate)) {
archiveDates.unshift(currentDate);
archiveDates.sort().reverse();
renderArchive();
}
} catch (e) {
console.error(e);
setSyncStatus('云端保存失败,本地已存', 'error');
}
}

// ===== 渲染 =====
function renderDate() {
document.getElementById('today-date').textContent = formatDateChinese(currentDate);
}

function renderMood() {
const meowEl = document.getElementById('mood-meow');
const veinEl = document.getElementById('mood-vein');
meowEl.textContent = currentDay.mood_meow;
veinEl.textContent = currentDay.mood_vein;
// 文字心情用小字号
meowEl.classList.toggle('text-mood', currentDay.mood_meow.length > 4);
veinEl.classList.toggle('text-mood', currentDay.mood_vein.length > 4);
}

function renderStickies() {
const grid = document.getElementById('sticky-grid');
grid.innerHTML = '';
if (!currentDay.stickies || currentDay.stickies.length === 0) {
grid.innerHTML = '<div class="empty-hint">还没有便利贴呀~</div>';
return;
}
currentDay.stickies.forEach((note, idx) => {
const div = document.createElement('div');
const colorClass = note.author === 'Vein' ? 'vein' : 'meow';
div.className = `sticky-note ${colorClass}`;
div.innerHTML = `<div class="sticky-author">${note.author} →</div> <div class="sticky-content"></div>`;
div.querySelector('.sticky-content').textContent = note.content;
div.addEventListener('click', () => {
if (confirm('要撕掉这张便利贴吗?')) {
currentDay.stickies.splice(idx, 1);
scheduleSave();
renderStickies();
}
});
grid.appendChild(div);
});
}

function renderDiary() {
const el = document.getElementById('diary-content');
if (currentDay.diary && currentDay.diary.trim()) {
el.textContent = currentDay.diary;
el.classList.remove('empty');
} else {
el.textContent = '今天还没有写日记呀,点下面的按钮写一篇吧 ♡';
el.classList.add('empty');
}
}

function renderArchive() {
const list = document.getElementById('archive-list');
list.innerHTML = '';
const dates = [...new Set([currentDate, ...archiveDates, ...localList()])].sort().reverse();
if (dates.length === 0) {
list.innerHTML = '<div class="empty-hint">还没有归档~</div>';
return;
}
dates.forEach(date => {
const div = document.createElement('div');
div.className = 'archive-item' + (date === currentDate ? ' current' : '');
const local = localGet(date);
const moodMeow = (date === currentDate ? currentDay.mood_meow : (local?.mood_meow || '·'));
const moodVein = (date === currentDate ? currentDay.mood_vein : (local?.mood_vein || '·'));
div.innerHTML = `<span class="archive-date">${date}</span> <span class="archive-mood"></span>`;
div.querySelector('.archive-mood').textContent = `${moodMeow} ♡ ${moodVein}`;
div.addEventListener('click', () => loadDay(date));
list.appendChild(div);
});
}

function renderAll() {
renderDate();
renderMood();
renderStickies();
renderDiary();
renderArchive();
}

// ===== 加载归档列表 =====
async function loadArchiveList() {
const token = getToken();
if (token) {
try {
const items = await githubList(DIARY_FOLDER);
archiveDates = items
.filter(i => i.name.endsWith('.json'))
.map(i => i.name.replace('.json', ''))
.sort()
.reverse();
} catch(e) {
console.error(e);
}
}
renderArchive();
}

// ===== 心情贴交互 =====
let currentMoodTarget = null;
const emojiModal = document.getElementById('emoji-modal');

function openMoodModal(target) {
currentMoodTarget = target;
document.getElementById('custom-mood').value = '';
emojiModal.classList.add('show');
}
function closeMoodModal() {
emojiModal.classList.remove('show');
currentMoodTarget = null;
}

function applyMood(value) {
if (currentMoodTarget === 'meow') currentDay.mood_meow = value;
else if (currentMoodTarget === 'vein') currentDay.mood_vein = value;
scheduleSave();
renderMood();
closeMoodModal();
}

document.querySelectorAll('.mood-edit-btn').forEach(btn => {
btn.addEventListener('click', () => openMoodModal(btn.dataset.target));
});
document.querySelectorAll('.mood-display').forEach(el => {
el.addEventListener('click', () => {
openMoodModal(el.id === 'mood-meow' ? 'meow' : 'vein');
});
});
document.querySelectorAll('.emoji-option').forEach(opt => {
opt.addEventListener('click', () => applyMood(opt.textContent));
});
document.getElementById('custom-mood-confirm').addEventListener('click', () => {
const val = document.getElementById('custom-mood').value.trim();
if (val) applyMood(val);
});
document.getElementById('emoji-close').addEventListener('click', closeMoodModal);

// ===== 日记交互 =====
const diaryModal = document.getElementById('diary-modal');
document.getElementById('edit-diary').addEventListener('click', () => {
document.getElementById('diary-input').value = currentDay.diary || '';
diaryModal.classList.add('show');
});
document.getElementById('diary-save').addEventListener('click', () => {
currentDay.diary = document.getElementById('diary-input').value;
scheduleSave();
renderDiary();
diaryModal.classList.remove('show');
});
document.getElementById('diary-close').addEventListener('click', () => {
diaryModal.classList.remove('show');
});

// ===== 便利贴交互 =====
const stickyModal = document.getElementById('sticky-modal');
let stickyAuthor = '咩宝';
document.querySelectorAll('.add-btn[data-author]').forEach(btn => {
btn.addEventListener('click', () => {
stickyAuthor = btn.dataset.author;
document.getElementById('sticky-modal-title').textContent = `${stickyAuthor}的便利贴 ♡`;
document.getElementById('sticky-input').value = '';
stickyModal.classList.add('show');
});
});
document.getElementById('sticky-save').addEventListener('click', () => {
const content = document.getElementById('sticky-input').value.trim();
if (!content) return;
if (!currentDay.stickies) currentDay.stickies = [];
currentDay.stickies.push({ author: stickyAuthor, content: content });
scheduleSave();
renderStickies();
stickyModal.classList.remove('show');
});
document.getElementById('sticky-close').addEventListener('click', () => {
stickyModal.classList.remove('show');
});

// ===== 日期切换 =====
document.getElementById('prev-day').addEventListener('click', () => {
loadDay(shiftDate(currentDate, -1));
});
document.getElementById('next-day').addEventListener('click', () => {
loadDay(shiftDate(currentDate, 1));
});

// ===== Token弹窗 =====
const tokenModal = document.getElementById('token-modal');
document.getElementById('token-save').addEventListener('click', () => {
const val = document.getElementById('token-input').value.trim();
if (!val) return;
saveToken(val);
tokenModal.classList.remove('show');
loadDay(currentDate).then(loadArchiveList);
});
document.getElementById('token-skip').addEventListener('click', () => {
tokenModal.classList.remove('show');
loadDay(currentDate);
});

// ===== 初始化 =====
async function init() {
if (!getToken()) {
tokenModal.classList.add('show');
// 先加载本地能展示的内容
loadDay(currentDate);
} else {
await loadDay(currentDate);
loadArchiveList();
}
}

init();

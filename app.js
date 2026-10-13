const STORAGE_KEY = "little-progress-v2";
const PENDING_KEY = `${STORAGE_KEY}-pending`;
const DAY_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const SHORT_DAY_NAMES = ["一", "二", "三", "四", "五", "六", "日"];

try {
  localStorage.removeItem("little-progress-v1");
} catch (error) {
  console.warn("无法清理旧版本地缓存", error);
}

let state = loadState();
let currentWeekStart = getMonday(new Date());
let selectedDate = formatDate(new Date());
let activeView = "week";
let toastTimer;
let pendingMutations = loadPendingMutations();
let syncInFlight = false;
let syncQueued = false;
let serverAvailable = navigator.onLine;

const elements = {
  pageTitle: document.querySelector("#page-title"),
  currentDate: document.querySelector("#current-date"),
  totalPoints: document.querySelector("#total-points"),
  weekCompleted: document.querySelector("#week-completed"),
  weekRange: document.querySelector("#week-range"),
  weekLabel: document.querySelector("#week-label"),
  weekdayStrip: document.querySelector("#weekday-strip"),
  courseList: document.querySelector("#course-list"),
  weekView: document.querySelector("#week-view"),
  detailsView: document.querySelector("#details-view"),
  detailsCount: document.querySelector("#details-count"),
  detailsSummary: document.querySelector("#details-summary"),
  ledger: document.querySelector("#ledger"),
  detailsFilter: document.querySelector("#details-filter"),
  modal: document.querySelector("#course-modal"),
  courseForm: document.querySelector("#course-form"),
  courseId: document.querySelector("#course-id"),
  courseDate: document.querySelector("#course-date"),
  courseNote: document.querySelector("#course-note"),
  modalTitle: document.querySelector("#modal-title"),
  saveCourseButton: document.querySelector("#save-course-button"),
  syncStatus: document.querySelector("#sync-status"),
  toast: document.querySelector("#toast")
};

function getMonday(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  return result;
}

function addDays(date, amount) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatMonthDay(value) {
  const date = typeof value === "string" ? parseDate(value) : value;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatLongDate(date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function isSameDate(a, b) {
  return formatDate(a) === formatDate(b);
}

function emptyState() {
  return { courses: [], customCourses: [], activities: [] };
}

function stripPresetData(savedState) {
  return {
    ...savedState,
    courses: (savedState.courses || []).filter((course) => !String(course.id || "").startsWith("seed-")),
    customCourses: Array.isArray(savedState.customCourses) ? savedState.customCourses : [],
    activities: (savedState.activities || []).filter((activity) =>
      !String(activity.id || "").startsWith("history-") && !String(activity.courseId || "").startsWith("seed-")
    )
  };
}

function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && Array.isArray(parsed.courses) && Array.isArray(parsed.activities)) return stripPresetData(parsed);
    }
  } catch (error) {
    console.warn("无法读取本地学习记录", error);
  }
  return emptyState();
}

function loadPendingMutations() {
  try {
    const saved = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function newId(prefix) {
  return `${prefix}-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function cacheState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem(PENDING_KEY, JSON.stringify(pendingMutations));
  } catch (error) {
    console.warn("无法保存本机学习记录", error);
    showToast("本机存储不可用，请保持联网并重试");
  }
}

function persist(mutation) {
  if (mutation) pendingMutations.push({ ...mutation, id: newId("change") });
  cacheState();
  updateSyncStatus();
  if (syncInFlight) syncQueued = true;
  else syncFromServer();
}

function updateSyncStatus() {
  const hasServer = canSync();
  const showStatus = hasServer && (!navigator.onLine || !serverAvailable || pendingMutations.length > 0);
  elements.syncStatus.classList.toggle("is-hidden", !showStatus);
  elements.syncStatus.textContent = pendingMutations.length
    ? `${!navigator.onLine || !serverAvailable ? "离线" : "同步中"} · ${pendingMutations.length} 项待同步`
    : "离线";
}

function canSync() {
  return window.pointsCardNative ? window.pointsCardNative.hasSyncServer() : /^https?:$/.test(window.location.protocol);
}

function applyMutations(savedState, mutations) {
  const next = JSON.parse(JSON.stringify(savedState));
  for (const mutation of mutations) {
    const courseId = mutation.courseId || mutation.course?.id;
    const course = [...next.courses, ...next.customCourses].find((item) => item.id === courseId);
    if (mutation.type === "save-course") {
      if (course) {
        const { title, date, note, points } = mutation.course;
        Object.assign(course, { title, date, note, points });
      } else if (mutation.creating) {
        next.customCourses.push({ ...mutation.course, completed: false });
      }
    } else if (mutation.type === "delete-course") {
      next.courses = next.courses.filter((item) => item.id !== courseId);
      next.customCourses = next.customCourses.filter((item) => item.id !== courseId);
      next.activities = next.activities.filter((item) => item.courseId !== courseId);
    } else if (mutation.type === "complete-course" && course) {
      course.completed = mutation.completed;
      const exists = next.activities.some((item) => item.courseId === courseId);
      if (mutation.completed && !exists) {
        next.activities.push({ id: `activity-${courseId}`, courseId, date: course.date, title: course.title, points: 1 });
      } else if (!mutation.completed) {
        next.activities = next.activities.filter((item) => item.courseId !== courseId);
      }
    }
  }
  return next;
}

async function requestState(options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    if (window.pointsCardNative) return await window.pointsCardNative.requestState({ ...options, signal: controller.signal });
    return await fetch("/api/state", { ...options, cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function syncFromServer(initial = false) {
  if (!canSync()) { updateSyncStatus(); return; }
  if (syncInFlight) return;
  if (!navigator.onLine) {
    serverAvailable = false;
    updateSyncStatus();
    return;
  }
  syncInFlight = true;
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await requestState();
      if (!response.ok) throw new Error(`读取失败：${response.status}`);
      const loaded = await response.json();
      const remoteState = loaded === null ? state : loaded;
      if (!remoteState || !Array.isArray(remoteState.courses) || !Array.isArray(remoteState.activities)) throw new Error("无效的服务端记录");
      const cleanRemoteState = stripPresetData(remoteState);
      const hasPresetData = JSON.stringify(cleanRemoteState) !== JSON.stringify(remoteState);
      const batch = pendingMutations.slice();
      const merged = applyMutations(cleanRemoteState, batch);
      if (batch.length || hasPresetData || loaded === null) {
        const etag = response.headers.get("ETag");
        if (!etag) throw new Error("请重启服务以启用应用同步");
        const saved = await requestState({
          method: "PUT",
          headers: { "Content-Type": "application/json", "If-Match": etag },
          body: JSON.stringify(merged)
        });
        if (saved.status === 412) continue;
        if (!saved.ok) throw new Error(`保存失败：${saved.status}`);
      }
      const syncedIds = new Set(batch.map((mutation) => mutation.id));
      pendingMutations = pendingMutations.filter((mutation) => !syncedIds.has(mutation.id));
      state = applyMutations(merged, pendingMutations);
      cacheState();
      render();
      if (!initial && !serverAvailable) showToast(batch.length ? "离线记录已同步" : "已恢复连接");
      serverAvailable = true;
      return;
    }
    throw new Error("其他设备正在更新，将稍后重试");
  } catch (error) {
    console.warn("无法连接学习记录服务", error);
    serverAvailable = false;
  } finally {
    syncInFlight = false;
    updateSyncStatus();
    if (syncQueued) {
      syncQueued = false;
      syncFromServer();
    }
  }
}

function getCoursesForWeek(weekStart) {
  const start = formatDate(weekStart);
  const end = formatDate(addDays(weekStart, 6));
  return [...state.courses, ...state.customCourses]
    .filter((course) => course.date >= start && course.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function getCoursesForDate(date) {
  return getCoursesForWeek(currentWeekStart).filter((course) => course.date === formatDate(date));
}

function getTotalPoints() {
  return state.activities.reduce((sum, activity) => sum + Number(activity.points || 1), 0);
}

function getCompletedCoursesForWeek() {
  return getCoursesForWeek(currentWeekStart).filter((course) => course.completed);
}

function renderSummary() {
  const weekCourses = getCoursesForWeek(currentWeekStart);
  const completed = weekCourses.filter((course) => course.completed).length;
  elements.totalPoints.textContent = getTotalPoints();
  elements.weekCompleted.textContent = `${completed} / ${weekCourses.length}`;
}

function renderWeekHeader() {
  const today = new Date();
  const weekEnd = addDays(currentWeekStart, 6);
  elements.currentDate.textContent = `${formatLongDate(today)} · ${DAY_NAMES[(today.getDay() || 7) - 1]}`;
  elements.weekRange.textContent = `${formatMonthDay(currentWeekStart)} - ${formatMonthDay(weekEnd)}`;
  elements.weekLabel.textContent = isSameDate(currentWeekStart, getMonday(new Date())) ? "本周" : `${formatMonthDay(currentWeekStart)}`;
}

function renderWeekdays() {
  const today = new Date();
  elements.weekdayStrip.innerHTML = DAY_NAMES.map((name, index) => {
    const date = addDays(currentWeekStart, index);
    const dateValue = formatDate(date);
    const isSelected = dateValue === selectedDate;
    const isToday = isSameDate(date, today);
    const dayCourseCount = getCoursesForDate(date).length;
    return `<button class="day-tab${isSelected ? " is-selected" : ""}${isToday ? " is-today" : ""}" type="button" data-date="${dateValue}" aria-label="${name} ${formatMonthDay(date)}，${dayCourseCount}项课程">
      <span class="day-number">${date.getDate()}</span>
      <span class="day-name">${SHORT_DAY_NAMES[index]}</span>
    </button>`;
  }).join("");
}

function renderCourses() {
  const courses = getCoursesForDate(parseDate(selectedDate));
  if (!courses.length) {
    elements.courseList.innerHTML = `<div class="empty-state">这一天暂时没有课程，点击右上角添加一项吧。</div>`;
    return;
  }
  elements.courseList.innerHTML = courses.map((course) => {
    const completed = course.completed;
    return `<article class="course-row${completed ? " is-completed" : ""}">
      <div class="course-main">
        <strong>${escapeHtml(course.title)}</strong>
        ${course.note ? `<span>${escapeHtml(course.note)}</span>` : ""}
      </div>
      <div class="course-actions">
        <button class="complete-button${completed ? " is-completed" : ""}" type="button" data-toggle-course="${escapeHtml(course.id)}">
          <span class="check-symbol" aria-hidden="true">${completed ? "✓" : "＋"}</span>${completed ? "已完成" : "打卡 +1"}
        </button>
        <button class="row-action" type="button" data-edit-course="${escapeHtml(course.id)}" aria-label="编辑${escapeHtml(course.title)}" title="编辑课程">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>
        </button>
        <button class="row-action is-destructive" type="button" data-delete-course="${escapeHtml(course.id)}" aria-label="删除${escapeHtml(course.title)}" title="删除课程">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>
        </button>
      </div>
    </article>`;
  }).join("");
}

function getLedgerEntries() {
  return [...state.activities]
    .sort((a, b) => b.date.localeCompare(a.date));
}

function renderDetails() {
  const allEntries = getLedgerEntries();
  const currentWeekEntries = allEntries.filter((entry) => entry.date >= formatDate(currentWeekStart) && entry.date <= formatDate(addDays(currentWeekStart, 6)));
  const entries = elements.detailsFilter.value === "week" ? currentWeekEntries : allEntries;
  elements.detailsCount.textContent = `共 ${entries.length} 条记录`;
  elements.detailsSummary.innerHTML = `<div class="details-summary-item"><strong>${getTotalPoints()}</strong><span>累计积分</span></div><div class="details-summary-item"><strong>${allEntries.length}</strong><span>完成课程</span></div><div class="details-summary-item"><strong>${currentWeekEntries.length}</strong><span>本周获得</span></div>`;
  if (!entries.length) {
    elements.ledger.innerHTML = `<div class="empty-state">还没有积分记录。</div>`;
    return;
  }
  elements.ledger.innerHTML = entries.map((entry) => `<div class="ledger-row">
    <div class="ledger-date"><strong>${formatMonthDay(entry.date)}</strong><span>${getWeekdayLabel(entry.date)}</span></div>
    <div class="ledger-course"><strong>${escapeHtml(entry.title)}</strong><span>完成学习</span></div>
    <div class="ledger-points">+${entry.points || 1} 分</div>
  </div>`).join("");
}

function getWeekdayLabel(value) {
  const date = parseDate(value);
  return DAY_NAMES[(date.getDay() || 7) - 1];
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function render() {
  renderSummary();
  renderWeekHeader();
  renderWeekdays();
  renderCourses();
  renderDetails();
  elements.weekView.classList.toggle("is-hidden", activeView !== "week");
  elements.detailsView.classList.toggle("is-hidden", activeView !== "details");
  elements.pageTitle.textContent = activeView === "week" ? "积分卡" : "积分明细";
  document.querySelectorAll("[data-view-target]").forEach((button) => button.classList.toggle("is-active", button.dataset.viewTarget === activeView));
}

function setView(view) {
  activeView = view;
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function toggleCourse(courseId) {
  const allCourses = [...state.courses, ...state.customCourses];
  const course = allCourses.find((item) => item.id === courseId);
  if (!course) return;
  course.completed = !course.completed;
  const activityIndex = state.activities.findIndex((activity) => activity.courseId === courseId);
  if (course.completed && activityIndex === -1) {
    state.activities.push({
      id: `activity-${course.id}`,
      courseId: course.id,
      date: course.date,
      title: course.title,
      points: 1
    });
    showToast(`完成「${course.title}」，积分 +1`);
  } else if (!course.completed && activityIndex !== -1) {
    state.activities.splice(activityIndex, 1);
    showToast(`已取消「${course.title}」的打卡`);
  }
  persist({ type: "complete-course", courseId, completed: course.completed });
  render();
}

function shiftWeek(amount) {
  currentWeekStart = addDays(currentWeekStart, amount * 7);
  selectedDate = formatDate(currentWeekStart);
  render();
}

function openModal(courseId = "") {
  elements.courseForm.reset();
  const course = [...state.courses, ...state.customCourses].find((item) => item.id === courseId);
  elements.courseId.value = course?.id || "";
  elements.modalTitle.textContent = course ? "编辑课程" : "添加课程";
  elements.saveCourseButton.textContent = course ? "保存修改" : "保存课程";
  elements.courseDate.value = course?.date || selectedDate;
  if (course) {
    document.querySelector("#course-title").value = course.title;
    elements.courseNote.value = course.note || "";
  }
  elements.modal.classList.remove("is-hidden");
  elements.modal.setAttribute("aria-hidden", "false");
  document.querySelector("#course-title").focus();
}

function closeModal() {
  elements.modal.classList.add("is-hidden");
  elements.modal.setAttribute("aria-hidden", "true");
  elements.courseForm.reset();
}

function saveCourse(event) {
  event.preventDefault();
  const data = new FormData(elements.courseForm);
  const courseId = data.get("courseId");
  const courseData = {
    title: data.get("title").trim(),
    date: data.get("date"),
    note: data.get("note").trim(),
    points: 1
  };
  let course = [...state.courses, ...state.customCourses].find((item) => item.id === courseId);
  const isEditing = Boolean(course);
  if (course) {
    Object.assign(course, courseData);
  } else {
    course = { id: newId("custom"), ...courseData, completed: false };
    state.customCourses.push(course);
  }
  persist({ type: "save-course", course: { ...course }, creating: !isEditing });
  currentWeekStart = getMonday(parseDate(course.date));
  selectedDate = course.date;
  closeModal();
  activeView = "week";
  render();
  showToast(isEditing ? "课程内容已更新" : "课程已添加到学习安排");
}

function deleteCourse(courseId) {
  const course = [...state.courses, ...state.customCourses].find((item) => item.id === courseId);
  if (!course) return;
  const pointsNote = course.completed ? "这门课获得的积分和明细也会删除。" : "";
  if (!window.confirm(`确定删除「${course.title}」吗？${pointsNote}`)) return;
  state.courses = state.courses.filter((item) => item.id !== courseId);
  state.customCourses = state.customCourses.filter((item) => item.id !== courseId);
  state.activities = state.activities.filter((activity) => activity.courseId !== courseId);
  persist({ type: "delete-course", courseId });
  render();
  showToast("课程已删除");
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 2400);
}

document.addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-view-target]");
  if (viewButton) setView(viewButton.dataset.viewTarget);

  const dayButton = event.target.closest("[data-date]");
  if (dayButton) {
    selectedDate = dayButton.dataset.date;
    renderWeekdays();
    renderCourses();
  }

  const toggleButton = event.target.closest("[data-toggle-course]");
  if (toggleButton) toggleCourse(toggleButton.dataset.toggleCourse);

  const editButton = event.target.closest("[data-edit-course]");
  if (editButton) openModal(editButton.dataset.editCourse);

  const deleteButton = event.target.closest("[data-delete-course]");
  if (deleteButton) deleteCourse(deleteButton.dataset.deleteCourse);
});

document.querySelector("#previous-week").addEventListener("click", () => shiftWeek(-1));
document.querySelector("#next-week").addEventListener("click", () => shiftWeek(1));
document.querySelector("#add-course-button").addEventListener("click", openModal);
document.querySelector("#close-modal").addEventListener("click", closeModal);
document.querySelector("#cancel-modal").addEventListener("click", closeModal);
document.querySelector("#course-form").addEventListener("submit", saveCourse);
document.querySelector("#details-filter").addEventListener("change", renderDetails);
document.querySelector("#course-modal").addEventListener("click", (event) => {
  if (event.target.id === "course-modal") closeModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.modal.classList.contains("is-hidden")) closeModal();
});

render();
updateSyncStatus();
syncFromServer(true);
setInterval(() => syncFromServer(false), 12000);
window.addEventListener("online", () => syncFromServer());
window.addEventListener("offline", updateSyncStatus);
window.addEventListener("android-sync-config-changed", () => {
  updateSyncStatus();
  syncFromServer();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") syncFromServer();
});

(() => {
  const STORAGE_KEY = 'xiangqianyidian.data.v1';
  const quadrantNames = { q1: '重要且紧急', q2: '重要不紧急', q3: '不重要但紧急', q4: '不重要且不紧急' };
  const levelNames = { semester: '学期目标', month: '月份目标', week: '周目标' };
  const levelIcons = { semester: '✧', month: '▦', week: '▤' };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const localDate = (date = new Date()) => {
    const offset = date.getTimezoneOffset();
    return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
  };
  const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const freshState = () => ({ version: 1, goals: [], tasks: [], sessions: [], reviews: [], dailyPlans: {}, breakReminder: true });
  let state = freshState();
  let currentView = 'today';
  let reviewPeriod = 'day';
  let editingTaskId = null;
  let matrixMobileQuadrant = 'q1';
  let timer = { running: false, mode: 'focus', remaining: 25 * 60, duration: 25 * 60, startedAt: null, interval: null };
  let toastTimeout;
  let storageAvailable = true;

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.version === 1) {
        state = { ...freshState(), ...parsed };
        state.goals = state.goals.map(goal => goal.level === 'short' ? { ...goal, level: 'week' } : goal);
        state.goals.forEach(goal => { if (!goal.quadrant) goal.quadrant = 'q2'; });
      }
    }
  } catch (error) {
    storageAvailable = false;
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      storageAvailable = true;
      return true;
    } catch (error) {
      storageAvailable = false;
      showToast('浏览器无法保存数据，请检查存储空间或隐私设置。');
      return false;
    }
  }

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function formatMinutes(minutes) {
    const value = Math.max(0, Math.round(Number(minutes) || 0));
    if (value >= 60) {
      const hours = Math.floor(value / 60);
      const remainder = value % 60;
      return remainder ? `${hours} 小时 ${remainder} 分钟` : `${hours} 小时`;
    }
    return `${value} 分钟`;
  }

  function formatDate(dateString, options = { month: 'long', day: 'numeric', weekday: 'short' }) {
    return new Intl.DateTimeFormat('zh-CN', options).format(new Date(`${dateString}T12:00:00`));
  }

  function tasksForDate(date = localDate()) {
    return state.tasks.filter(task => task.date === date);
  }

  function sessionsForDate(date = localDate()) {
    return state.sessions.filter(session => session.date === date);
  }

  function sessionMinutes(date = localDate()) {
    return sessionsForDate(date).reduce((sum, session) => sum + session.minutes, 0);
  }

  function planMinutes(date = localDate()) {
    if (Object.hasOwn(state.dailyPlans, date)) return state.dailyPlans[date];
    return tasksForDate(date).reduce((sum, task) => sum + task.minutes, 0);
  }

  function taskProgress(date = localDate()) {
    const tasks = tasksForDate(date);
    return { complete: tasks.filter(task => task.done).length, total: tasks.length };
  }

  function navigate(view) {
    currentView = view;
    $$('.nav-link').forEach(button => button.classList.toggle('active', button.dataset.view === view));
    $$('.view').forEach(section => section.classList.toggle('active-view', section.id === `${view}View`));
    const titles = { today: '今天，向前一点', plan: '计划，让目标落地', focus: '专注当下', review: '回看与调整' };
    $('#viewHeading').textContent = titles[view];
    if (view === 'review') renderReviews();
    if (view === 'focus') renderFocus();
    if (view === 'plan') renderPlan();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderHeader() {
    const now = new Date();
    $('#topDate').textContent = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(now);
    $('#todayLabel').textContent = formatDate(localDate(), { month: 'long', day: 'numeric', weekday: 'long' });
    const hour = now.getHours();
    $('#greeting').textContent = hour < 11 ? '早上好，一步一步来。' : hour < 18 ? '一步一步来，今天也能有所收获。' : '辛苦了，今天的努力值得被看见。';
  }

  function renderToday() {
    const date = localDate();
    const tasks = tasksForDate(date);
    const progress = taskProgress(date);
    $('#plannedSummary').textContent = formatMinutes(planMinutes(date));
    $('#actualSummary').textContent = formatMinutes(sessionMinutes(date));
    $('#focusCountSummary').textContent = sessionsForDate(date).length ? `${sessionsForDate(date).length} 段专注记录` : '还没有专注记录';
    $('#taskSummary').textContent = `${progress.complete} / ${progress.total}`;
    $('#dailyPlanHours').value = (planMinutes(date) / 60).toString();

    if (!tasks.length) {
      $('#todayTasks').innerHTML = `<div class="empty-state"><span class="empty-symbol">＋</span><strong>今天还没有安排任务</strong><p>从一件小事开始，让目标慢慢落地。</p><button class="button button-soft" data-action="new-task">添加今天的任务</button></div>`;
    } else {
      $('#todayTasks').innerHTML = Object.entries(quadrantNames).map(([key, label]) => {
        const grouped = tasks.filter(task => task.quadrant === key).sort((a, b) => Number(a.done) - Number(b.done));
        if (!grouped.length) return '';
        return `<section class="today-priority-group" data-priority="${key}"><h3>${label}<span>${grouped.length} 项</span></h3>${grouped.map(task => {
          const goal = state.goals.find(item => item.id === task.goalId);
          return `<div class="task-row ${task.done ? 'completed' : ''}"><input class="task-check" type="checkbox" data-task-done="${task.id}" ${task.done ? 'checked' : ''} aria-label="完成 ${escapeHtml(task.title)}"><div class="task-name"><strong>${escapeHtml(task.title)}</strong><small>${goal ? escapeHtml(goal.title) : '未关联目标'}</small></div><span class="task-minutes">${task.minutes ? `${task.minutes} 分` : '未设时长'}</span><button class="task-more" data-edit-task="${task.id}" aria-label="编辑任务">编辑</button><button class="task-delete" data-delete-task="${task.id}" aria-label="删除 ${escapeHtml(task.title)}" title="删除任务">×</button></div>`;
        }).join('')}</section>`;
      }).join('');
    }

    const done = progress.total > 0 && progress.complete === progress.total;
    const actual = sessionMinutes(date);
    let message = '不用一下子做完所有事。<br>先挑一件开始吧。';
    if (done && actual) message = '今天安排的任务都完成了。<br>记得也给自己一点休息。';
    else if (actual >= 60) message = '你已经为学习留出了一段时间。<br>这份投入很扎实。';
    else if (progress.complete > 0) message = '有一件事已经完成了。<br>小小的进展也算数。';
    else if (progress.total > 0) message = '先从最容易开始的一项做起。<br>不需要一次做完全部。';
    $('#encouragement p').innerHTML = message;
  }

  function childrenOf(goalId) {
    return state.goals.filter(goal => goal.parentId === goalId);
  }

  function goalMarkup(goal, depth = 0) {
    const dateText = goal.due ? ` · ${formatDate(goal.due, { month: 'short', day: 'numeric' })} 前` : '';
    const children = childrenOf(goal.id);
    const associated = state.tasks.filter(task => task.goalId === goal.id).length;
    const nextAction = goal.level === 'week'
      ? `<button class="mini-button" data-add-task-for-goal="${goal.id}">＋ 加任务</button>`
      : `<button class="mini-button" data-add-child="${goal.id}">＋ 拆解</button>`;
    return `<div class="goal-item"><div class="goal-main"><span class="goal-level">${levelIcons[goal.level] || levelIcons.week}</span><div class="goal-copy"><strong>${escapeHtml(goal.title)}</strong><small>${levelNames[goal.level] || levelNames.week}${dateText} · ${associated} 项任务 · ${quadrantNames[goal.quadrant] || quadrantNames.q2}</small></div><div class="goal-actions">${nextAction}<button class="mini-button" data-delete-goal="${goal.id}">删除</button></div></div>${children.length ? `<div class="goal-children">${children.map(child => goalMarkup(child, depth + 1)).join('')}</div>` : ''}</div>`;
  }

  function renderPlan() {
    const roots = state.goals.filter(goal => !goal.parentId);
    $('#goalsTree').innerHTML = roots.length ? roots.map(goal => goalMarkup(goal)).join('') : `<div class="empty-state"><span class="empty-symbol">✧</span><strong>还没有目标</strong><p>先写下你这个学期或这个月想完成的一件事。</p><button class="button button-soft" data-action="new-goal">创建第一个目标</button></div>`;
    const goalOptions = state.goals.map(goal => `<option value="${goal.id}">${'　'.repeat(Math.min(goal.depth || 0, 3))}${escapeHtml(goal.title)}</option>`).join('');
    $('#taskGoal').innerHTML = `<option value="">暂不关联</option>${goalOptions}`;
    const groups = { q1: [], q2: [], q3: [], q4: [] };
    state.goals.forEach(goal => (groups[goal.quadrant || 'q2']).push({ id: goal.id, title: goal.title, kind: '目标', quadrant: goal.quadrant || 'q2' }));
    state.tasks.filter(task => !task.done).forEach(task => (groups[task.quadrant] || groups.q2).push({ id: task.id, title: task.title, kind: '任务', quadrant: task.quadrant || 'q2' }));
    $('#matrixGrid').innerHTML = Object.entries(quadrantNames).map(([key, name]) => `<section class="matrix-cell ${key === matrixMobileQuadrant ? 'mobile-active' : ''}" data-quadrant="${key}"><h3>${name}<span>${groups[key].length} 项</span></h3>${groups[key].length ? groups[key].map(item => `<div class="matrix-task"><span><small>${item.kind}</small>${escapeHtml(item.title)}</span><select data-${item.kind === '目标' ? 'goal' : 'task'}-quadrant="${item.id}" aria-label="调整 ${escapeHtml(item.title)} 优先级">${Object.entries(quadrantNames).map(([value, label]) => `<option value="${value}" ${item.quadrant === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div>`).join('') : `<div class="matrix-empty">暂时没有目标或任务</div>`}</section>`).join('');
    $('#matrixTabs').innerHTML = Object.entries(quadrantNames).map(([key, label]) => `<button class="matrix-tab ${key === matrixMobileQuadrant ? 'active' : ''}" data-matrix-tab="${key}">${label}</button>`).join('');
  }

  function renderFocus() {
    const options = state.tasks.filter(task => task.date === localDate() && !task.done).map(task => `<option value="${task.id}">${escapeHtml(task.title)}</option>`).join('');
    const selected = $('#focusTask').value;
    $('#focusTask').innerHTML = `<option value="">自由专注</option>${options}`;
    if (options && selected) $('#focusTask').value = selected;
    $('#breakReminder').checked = state.breakReminder;
    updateTimerUI();
    $('#focusTodayTotal').textContent = formatMinutes(sessionMinutes());
    const sessions = sessionsForDate().slice().reverse();
    $('#focusSessions').innerHTML = sessions.length ? sessions.slice(0, 5).map(session => `<div class="session-row"><span>${escapeHtml(session.taskTitle || '自由专注')}</span><span>${session.minutes} 分钟</span></div>`).join('') : `<div class="empty-state"><span class="empty-symbol">◷</span><strong>还没有专注记录</strong><p>完成一段专注后，记录会显示在这里。</p></div>`;
  }

  function weekBounds(dateString) {
    const date = new Date(`${dateString}T12:00:00`);
    const weekday = date.getDay() || 7;
    const monday = new Date(date);
    monday.setDate(date.getDate() - weekday + 1);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { start: localDate(monday), end: localDate(sunday) };
  }

  function reviewKey() {
    const date = $('#reviewDate').value || localDate();
    return reviewPeriod === 'day' ? `day:${date}` : `week:${weekBounds(date).start}`;
  }

  function currentReview() {
    return state.reviews.find(review => review.key === reviewKey());
  }

  function isLowSignal(text) {
    const compact = Array.from(text.trim().replace(/[\s.,，。!！?？、]/gu, ''));
    if (compact.length < 6) return false;
    return /^(.)\1+$/u.test(compact.join('')) || /^\d+$/u.test(compact.join('')) || new Set(compact).size <= 2;
  }

  function reviewFeedback(fields) {
    const labels = { wins: '进展', blockers: '分心或卡住的地方', next: '下一步尝试' };
    const lowSignal = Object.entries(fields).filter(([, value]) => value && isLowSignal(value)).map(([key]) => labels[key]);
    if (lowSignal.length) {
      return `“${lowSignal.join('、')}”这部分像是重复字符或数字。随手记下也没关系；试着补一个真实的小细节，或当时的感受，就能帮你更清楚地找到下一步。`;
    }
    const filled = Object.values(fields).filter(Boolean).length;
    if (!filled) return '今天暂时没有写下内容也没关系。之后想起来时，可以补记一件小进展或一个想尝试的调整。';
    return '谢谢你把这些写下来。看见一点进展和一个可尝试的调整，就已经是在为下一步做准备。';
  }

  function renderReviews() {
    const date = $('#reviewDate').value || localDate();
    if (!$('#reviewDate').value) $('#reviewDate').value = localDate();
    const bounds = weekBounds(date);
    const chosenDate = reviewPeriod === 'day' ? date : bounds.start;
    const relevantTasks = state.tasks.filter(task => reviewPeriod === 'day' ? task.date === date : task.date >= bounds.start && task.date <= bounds.end);
    const relevantSessions = state.sessions.filter(session => reviewPeriod === 'day' ? session.date === date : session.date >= bounds.start && session.date <= bounds.end);
    const completed = relevantTasks.filter(task => task.done).length;
    const planned = reviewPeriod === 'day' ? planMinutes(date) : relevantTasks.reduce((sum, task) => sum + task.minutes, 0);
    const actual = relevantSessions.reduce((sum, session) => sum + session.minutes, 0);
    $('#reviewPeriodLabel').textContent = reviewPeriod === 'day' ? 'DAILY CHECK-IN' : 'WEEKLY CHECK-IN';
    $('#reviewTitle').textContent = reviewPeriod === 'day' ? '今天过得怎么样？' : '这周有哪些发现？';
    $('#reviewStats').innerHTML = `<div class="review-stat"><strong>${formatMinutes(planned)}</strong><small>计划学习</small></div><div class="review-stat"><strong>${formatMinutes(actual)}</strong><small>实际专注</small></div><div class="review-stat"><strong>${completed} / ${relevantTasks.length}</strong><small>完成任务</small></div>`;
    const review = currentReview();
    $('#reviewWins').value = review?.wins || '';
    $('#reviewBlockers').value = review?.blockers || '';
    $('#reviewNext').value = review?.next || '';
    $('#reviewMessage').textContent = review?.feedback || '';
    const history = state.reviews.slice().sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    $('#reviewHistory').innerHTML = history.length ? history.slice(0, 8).map(item => `<button type="button" class="past-review" data-open-review="${escapeHtml(item.key)}"><strong>${item.period === 'day' ? '每日复盘' : '每周复盘'} · ${escapeHtml(item.label)}</strong><small>${new Date(item.savedAt).toLocaleDateString('zh-CN')} · 点击查看或继续编辑</small><span class="past-review-fields"><span><b>进展</b>${item.wins ? escapeHtml(item.wins) : '未填写'}</span><span><b>分心 / 卡住</b>${item.blockers ? escapeHtml(item.blockers) : '未填写'}</span><span><b>下一步尝试</b>${item.next ? escapeHtml(item.next) : '未填写'}</span></span>${item.feedback ? `<span class="past-review-feedback">${escapeHtml(item.feedback)}</span>` : ''}</button>`).join('') : `<div class="empty-state"><span class="empty-symbol">✎</span><strong>还没有复盘记录</strong><p>写下这一周或今天的一点发现，之后可以回来看看。</p></div>`;
    $('#reviewForm').dataset.date = chosenDate;
  }

  function updateTimerUI() {
    const minutes = Math.floor(timer.remaining / 60).toString().padStart(2, '0');
    const seconds = (timer.remaining % 60).toString().padStart(2, '0');
    $('#timerDisplay').textContent = `${minutes}:${seconds}`;
    $('#timerMode').textContent = timer.mode === 'focus' ? '专注时间' : '休息时间';
    $('#timerStatus').textContent = timer.running ? '这一刻，只做眼前的事' : timer.remaining === 0 ? '这一段结束了，做得很好' : timer.remaining < timer.duration ? '已暂停，剩余时间已保留' : '准备好了就开始';
    const startLabel = timer.mode === 'break' ? '开始休息' : '开始专注';
    const continueLabel = timer.mode === 'break' ? '继续休息' : '继续专注';
    $('#timerToggle').textContent = timer.running ? '暂停计时' : timer.remaining < timer.duration && timer.remaining > 0 ? continueLabel : startLabel;
    $('#timerReset').disabled = timer.running;
    $('#timerSave').disabled = timer.mode !== 'focus' || timer.duration - timer.remaining < 60;
  }

  function setTimerLength(minutes) {
    if (timer.running) return;
    timer.mode = 'focus';
    timer.duration = minutes * 60;
    timer.remaining = timer.duration;
    $$('.length-choice').forEach(button => button.classList.toggle('selected', Number(button.dataset.minutes) === minutes));
    updateTimerUI();
  }

  function finishTimer(completed = false) {
    clearInterval(timer.interval);
    timer.running = false;
    const elapsedSeconds = timer.duration - timer.remaining;
    if (timer.mode === 'focus' && elapsedSeconds >= 60) {
      const task = state.tasks.find(item => item.id === $('#focusTask').value);
      state.sessions.push({ id: uid(), date: localDate(), minutes: Math.max(1, Math.round(elapsedSeconds / 60)), taskId: task?.id || null, taskTitle: task?.title || '', createdAt: new Date().toISOString() });
      persist();
      if (task) task.actualMinutes = (task.actualMinutes || 0) + Math.max(1, Math.round(elapsedSeconds / 60));
      persist();
      showToast(completed ? '专注时间完成，这段投入已经记录。' : '专注时段已记录，休息一下也很好。');
      renderToday();
      renderFocus();
    } else if (completed) {
      showToast('休息结束，准备好再继续就好。');
    }
    if (completed && timer.mode === 'focus' && state.breakReminder) {
      if ('Notification' in window && Notification.permission === 'granted') new Notification('专注时间结束', { body: '站起来活动一下，休息也是计划的一部分。' });
      timer.mode = 'break';
      timer.duration = 5 * 60;
      timer.remaining = timer.duration;
      showToast('专注时间结束，准备好后可以休息 5 分钟。');
    } else if (completed && timer.mode === 'break') {
      timer.mode = 'focus';
      timer.duration = 25 * 60;
      timer.remaining = timer.duration;
    } else {
      timer.remaining = completed ? 0 : timer.duration;
    }
    updateTimerUI();
  }

  function pauseTimer() {
    clearInterval(timer.interval);
    timer.interval = null;
    timer.running = false;
    updateTimerUI();
    showToast('已暂停，剩余时间为你保留。');
  }

  let pendingGoalParentId = '';

  function openGoalDialog(parentId = '') {
    $('#goalForm').reset();
    $('#goalError').textContent = '';
    const parent = state.goals.find(goal => goal.id === parentId);
    pendingGoalParentId = parent?.id || '';
    $('#goalDialogTitle').textContent = parent ? `拆解：${parent.title}` : '新建目标';
    if (parent) {
      const nextLevel = { semester: 'month', month: 'week' }[parent.level];
      $('#goalLevel').value = nextLevel;
      $('#goalQuadrant').value = parent.quadrant || 'q2';
    }
    $('#goalDialog').showModal();
  }

  function openTaskDialog(taskId = null, date = localDate(), quadrant = 'q2', goalId = '') {
    editingTaskId = taskId;
    $('#taskForm').reset();
    $('#taskError').textContent = '';
    $('#taskDate').value = date;
    $('#taskQuadrant').value = quadrant;
    $('#taskDialogTitle').textContent = taskId ? '编辑任务' : '添加任务';
    renderPlan();
    $('#taskGoal').value = goalId;
    if (taskId) {
      const task = state.tasks.find(item => item.id === taskId);
      if (task) {
        $('#taskTitle').value = task.title;
        $('#taskGoal').value = task.goalId || '';
        $('#taskDate').value = task.date;
        $('#taskMinutes').value = task.minutes;
        $('#taskQuadrant').value = task.quadrant;
      }
    }
    $('#taskDialog').showModal();
  }

  function deleteGoal(goalId) {
    const descendants = new Set([goalId]);
    let growing = true;
    while (growing) {
      growing = false;
      state.goals.forEach(goal => {
        if (descendants.has(goal.parentId) && !descendants.has(goal.id)) { descendants.add(goal.id); growing = true; }
      });
    }
    const count = state.tasks.filter(task => descendants.has(task.goalId)).length;
    const prompt = count ? `這個目標及其子目標下有 ${count} 項任務。刪除目標不會刪除任務，確定繼續嗎？` : '確定刪除這個目標嗎？';
    if (!window.confirm(prompt)) return;
    state.goals = state.goals.filter(goal => !descendants.has(goal.id));
    state.tasks.forEach(task => { if (descendants.has(task.goalId)) task.goalId = ''; });
    persist();
    renderAll();
  }

  function renderAll() {
    renderHeader();
    renderToday();
    renderPlan();
    renderFocus();
    renderReviews();
    if (!storageAvailable) showToast('本地保存暂不可用；请避免关闭页面，以免更改丢失。');
  }

  document.addEventListener('click', event => {
    const nav = event.target.closest('[data-view]');
    if (nav) { navigate(nav.dataset.view); return; }
    const viewLink = event.target.closest('[data-view-link]');
    if (viewLink) { navigate(viewLink.dataset.viewLink); return; }
    const action = event.target.closest('[data-action]');
    if (action?.dataset.action === 'new-goal') { openGoalDialog(); return; }
    if (action?.dataset.action === 'new-task') { openTaskDialog(); return; }
    const close = event.target.closest('[data-close]');
    if (close) { $(`#${close.dataset.close}`).close(); return; }
    const child = event.target.closest('[data-add-child]');
    if (child) { openGoalDialog(child.dataset.addChild); return; }
    const addTaskForGoal = event.target.closest('[data-add-task-for-goal]');
    if (addTaskForGoal) {
      const goal = state.goals.find(item => item.id === addTaskForGoal.dataset.addTaskForGoal);
      if (goal) openTaskDialog(null, localDate(), goal.quadrant || 'q2', goal.id);
      return;
    }
    const deleteButton = event.target.closest('[data-delete-goal]');
    if (deleteButton) { deleteGoal(deleteButton.dataset.deleteGoal); return; }
    const editTask = event.target.closest('[data-edit-task]');
    if (editTask) { openTaskDialog(editTask.dataset.editTask); return; }
    const deleteTask = event.target.closest('[data-delete-task]');
    if (deleteTask) {
      const task = state.tasks.find(item => item.id === deleteTask.dataset.deleteTask);
      if (!task || !window.confirm(`删除任务“${task.title}”？已记录的专注时段会保留。`)) return;
      state.tasks = state.tasks.filter(item => item.id !== task.id);
      persist(); renderAll(); showToast('任务已删除。');
      return;
    }
    const matrixTab = event.target.closest('[data-matrix-tab]');
    if (matrixTab) {
      matrixMobileQuadrant = matrixTab.dataset.matrixTab;
      renderPlan();
      return;
    }
    const reviewTab = event.target.closest('[data-period]');
    if (reviewTab) {
      reviewPeriod = reviewTab.dataset.period;
      $$('.review-tab').forEach(button => button.classList.toggle('active', button === reviewTab));
      renderReviews();
      return;
    }
    const openReview = event.target.closest('[data-open-review]');
    if (openReview) {
      const review = state.reviews.find(item => item.key === openReview.dataset.openReview);
      if (!review) return;
      reviewPeriod = review.period;
      $('#reviewDate').value = review.date;
      $$('.review-tab').forEach(button => button.classList.toggle('active', button.dataset.period === reviewPeriod));
      renderReviews();
      $('#reviewForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const length = event.target.closest('[data-minutes]');
    if (length) setTimerLength(Number(length.dataset.minutes));
  });

  document.addEventListener('change', event => {
    const done = event.target.closest('[data-task-done]');
    if (done) {
      const task = state.tasks.find(item => item.id === done.dataset.taskDone);
      if (task) task.done = done.checked;
      persist(); renderAll();
      if (done.checked) showToast('已记下这一步，做得不错。');
      return;
    }
    const priority = event.target.closest('[data-task-quadrant]');
    if (priority) {
      const task = state.tasks.find(item => item.id === priority.dataset.taskQuadrant);
      if (task) task.quadrant = priority.value;
      persist(); renderPlan(); renderToday();
      showToast('优先级已更新。');
      return;
    }
    const goalPriority = event.target.closest('[data-goal-quadrant]');
    if (goalPriority) {
      const goal = state.goals.find(item => item.id === goalPriority.dataset.goalQuadrant);
      if (goal) goal.quadrant = goalPriority.value;
      persist(); renderPlan(); renderToday();
      showToast('目标优先级已更新。');
      return;
    }
    if (event.target.id === 'breakReminder') {
      state.breakReminder = event.target.checked; persist();
      if (event.target.checked && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(permission => { if (permission !== 'granted') showToast('可以在专注页面查看结束提醒。'); });
      }
      return;
    }
    if (event.target.id === 'reviewDate') renderReviews();
  });

  $('#dailyPlanHours').addEventListener('change', event => {
    const value = Number(event.target.value);
    if (!Number.isFinite(value) || value < 0 || value > 24) {
      event.target.value = (planMinutes() / 60).toString();
      showToast('计划时长请填写 0 到 24 小时之间的数字。');
      return;
    }
    state.dailyPlans[localDate()] = Math.round(value * 60);
    persist(); renderToday(); renderReviews();
  });

  $('#goalForm').addEventListener('submit', event => {
    event.preventDefault();
    const title = $('#goalTitle').value.trim();
    if (!title) { $('#goalError').textContent = '请填写目标名称。'; $('#goalTitle').focus(); return; }
    const parentId = pendingGoalParentId;
    const parent = state.goals.find(goal => goal.id === parentId);
    const level = $('#goalLevel').value;
    const expectedChild = parent ? { semester: 'month', month: 'week' }[parent.level] : null;
    if (parent && expectedChild !== level) {
      $('#goalError').textContent = `“${levelNames[parent.level]}”下面可拆解为“${levelNames[expectedChild]}”，周目标请直接添加任务。`;
      return;
    }
    state.goals.push({ id: uid(), title, level, parentId, quadrant: $('#goalQuadrant').value, due: $('#goalDue').value, depth: parent ? (parent.depth || 0) + 1 : 0, createdAt: new Date().toISOString() });
    persist(); $('#goalDialog').close(); renderAll(); showToast('目标已保存，可以继续拆解下一步。');
  });

  $('#taskForm').addEventListener('submit', event => {
    event.preventDefault();
    const title = $('#taskTitle').value.trim();
    const date = $('#taskDate').value;
    const minutes = Number($('#taskMinutes').value);
    if (!title) { $('#taskError').textContent = '请填写任务名称。'; $('#taskTitle').focus(); return; }
    if (!date) { $('#taskError').textContent = '请选择任务日期。'; return; }
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) { $('#taskError').textContent = '计划时长请填写 0 到 1440 分钟。'; return; }
    const taskData = { title, date, minutes, quadrant: $('#taskQuadrant').value, goalId: $('#taskGoal').value, done: false };
    if (editingTaskId) {
      const existing = state.tasks.find(task => task.id === editingTaskId);
      if (existing) Object.assign(existing, taskData, { done: existing.done });
    } else state.tasks.push({ id: uid(), ...taskData, actualMinutes: 0, createdAt: new Date().toISOString() });
    persist(); $('#taskDialog').close(); renderAll(); showToast(editingTaskId ? '任务已更新。' : '任务已加入计划。');
  });

  $('#reviewForm').addEventListener('submit', event => {
    event.preventDefault();
    const date = $('#reviewDate').value;
    if (!date) { $('#reviewMessage').textContent = '请先选择复盘日期。'; return; }
    const label = reviewPeriod === 'day' ? formatDate(date) : `${formatDate(weekBounds(date).start, { month: 'short', day: 'numeric' })} - ${formatDate(weekBounds(date).end, { month: 'short', day: 'numeric' })}`;
    const key = reviewPeriod === 'day' ? `day:${date}` : `week:${weekBounds(date).start}`;
    const fields = { wins: $('#reviewWins').value.trim(), blockers: $('#reviewBlockers').value.trim(), next: $('#reviewNext').value.trim() };
    const feedback = reviewFeedback(fields);
    const payload = { key, period: reviewPeriod, date, label, ...fields, feedback, savedAt: new Date().toISOString() };
    const existingIndex = state.reviews.findIndex(review => review.key === key);
    if (existingIndex >= 0) state.reviews[existingIndex] = payload;
    else state.reviews.push(payload);
    persist(); renderReviews(); $('#reviewMessage').textContent = feedback;
  });

  $('#timerToggle').addEventListener('click', () => {
    if (timer.running) { pauseTimer(); return; }
    if (timer.remaining <= 0) setTimerLength(Number($('.length-choice.selected')?.dataset.minutes || 25));
    timer.running = true;
    timer.startedAt = Date.now();
    timer.interval = setInterval(() => {
      timer.remaining = Math.max(0, timer.remaining - 1);
      updateTimerUI();
      if (timer.remaining === 0) finishTimer(true);
    }, 1000);
    updateTimerUI();
  });

  $('#timerReset').addEventListener('click', () => {
    if (timer.running) return;
    timer.remaining = timer.duration;
    updateTimerUI();
  });

  $('#timerSave').addEventListener('click', () => {
    if (timer.duration - timer.remaining < 60) return;
    finishTimer(false);
  });

  $$('.length-choice').forEach(button => button.addEventListener('click', () => setTimerLength(Number(button.dataset.minutes))));

  document.addEventListener('visibilitychange', () => {
    if (!timer.running) return;
    if (document.hidden) {
      clearInterval(timer.interval);
      timer.interval = null;
      timer.hiddenAt = Date.now();
    } else if (timer.hiddenAt) {
      const elapsed = Math.floor((Date.now() - timer.hiddenAt) / 1000);
      timer.remaining = Math.max(0, timer.remaining - elapsed);
      timer.hiddenAt = null;
      if (timer.remaining === 0) finishTimer(true);
      else timer.interval = setInterval(() => {
        timer.remaining = Math.max(0, timer.remaining - 1);
        updateTimerUI();
        if (timer.remaining === 0) finishTimer(true);
      }, 1000);
      updateTimerUI();
    }
  });

  renderAll();
  navigate('today');
})();

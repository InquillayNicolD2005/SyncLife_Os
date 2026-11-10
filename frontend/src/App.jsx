import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, BarChart3, Bell, CalendarDays,
  Check, CheckCircle2, ChevronLeft, ChevronRight, CircleDollarSign,
  ClipboardList, CloudSun, Download, Dumbbell, Flame, HelpCircle, Home, LayoutDashboard, LogOut, Pause, Play,
  ListTodo, MapPin, Pencil, Plus, Salad, Sparkles, Target, Trash2, Utensils, Wallet,
  Shirt, Pill, ShoppingBag, Coffee, RefreshCw, Search, ShieldCheck, Users, Lock, Unlock, Menu, X,
} from 'lucide-react';
import jsPDF from 'jspdf';
import {
  browserLocalPersistence, browserSessionPersistence, createUserWithEmailAndPassword, deleteUser, getRedirectResult,
  EmailAuthProvider, GoogleAuthProvider, linkWithCredential, onAuthStateChanged, sendPasswordResetEmail, setPersistence,
  signInWithCustomToken, signInWithEmailAndPassword, signInWithPopup, signInWithRedirect, signOut, updateProfile,
} from 'firebase/auth';
import { auth, firebaseConfigured } from './firebase';
import './App.css';

const STORAGE_KEYS = {
  habits: 'synclife-habits',
  events: 'synclife-events',
  history: 'synclife-history',
  income: 'synclife-income',
  fixedCosts: 'synclife-fixed-costs',
  foodBudget: 'synclife-food-budget',
  bodyProfile: 'synclife-body-profile',
  workoutPreference: 'synclife-workout-preference',
  mealPlans: 'synclife-meal-plans',
  profile: 'synclife-profile',
  notifiedEvents: 'synclife-notified-events',
  expenses: 'synclife-daily-expenses',
  habitDate: 'synclife-habit-date',
  generatedWorkouts: 'synclife-generated-workouts',
  exerciseSessions: 'synclife-exercise-sessions',
};

const changeAdminRole = async (action) => {
  setBusyAdminRole(true);
  setError('');
  setNotice('');
  try {
    const result = action.type === 'grant-admin'
      ? await adminRequest(user, '/api/admin/admins', {
        method: 'POST',
        body: JSON.stringify({ email: action.email }),
      })
      : await adminRequest(user, `/api/admin/admins/${encodeURIComponent(action.account.uid)}`, {
        method: 'DELETE',
      });
    setAdminEmail('');
    const refreshed = await refreshOverview();
    setNotice(result.warning || (action.type === 'grant-admin'
      ? `${result.user.email} ahora es administrador. Debe volver a iniciar sesión para recibir el acceso.`
      : `${action.account.email || action.account.name} ya no tiene acceso administrativo.`));
    if (!refreshed) setNotice('El cambio se guardó, pero no se pudo actualizar la lista. Actualiza el panel.');
  } catch (requestError) {
    console.error('No se pudo actualizar el rol administrativo:', requestError);
    setError(requestError.message);
  } finally {
    setBusyAdminRole(false);
  }
};

const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
const apiUrl = (path) => {
  if (import.meta.env.PROD && !API_BASE_URL) {
    throw new Error('Falta VITE_API_URL en Vercel. Configúrala con la URL del backend en Render y vuelve a desplegar.');
  }
  return `${API_BASE_URL}${path}`;
};

async function adminRequest(user, path, options = {}) {
  if (!user) throw new Error('No hay una sesión válida. Inicia sesión de nuevo.');
  const token = await user.getIdToken();
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  });
  if (response.status === 204) return null;
  const responseText = await response.text();
  let result = {};
  if (responseText) {
    try {
      result = JSON.parse(responseText);
    } catch {
      throw new Error('El backend devolvió una respuesta que no se pudo leer.');
    }
  }
  if (!response.ok) throw new Error(result.error || 'No se pudo completar la solicitud administrativa.');
  return result;
}

async function syncAccountWithBackend(user) {
  const token = await user.getIdToken(true);
  const response = await fetch(apiUrl('/api/account/sync'), {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
  });
  const responseText = await response.text();
  let result = {};
  if (responseText) {
    try {
      result = JSON.parse(responseText);
    } catch {
      throw new Error('El backend devolvió una respuesta que no se pudo leer al guardar la cuenta.');
    }
  }
  if (!response.ok) {
    throw new Error(result.error || 'No se pudo guardar la cuenta en la base de datos.');
  }
  return result;
}

async function accountRequest(path, { user, ...options } = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers };
  if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`;
  const response = await fetch(apiUrl(`/api/account${path}`), { ...options, headers });
  const responseText = await response.text();
  let result = {};
  if (responseText) {
    try {
      result = JSON.parse(responseText);
    } catch {
      throw new Error('El servidor devolvió una respuesta que no se pudo leer.');
    }
  }
  if (!response.ok) throw new Error(result.error || 'No se pudo completar la solicitud.');
  return result;
}

async function saveAccountUsername(user, username) {
  return accountRequest('/username', {
    user,
    method: 'POST',
    body: JSON.stringify({ username }),
  });
}
function AdminPanel({ user, isAdmin, isSuperAdmin, onRefreshClaim, onExit }) {
  const [section, setSection] = useState('summary');
  const [metrics, setMetrics] = useState(null);
  const [users, setUsers] = useState([]);
  const [adminAccounts, setAdminAccounts] = useState([]);
  const [adminEmail, setAdminEmail] = useState('');
  const [nextPageToken, setNextPageToken] = useState(null);
  const [search, setSearch] = useState('');
  const [userStatusFilter, setUserStatusFilter] = useState('all');
  const [providerFilter, setProviderFilter] = useState('all');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [records, setRecords] = useState([]);
  const [recordNextPageToken, setRecordNextPageToken] = useState(null);
  const [recordsLoaded, setRecordsLoaded] = useState(false);
  const [recordSearch, setRecordSearch] = useState('');
  const [recordDateFilter, setRecordDateFilter] = useState('');
  const [helpOpen, setHelpOpen] = useState('');
  const [confirmAction, setConfirmAction] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [apis, setApis] = useState(null);
  const [apisLoading, setApisLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [busyUid, setBusyUid] = useState('');
  const [busyAdminRole, setBusyAdminRole] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refreshOverview = async () => {
    setLoading(true);
    setError('');
    try {
      const [nextMetrics, firstPage, firstRecordsPage] = await Promise.all([
        adminRequest(user, '/api/admin/metrics'),
        adminRequest(user, '/api/admin/users'),
        adminRequest(user, '/api/admin/records'),
      ]);
      setMetrics(nextMetrics);
      setAdminAccounts(nextMetrics.admins || []);
      setUsers(firstPage.users);
      setNextPageToken(firstPage.nextPageToken);
      setRecords(firstRecordsPage.records);
      setRecordNextPageToken(firstRecordsPage.nextPageToken);
      setRecordsLoaded(true);
      return true;
    } catch (requestError) {
      console.error('No se pudo cargar el panel administrativo:', requestError);
      setError(requestError.message);
      return false;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshOverview();
  }, [user]);

  const refreshApis = async () => {
    setApisLoading(true);
    setError('');
    try {
      setApis(await adminRequest(user, '/api/admin/apis'));
    } catch (requestError) {
      console.error('No se pudo consultar el estado de las APIs:', requestError);
      setError(requestError.message);
    } finally {
      setApisLoading(false);
    }
  };

  const loadRecords = async (append = false) => {
    setLoadingRecords(true);
    setError('');
    try {
      const cursor = append ? recordNextPageToken : null;
      const path = cursor
        ? `/api/admin/records?pageToken=${encodeURIComponent(cursor)}`
        : '/api/admin/records';
      const page = await adminRequest(user, path);
      setRecords((current) => append ? [...current, ...page.records] : page.records);
      setRecordNextPageToken(page.nextPageToken);
      setRecordsLoaded(true);
    } catch (requestError) {
      console.error('No se pudieron cargar los registros diarios:', requestError);
      setError(requestError.message);
    } finally {
      setLoadingRecords(false);
    }
  };

  const openSection = (nextSection) => {
    setSection(nextSection);
    setNotice('');
    setHelpOpen('');
    if (nextSection === 'records' && !recordsLoaded) loadRecords();
    if (nextSection === 'apis' && !apis) refreshApis();
  };

  const loadMoreUsers = async () => {
    if (!nextPageToken) return;
    setLoadingMore(true);
    setError('');
    try {
      const page = await adminRequest(user, `/api/admin/users?pageToken=${encodeURIComponent(nextPageToken)}`);
      setUsers((current) => [...current, ...page.users]);
      setNextPageToken(page.nextPageToken);
    } catch (requestError) {
      console.error('No se pudieron cargar más cuentas:', requestError);
      setError(requestError.message);
    } finally {
      setLoadingMore(false);
    }
  };

  const updateAccountStatus = async (account, disabled) => {
    const action = disabled ? 'bloquear' : 'desbloquear';
    setBusyUid(account.uid);
    setError('');
    setNotice('');
    try {
      const result = await adminRequest(user, `/api/admin/users/${encodeURIComponent(account.uid)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ disabled }),
      });
      setUsers((current) => current.map((item) => item.uid === account.uid ? result.user : item));
      setNotice(result.warning || `Cuenta ${disabled ? 'bloqueada' : 'desbloqueada'} correctamente.`);
    } catch (requestError) {
      console.error(`No se pudo ${action} la cuenta:`, requestError);
      setError(requestError.message);
    } finally {
      setBusyUid('');
    }
  };

  const deleteAccount = async (account) => {
    setBusyUid(account.uid);
    setError('');
    setNotice('');
    try {
      const result = await adminRequest(user, `/api/admin/users/${encodeURIComponent(account.uid)}`, { method: 'DELETE' });
      setUsers((current) => current.filter((item) => item.uid !== account.uid));
      setRecords((current) => current.filter((item) => item.uid !== account.uid && !item.id.startsWith(`${account.uid}_`)));
      const refreshed = await refreshOverview();
      setNotice(result?.warning || (refreshed
        ? 'Cuenta eliminada. Los registros de uso agregado asociados también se borraron.'
        : 'Cuenta eliminada; no se pudieron actualizar las métricas. Actualiza el panel para sincronizarlas.'));
    } catch (requestError) {
      console.error('No se pudo eliminar la cuenta:', requestError);
      setError(requestError.message);
    } finally {
      setBusyUid('');
    }
  };

  const normalizedSearch = search.trim().toLocaleLowerCase('es');
  const filteredUsers = users.filter((account) => (
    `${account.name} ${account.email}`.toLocaleLowerCase('es').includes(normalizedSearch)
  ) && (userStatusFilter === 'all'
    || (userStatusFilter === 'active' && !account.disabled)
    || (userStatusFilter === 'blocked' && account.disabled))
    && (providerFilter === 'all'
      || (providerFilter === 'google' && account.providers?.includes('google.com'))
      || (providerFilter === 'email' && account.providers?.includes('password'))));
  const normalizedRecordSearch = recordSearch.trim().toLocaleLowerCase('es');
  const filteredRecords = records.filter((record) => (
    (!recordDateFilter || record.date === recordDateFilter)
    && (!normalizedRecordSearch
      || `${record.name} ${record.email} ${record.date} ${record.score ?? ''}`
        .toLocaleLowerCase('es').includes(normalizedRecordSearch))
  ));
  const formatApiDate = (value) => value
    ? new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
    : 'Sin datos';
  const formatDay = (value) => value
    ? new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium' }).format(new Date(`${value}T12:00:00`))
    : 'Sin fecha';
  const formatDelta = (current, previous, unit = '') => {
    if (current === null || current === undefined || previous === null || previous === undefined) return 'Sin comparación anterior';
    const delta = Number((Number(current) - Number(previous)).toFixed(1));
    if (!delta) return 'Sin cambio frente a la semana anterior';
    return `${delta > 0 ? '+' : ''}${delta}${unit} frente a la semana anterior`;
  };
  const helpCopy = {
    summary: 'Cuentas y actividad agregada sincronizadas con PostgreSQL en Render. El historial anterior de puntajes sigue en Firebase.',
    users: 'Busca una cuenta, revisa su estado y bloquéala o elimínala si hace falta.',
    records: 'Historial anterior de puntajes. La aplicación ya no crea registros diarios nuevos.',
    admins: 'La cuenta propietaria es la única que puede otorgar o retirar el acceso administrativo.',
    apis: 'Comprueba si los servicios externos que usa SyncLife están disponibles.',
    security: 'El panel y sus datos están protegidos por el permiso de administrador verificado en el servidor.',
  };
  const sectionHeading = (kicker, title, description) => (
    <div className="admin-section-heading">
      <div><span className="section-kicker">{kicker}</span><h2>{title}</h2><p>{description}</p></div>
      <button type="button" className="admin-help-button" aria-label={`Ayuda: ${title}`}
        aria-expanded={helpOpen === section} onClick={() => setHelpOpen((current) => current === section ? '' : section)}>
        <HelpCircle size={16} /><span>¿Qué es esto?</span>
      </button>
    </div>
  );
  const performConfirmedAction = async () => {
    if (!confirmAction) return;
    setConfirming(true);
    if (confirmAction.type === 'grant-admin' || confirmAction.type === 'remove-admin') {
      await changeAdminRole(confirmAction);
    } else if (confirmAction.type === 'delete') {
      await deleteAccount(confirmAction.account);
    } else {
      await updateAccountStatus(confirmAction.account, confirmAction.disabled);
    }
    setConfirming(false);
    setConfirmAction(null);
  };
  const sections = [
    { id: 'summary', label: 'Resumen', icon: LayoutDashboard },
    { id: 'users', label: 'Usuarios', icon: Users },
    { id: 'admins', label: 'Administradores', icon: ShieldCheck },
    { id: 'records', label: 'Registros recientes', icon: ClipboardList },
  ];

  return (
    <section className="admin-panel" aria-label="Panel administrativo">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span className="admin-brand-mark"><Activity size={21} /></span>
          <span><strong>SyncLife OS</strong><small>Administración</small></span>
        </div>
        <span className="admin-nav-label">MENÚ PRINCIPAL</span>
        <nav className={`admin-nav ${mobileMenuOpen ? 'open' : ''}`} aria-label="Secciones administrativas">
          {sections.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={`admin-nav-item ${section === id ? 'active' : ''}`} onClick={() => { openSection(id); setMobileMenuOpen(false); }}>
              <Icon size={17} /><span>{label}</span>
              {id === 'users' && metrics && <small>{metrics.totalUsers.toLocaleString('es-PE')}</small>}
            </button>
          ))}
          <span className="admin-nav-label admin-tools-label">ESTADO Y SEGURIDAD</span>
          {[
            { id: 'apis', label: 'Servicios externos', icon: Activity },
            { id: 'security', label: 'Protección de datos', icon: ShieldCheck },
          ].map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={`admin-nav-item ${section === id ? 'active' : ''}`} onClick={() => { openSection(id); setMobileMenuOpen(false); }}>
              <Icon size={17} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-bottom">
          <div className="admin-protection"><ShieldCheck size={17} /><span><strong>Acceso protegido</strong><small>Sesión de administrador</small></span></div>
          <div className="admin-sidebar-account"><span>{(user?.displayName || user?.email || 'A').charAt(0).toUpperCase()}</span><div><strong>{user?.displayName || 'Administrador'}</strong><small>{user?.email || 'Cuenta verificada'}</small></div></div>
        </div>
      </aside>

      <div className="admin-workspace">
        <header className="admin-topbar">
          <div className="admin-topbar-title">
            <button type="button" className="admin-mobile-menu" onClick={() => setMobileMenuOpen((open) => !open)} aria-expanded={mobileMenuOpen} aria-label="Abrir menú de administración"><Menu size={19} /></button>
            <span><span className="admin-breadcrumb">SyncLife OS <ChevronRight size={13} /> Administración</span><strong>{sections.find((item) => item.id === section)?.label}</strong></span>
          </div>
          <div className="admin-top-actions">
            <span className="admin-session-badge"><i />Sesión protegida</span>
            <button type="button" className="admin-top-button" onClick={() => section === 'apis' ? refreshApis() : refreshOverview()} disabled={section === 'apis' ? apisLoading : loading}><RefreshCw size={15} />Actualizar</button>
            <button type="button" className="admin-exit-button" onClick={onExit}><LogOut size={15} />Salir</button>
          </div>
        </header>
        <div className="admin-content">
          {helpOpen && <p className="admin-help-copy" role="note">{helpCopy[helpOpen]}</p>}
          {error && <p className="admin-message is-error" role="alert">{error}</p>}
          {notice && <p className="admin-message" role="status">{notice}</p>}
          {loading && <p className="admin-loading" role="status">Actualizando cuentas y métricas de PostgreSQL…</p>}

      {section === 'summary' && !loading && metrics && (
        <div className="admin-section">
          <div className="admin-section-heading">
            <div><span className="section-kicker">VISTA GENERAL</span><h2>Hola, Administrador</h2>
              <p>{new Intl.DateTimeFormat('es-PE', { dateStyle: 'full' }).format(new Date())}. Aquí tienes lo más importante.</p>
            </div>
            <div className="admin-heading-actions">
              <span className="admin-updated">Actualizado {formatApiDate(metrics.updatedAt)}</span>
              <button type="button" className="admin-help-button" aria-label="Ayuda del resumen"
                aria-expanded={helpOpen === 'summary'} onClick={() => setHelpOpen((current) => current === 'summary' ? '' : 'summary')}>
                <HelpCircle size={16} /><span>Ayuda</span>
              </button>
            </div>
          </div>
          <div className="admin-metrics">
            {[
              { label: 'Usuarios registrados', value: metrics.totalUsers, description: 'Cuentas sincronizadas en PostgreSQL', change: formatDelta(metrics.usersThisWeek, metrics.usersPreviousWeek, ' cuentas'), icon: Users, tone: 'green' },
              { label: 'Registros históricos', value: metrics.totalRecords ?? 0, description: 'Historial antiguo más nuevos registros administrativos', change: formatDelta(metrics.recordsThisWeek, metrics.recordsPreviousWeek, ' registros'), icon: ClipboardList, tone: 'blue' },
              { label: 'Registros de hoy', value: metrics.recordsToday ?? 0, description: 'Puntajes guardados en esta fecha', change: formatDelta(metrics.recordsToday, metrics.recordsSameDayPreviousWeek, ' registros'), icon: Activity, tone: 'amber' },
              { label: 'Puntaje promedio histórico', value: metrics.averageScore == null ? '—' : `${metrics.averageScore}/100`, description: 'Promedio de los registros anteriores', change: formatDelta(metrics.averageScore, metrics.previousAverageScore, ' puntos'), icon: BarChart3, tone: 'violet' },
            ].map(({ label, value, description, change, icon: Icon, tone }) => (
              <article className="admin-metric-card" key={label}>
                <span className={`admin-metric-icon ${tone}`}><Icon size={18} /></span>
                <span>{label}</span><strong>{typeof value === 'number' ? value.toLocaleString('es-PE') : value}</strong>
                <small>{description}</small><span className="admin-metric-change">{change}</span>
              </article>
            ))}
          </div>
          <div className="admin-overview-grid">
            <section className="admin-chart-card" aria-label="Registros diarios de los últimos 7 días">
              <div><h3>Actividad de los últimos 7 días</h3><p>Cada barra muestra cuántos días se guardaron.</p></div>
              <div className="admin-week-chart">
                {(metrics.recordsLast7Days || []).map((day) => {
                  const maxCount = Math.max(1, ...(metrics.recordsLast7Days || []).map((item) => item.count));
                  return (
                    <div className="admin-chart-day" key={day.date} title={`${formatDay(day.date)}: ${day.count} registros`}>
                      <strong>{day.count}</strong><span className="admin-chart-track"><i style={{ height: `${Math.max(7, (day.count / maxCount) * 100)}%` }} /></span>
                      <small>{new Intl.DateTimeFormat('es-PE', { weekday: 'short' }).format(new Date(`${day.date}T12:00:00`))}</small>
                    </div>
                  );
                })}
              </div>
            </section>
            <section className="admin-recent-card">
              <div className="admin-recent-heading"><span><h3>Actividad reciente</h3><p>Últimos registros guardados</p></span><button type="button" onClick={() => openSection('records')}>Ver todo<ChevronRight size={14} /></button></div>
              {records.slice(0, 5).length ? <div className="admin-recent-list">
                {records.slice(0, 5).map((record) => (
                  <article className="admin-recent-item" key={record.id}>
                    <span className="admin-recent-avatar">{(record.name || record.email || '?').charAt(0).toUpperCase()}</span>
                    <span className="admin-recent-detail"><strong>{record.name || 'Sin nombre'}</strong><small>{record.email || 'Cuenta SyncLife'}</small></span>
                    <span className={`admin-record-score ${record.score == null ? '' : record.score >= 70 ? 'high' : record.score >= 40 ? 'medium' : 'low'}`}>{record.score ?? '—'}</span>
                  </article>
                ))}
              </div> : <p className="admin-recent-empty">No hay registros históricos sincronizados de la versión anterior.</p>}
            </section>
          </div>
          <div className="admin-quick-actions">
            <h3>Acciones rápidas</h3>
            <div>
              <button type="button" className="admin-quick-button" onClick={() => openSection('users')}><Users size={17} />Ver usuarios</button>
              <button type="button" className="admin-quick-button" onClick={() => openSection('records')}><ClipboardList size={17} />Ver registros recientes</button>
              <button type="button" className="admin-quick-button" onClick={refreshOverview} disabled={loading}><RefreshCw size={17} />Actualizar datos</button>
            </div>
          </div>
          <p className="admin-footnote">Cuentas y actividad agregada: PostgreSQL en Render. El historial anterior de puntajes permanece en Firebase. No se muestran datos individuales de salud ni finanzas.</p>
        </div>
      )}
      {section === 'summary' && !loading && !metrics && (
        <p className="admin-loading" role="status">No se pudieron cargar las métricas administrativas.</p>
      )}

      {section === 'users' && (
        <div className="admin-section">
          {sectionHeading('CUENTAS', 'Usuarios', 'Busca una cuenta y revisa su estado.')}
          <div className="admin-users-toolbar">
            <label className="admin-search"><Search size={16} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nombre o correo" aria-label="Buscar usuario" /></label>
            <div className="admin-filter-group" aria-label="Filtrar estado de usuarios">
              {[['all', 'Todos'], ['active', 'Activos'], ['blocked', 'Bloqueados']].map(([value, label]) => (
                <button key={value} type="button" className={userStatusFilter === value ? 'active' : ''}
                  aria-pressed={userStatusFilter === value} onClick={() => setUserStatusFilter(value)}>{label}</button>
              ))}
            </div>
            <div className="admin-filter-group" aria-label="Filtrar tipo de cuenta">
              {[['all', 'Todas las cuentas'], ['google', 'Google'], ['email', 'Correo']].map(([value, label]) => (
                <button key={value} type="button" className={providerFilter === value ? 'active' : ''}
                  aria-pressed={providerFilter === value} onClick={() => setProviderFilter(value)}>{label}</button>
              ))}
            </div>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-users-table">
              <thead><tr><th>Usuario</th><th>Correo</th><th>Acceso con</th><th>Registro</th><th>Estado</th><th>Acciones</th></tr></thead>
              <tbody>
                {filteredUsers.map((account) => (
                  <tr key={account.uid}>
                    <td data-label="Usuario"><span className={account.name === 'Sin nombre' ? 'admin-user-no-name' : ''}>{account.name || 'Sin nombre'}</span></td>
                    <td data-label="Correo">{account.email || '—'}</td>
                    <td data-label="Acceso con"><span className={`admin-provider-tag ${account.providers?.includes('google.com') ? 'google' : ''}`}>{account.providers?.includes('google.com') ? 'Google' : account.providers?.includes('password') ? 'Correo' : 'Otro'}</span></td>
                    <td data-label="Registro">{formatApiDate(account.createdAt)}</td>
                    <td data-label="Estado"><span className={`admin-user-state ${account.disabled ? 'blocked' : 'enabled'}`}>{account.disabled ? 'Bloqueado' : 'Activo'}{account.admin ? ' · Admin' : ''}</span></td>
                    <td data-label="Acciones">
                      {account.admin ? <span className="admin-protected-user">Admin · Cuenta protegida</span> : (
                        <div className="admin-user-actions">
                          <button type="button" className="admin-action-button" onClick={() => setConfirmAction({ type: 'status', account, disabled: !account.disabled })} disabled={busyUid === account.uid}>
                            {account.disabled ? <Unlock size={14} /> : <Lock size={14} />}
                            {account.disabled ? 'Desbloquear' : 'Bloquear'}
                          </button>
                          <button type="button" className="admin-action-button danger" onClick={() => setConfirmAction({ type: 'delete', account })} disabled={busyUid === account.uid}>
                            <Trash2 size={14} />Eliminar
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {!filteredUsers.length && <tr><td className="admin-empty" colSpan="6">{users.length ? 'No hay cuentas que coincidan con la búsqueda y el filtro.' : error ? 'No se pudo cargar la lista de cuentas.' : 'Aún no hay usuarios. Aparecerán aquí cuando alguien se registre.'}</td></tr>}
              </tbody>
            </table>
          </div>
          {nextPageToken && <button type="button" className="admin-load-more" onClick={loadMoreUsers} disabled={loadingMore}>{loadingMore ? 'Cargando…' : 'Cargar más cuentas'}</button>}
        </div>
      )}

      {section === 'records' && (
        <div className="admin-section">
          {sectionHeading('REGISTROS', 'Registros diarios', 'Consulta los puntajes históricos y los nuevos registros guardados en PostgreSQL.')}
          <div className="admin-users-toolbar">
            <label className="admin-search"><Search size={16} /><input type="search" value={recordSearch} onChange={(event) => setRecordSearch(event.target.value)} placeholder="Buscar nombre, correo o fecha" aria-label="Buscar registros" /></label>
            <label className="admin-date-filter"><span>Fecha</span><input type="date" value={recordDateFilter} onChange={(event) => setRecordDateFilter(event.target.value)} aria-label="Filtrar registros por fecha" /></label>
          </div>
          {loadingRecords ? <p className="admin-loading" role="status">Cargando registros históricos…</p> : (
            <div className="admin-table-wrap">
              <table className="admin-users-table admin-records-table">
                <thead><tr><th>Persona</th><th>Correo</th><th>Fecha</th><th>Puntaje</th></tr></thead>
                <tbody>
                  {filteredRecords.map((record) => (
                    <tr key={record.id}>
                      <td data-label="Persona">{record.name || 'Sin nombre'}</td>
                      <td data-label="Correo">{record.email || '—'}</td>
                      <td data-label="Fecha">{formatDay(record.date)}</td>
                      <td data-label="Puntaje"><span className={`admin-record-score ${record.score == null ? '' : record.score >= 70 ? 'high' : record.score >= 40 ? 'medium' : 'low'}`}>{record.score ?? '—'}{record.score == null ? '' : '/100'}</span></td>
                    </tr>
                  ))}
                  {!filteredRecords.length && <tr><td className="admin-empty" colSpan="4">{records.length ? 'No hay registros que coincidan con la búsqueda o fecha.' : 'No hay registros históricos guardados de la versión anterior.'}</td></tr>}
                </tbody>
              </table>
            </div>
          )}
          {recordNextPageToken && <button type="button" className="admin-load-more" onClick={() => loadRecords(true)} disabled={loadingRecords}>{loadingRecords ? 'Cargando…' : 'Cargar registros anteriores'}</button>}
        </div>
      )}

      {section === 'admins' && (
        <div className="admin-section">
          {sectionHeading('ACCESO', 'Administradores', 'La cuenta propietaria gestiona quién más puede entrar a este panel.') }
          {isSuperAdmin && (
            <form className="admin-users-toolbar" onSubmit={(event) => {
              event.preventDefault();
              if (adminEmail.trim()) setConfirmAction({ type: 'grant-admin', email: adminEmail.trim() });
            }}>
              <label className="admin-search">
                <ShieldCheck size={16} />
                <input type="email" autoComplete="email" required value={adminEmail}
                  onChange={(event) => setAdminEmail(event.target.value)}
                  placeholder="Correo de una cuenta registrada" aria-label="Correo de cuenta a designar administrador" />
              </label>
              <button type="submit" className="admin-load-more" disabled={busyAdminRole}>Dar acceso de administrador</button>
            </form>
          )}
          <div className="admin-account-list">
            {adminAccounts.map((account) => (
              <article className="admin-current-account" key={account.uid}>
                <span className="admin-security-icon"><ShieldCheck size={23} /></span>
                <div><strong>{account.name || 'Sin nombre'}</strong><p>{account.email || 'Correo no disponible'}</p><span>{account.superAdmin ? 'Propietario principal' : account.uid === user?.uid ? 'Sesión actual · Administrador' : 'Administrador delegado'}</span></div>
                <span className="admin-provider-tag">{account.providers?.includes('google.com') ? 'Google' : account.providers?.includes('password') ? 'Correo' : 'Otro'}</span>
                {isSuperAdmin && !account.superAdmin && (
                  <button type="button" className="admin-action-button danger"
                    onClick={() => setConfirmAction({ type: 'remove-admin', account })}
                    disabled={busyAdminRole}>
                    <ShieldCheck size={14} />Retirar acceso
                  </button>
                )}
              </article>
            ))}
            {!adminAccounts.length && <p className="admin-loading">No se encontró una cuenta administradora sincronizada.</p>}
          </div>
          <p className="admin-footnote">{isSuperAdmin
            ? 'Solo la cuenta propietaria puede conceder o retirar este acceso. Los cambios se validan en el backend y se reflejan en PostgreSQL.'
            : 'Puedes consultar las cuentas autorizadas. Solo la cuenta propietaria puede cambiar los roles.'}</p>
        </div>
      )}

      {section === 'apis' && (
        <div className="admin-section">
          {sectionHeading('MONITOREO', 'Estado de servicios externos', 'Comprueba si los servicios de SyncLife responden.')}
          {apis?.checkedAt && <span className="admin-updated">Revisado {formatApiDate(apis.checkedAt)}</span>}
          {!apis ? (apisLoading
            ? <p className="admin-loading" role="status">Comprobando proveedores…</p>
            : <button type="button" className="admin-load-more" onClick={refreshApis}>Volver a comprobar</button>) : (
            <div className="admin-api-grid">
              <article className="admin-api-card">
                <div className="admin-api-heading"><span className={`admin-api-dot ${apis.youtube.status}`} /><div><h3>YouTube</h3><span>{apis.youtube.status === 'online' ? 'Responde' : 'Sin respuesta'}</span></div></div>
                <p>{apis.youtube.detail}</p>
                <small>Consumo estimado de cuota de YouTube Data API: {apis.youtube.dataApiQuotaEstimate} solicitudes.</small>
              </article>
              <article className="admin-api-card">
                <div className="admin-api-heading"><span className={`admin-api-dot ${apis.weather.status}`} /><div><h3>Clima</h3><span>{apis.weather.status === 'online' ? `Disponible · ${apis.weather.source}` : 'No disponible / dato anterior'}</span></div></div>
                <p>{apis.weather.detail}</p>
                <small>Solicitudes desde que inició el backend: Open-Meteo {apis.weather.requestsSinceStart.openMeteo} · wttr.in {apis.weather.requestsSinceStart.wttr}. Es una estimación; puede reiniciarse al desplegar.</small>
              </article>
            </div>
          )}
        </div>
      )}

      {section === 'security' && (
        <div className="admin-section">
          {sectionHeading('CONTROL DE ACCESO', 'Seguridad del panel', 'Cómo se protegen el acceso y los datos administrativos.')}
          <div className="admin-security-card">
            <span className="admin-security-icon"><ShieldCheck size={23} /></span>
            <div><strong>{isAdmin ? 'Rol de administrador verificado' : 'Sin rol de administrador'}</strong><p>El token de Firebase incluye la custom claim <code>admin: true</code>. El backend verifica la firma y el rol en cada operación privilegiada.</p></div>
          </div>
          <div className="admin-security-grid">
            <article><strong>PostgreSQL en Render</strong><p>Las cuentas y la actividad agregada nueva se guardan en la base de datos del backend. Los registros históricos anteriores permanecen en Firestore.</p></article>
            <article><strong>Datos personales</strong><p>No se exponen edad, peso, talla, calorías, finanzas, calendario, comidas ni rutinas individuales en el panel.</p></article>
            <article><strong>Cuenta propietaria</strong><p>La identidad principal está fijada por el backend. Solo esa cuenta puede conceder o retirar roles administrativos.</p></article>
          </div>
          <button type="button" className="admin-load-more" onClick={onRefreshClaim}>Volver a comprobar mi rol</button>
        </div>
      )}
      {confirmAction && (
        <div className="logout-dialog-backdrop">
          <section className="logout-dialog admin-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-confirm-title">
            <span className="logout-dialog-icon">{confirmAction.type === 'delete' ? <Trash2 size={20} /> : confirmAction.type === 'grant-admin' || confirmAction.type === 'remove-admin' ? <ShieldCheck size={20} /> : <Lock size={20} />}</span>
            <h2 id="admin-confirm-title">{confirmAction.type === 'delete' ? '¿Eliminar esta cuenta?' : confirmAction.type === 'grant-admin' ? '¿Dar acceso de administrador?' : confirmAction.type === 'remove-admin' ? '¿Retirar el acceso de administrador?' : confirmAction.disabled ? '¿Bloquear esta cuenta?' : '¿Desbloquear esta cuenta?'}</h2>
            <p>{confirmAction.type === 'delete'
              ? `Se eliminará la cuenta de ${confirmAction.account.email || confirmAction.account.name} de Firebase. Esta acción no se puede deshacer.`
              : confirmAction.type === 'grant-admin'
                ? `La cuenta ${confirmAction.email} podrá acceder al panel y administrar usuarios. Solo la cuenta propietaria podrá gestionar roles de administrador.`
                : confirmAction.type === 'remove-admin'
                  ? `${confirmAction.account.email || confirmAction.account.name} perderá el acceso administrativo y deberá iniciar sesión nuevamente.`
              : confirmAction.disabled
                ? `${confirmAction.account.email || confirmAction.account.name} ya no podrá iniciar sesión en SyncLife.`
                : `${confirmAction.account.email || confirmAction.account.name} podrá volver a iniciar sesión en SyncLife.`}</p>
            <div className="logout-dialog-actions">
              <button type="button" className="logout-cancel-button" onClick={() => setConfirmAction(null)} disabled={confirming}>Cancelar</button>
              <button type="button" className="logout-confirm-button" onClick={performConfirmedAction} disabled={confirming}>
                {confirming ? 'Procesando…' : confirmAction.type === 'delete' ? 'Sí, eliminar' : confirmAction.type === 'grant-admin' ? 'Sí, dar acceso' : confirmAction.type === 'remove-admin' ? 'Sí, retirar acceso' : confirmAction.disabled ? 'Sí, bloquear' : 'Sí, desbloquear'}
              </button>
            </div>
          </section>
        </div>
      )}
        </div>
      </div>
    </section>
  );
}

const weekdays = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
function normalizeGeneratedWorkouts(workouts) {
  if (!workouts || typeof workouts !== 'object') return null;
  const normalizePlan = (plan) => {
    if (!Array.isArray(plan) || plan.length !== weekdays.length) return null;
    const normalized = plan.map((day, index) => {
      if (!day || day.day !== weekdays[index] || !Array.isArray(day.activities)
        || !day.activities.every((activity) => typeof activity === 'string')
        || !Number.isFinite(Number(day.duration)) || Number(day.duration) < 0 || Number(day.duration) > 180) {
        return null;
      }
      return { ...day, activities: day.activities, duration: Number(day.duration) };
    });
    return normalized.every(Boolean) ? normalized : null;
  };
  const casa = normalizePlan(workouts.casa || workouts.home);
  const gimnasio = normalizePlan(workouts.gimnasio || workouts.gym);
  if (!casa || !gimnasio) return null;
  return {
    ...workouts,
    casa,
    gimnasio,
    intensity: typeof workouts.intensity === 'string' ? workouts.intensity : 'Intensidad gradual',
  };
}

const expenseCategories = ['Alimentación', 'Transporte', 'Ropa', 'Medicamentos', 'Hogar', 'Ocio', 'Otros'];
const expenseCategoryIcons = {
  Alimentación: Coffee,
  Transporte: MapPin,
  Ropa: Shirt,
  Medicamentos: Pill,
  Hogar: Home,
  Ocio: ShoppingBag,
  Otros: CircleDollarSign,
};
const mealTypes = ['Desayuno', 'Almuerzo', 'Cena', 'Break'];
const mealTypeLabels = {
  Desayuno: 'Desayuno',
  Almuerzo: 'Almuerzo',
  Cena: 'Cena',
  Break: 'Refrigerio (break)',
};
const mealCategoryLabels = {
  Desayuno: 'DESAYUNO',
  Almuerzo: 'ALMUERZO',
  Cena: 'CENA',
  Break: 'BREAK',
};

function getPortionWeightInGrams(portion) {
  const match = String(portion || '').match(/(\d+(?:[.,]\d+)?)\s*(kg|kilogramos?|g|gr|gramos?)\b/i);
  if (!match) return null;
  const amount = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * (match[2].toLocaleLowerCase('es').startsWith('k') ? 1000 : 1));
}

function scaleNutritionValue(value, factor, digits = 1) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  const scale = 10 ** digits;
  return String(Math.round(value * factor * scale) / scale);
}
const initialWorkouts = [
  { day: 1, name: 'Fuerza: cuerpo completo', duration: 35 },
  { day: 2, name: 'Movilidad y caminata', duration: 25 },
  { day: 3, name: 'Fuerza: tren superior', duration: 35 },
  { day: 4, name: 'Descanso activo', duration: 20 },
  { day: 5, name: 'Fuerza: tren inferior', duration: 35 },
  { day: 6, name: 'Cardio suave', duration: 30 },
  { day: 7, name: 'Descanso y recuperación', duration: 0 },
];
// Videos públicos seleccionados para reproducirse dentro de la app; así no se requiere una API key de YouTube.
const workoutVideos = [
  { day: 1, id: 'UItWltVZZmE', title: '20 min Full Body Workout · Beginner', channel: 'Pamela Reif' },
  { day: 2, id: 'L_xrDAtykMI', title: '15 Minute Beginner Stretch Flexibility Routine', channel: 'Tom Merrick' },
  { day: 3, id: 'Iv7RaQ6gF60', title: '20 Min Upper Body Workout At Home', channel: 'Oliver Sjostrom' },
  { day: 4, id: 'Ti619v18nHw', title: '20 min Total Body Stretch · Recovery', channel: 'fitbymik' },
  { day: 5, id: 'q7rCeOa_m58', title: '20 Min Complete Home Leg Workout', channel: 'THENX' },
  { day: 6, id: 'ml6cT4AZdqI', title: '30-Minute HIIT Cardio Workout with Warm Up', channel: 'SELF' },
  { day: 7, id: 'pc1X9rWgDYA', title: '15 Min Gentle Full Body Yoga · Recovery', channel: 'Yoga With Tim' },
];
const recipeVideos = [
  { id: 'Ym27HIH1Pww', title: 'Budín de banana y avena', channel: 'Mica', recipeType: 'Desayuno' },
  { id: 'cDNmCQlma-8', title: 'Lentejas deliciosas', channel: 'Sarai vlogs Aparicio', recipeType: 'Almuerzo' },
  { id: '6BtquAurr5A', title: 'Tortilla de huevo con vegetales', channel: 'Cooking And Healthy Taste', recipeType: 'Cena' },
  { id: 'iS-xSjCaF64', title: 'Ensaladas de piña: tres opciones', channel: "Q'Rico recetas", recipeType: 'Break' },
];
const homeWorkoutMoves = ['Sentadillas a una silla', 'Flexiones inclinadas', 'Puente de glúteos', 'Bird-dog y movilidad'];
const gymWorkoutMoves = ['Prensa ligera', 'Jalón al pecho', 'Peso muerto con mancuernas', 'Bicicleta suave'];

function BarChart({ records }) {
  if (!records.length) {
    return <div className="chart-empty"><BarChart3 size={22} /><span>Tus minutos de actividad aparecerán aquí.</span></div>;
  }

  const max = Math.max(30, ...records.map((record) => Number(record.minutes) || 0));
  return (
    <div className="bar-chart" role="img" aria-label="Minutos de actividad física por día">
      {records.map((record, index) => {
        const value = Number(record.minutes) || 0;
        return (
          <div className="bar-chart-column" key={`${record.date}-${index}`} title={`${record.date}: ${value} min`}>
            <span className="bar-chart-value">{value}</span>
            <div className="bar-chart-track"><i style={{ height: `${Math.max(4, value / max * 100)}%` }} /></div>
            <span className="bar-chart-label">{record.date.slice(5)}</span>
          </div>
        );
      })}
    </div>
  );
}

function EmbeddedVideoCarousel({ title, videos, selectedIndex, onSelect, onPrevious, onNext, autoAdvanceMs = 0 }) {
  const [isPaused, setIsPaused] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const currentVideo = videos[selectedIndex];

  useEffect(() => {
    if (!autoAdvanceMs || isPaused || isHovered || videos.length < 2) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        onSelect((index) => (index + 1) % videos.length);
      }
    }, autoAdvanceMs);

    return () => window.clearInterval(intervalId);
  }, [autoAdvanceMs, isHovered, isPaused, onSelect, videos.length]);

  if (!currentVideo) return null;

  return (
    <section
      className="embedded-video-carousel"
      aria-label={title}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="embedded-video-heading">
        <div><span className="section-kicker">{title}</span><strong>{currentVideo.title}</strong><small>{currentVideo.channel}</small></div>
        {videos.length > 1 && (
          <div className="carousel-controls">
            {autoAdvanceMs > 0 && (
              <button
                className="calendar-arrow"
                aria-label={isPaused ? 'Reanudar carrusel automático' : 'Pausar carrusel automático'}
                aria-pressed={isPaused}
                onClick={() => setIsPaused((paused) => !paused)}
              >
                {isPaused ? <Play size={16} /> : <Pause size={16} />}
              </button>
            )}
            <button className="calendar-arrow" aria-label="Video anterior" onClick={onPrevious}><ChevronLeft size={18} /></button>
            <button className="calendar-arrow" aria-label="Siguiente video" onClick={onNext}><ChevronRight size={18} /></button>
          </div>
        )}
      </div>
      <div className="embedded-video-frame">
        <iframe
          key={currentVideo.id}
          src={`https://www.youtube-nocookie.com/embed/${currentVideo.id}?playsinline=1&rel=0`}
          title={`${currentVideo.title} · ${currentVideo.channel}`}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </div>
      {videos.length > 1 && (
        <div className="embedded-video-thumbnails">
          {videos.map((video, index) => (
            <button
              className={`embedded-video-thumbnail ${index === selectedIndex ? 'active' : ''}`}
              key={`${video.id}-${index}`}
              onClick={() => onSelect(index)}
              aria-label={`Reproducir: ${video.title}`}
              aria-pressed={index === selectedIndex}
            >
              <img src={`https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`} alt="" loading="lazy" />
              <span>{video.title}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function readStored(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    console.error(`No se pudo leer ${key} del almacenamiento local:`, error);
    return fallback;
  }
}

function userStorageKey(userId, key) {
  const normalizedId = String(userId || '').trim().toLocaleLowerCase('es');
  return `synclife-user:${encodeURIComponent(normalizedId)}:${key}`;
}

function readUserStored(userId, key, fallback, legacyName = '') {
  try {
    const scopedValue = window.localStorage.getItem(userStorageKey(userId, key));
    if (scopedValue !== null) return JSON.parse(scopedValue);
    if (legacyName) {
      const lastProfile = readStored(STORAGE_KEYS.profile, {});
      if (String(lastProfile.name || '').trim().toLocaleLowerCase('es') === legacyName.trim().toLocaleLowerCase('es')) {
        const legacyScopedValue = window.localStorage.getItem(userStorageKey(legacyName, key));
        if (legacyScopedValue !== null) return JSON.parse(legacyScopedValue);
        return readStored(key, fallback);
      }
    }
    return fallback;
  } catch (error) {
    console.error(`No se pudo leer ${key} para la cuenta ${userId}:`, error);
    return fallback;
  }
}

function readExerciseSessions(userId, legacyName = '') {
  const savedSessions = readUserStored(userId, STORAGE_KEYS.exerciseSessions, null, legacyName);
  if (Array.isArray(savedSessions)) return savedSessions;
  const previousRecords = readUserStored(userId, STORAGE_KEYS.history, [], legacyName);
  return Array.isArray(previousRecords)
    ? previousRecords
      .filter((record) => typeof record.exercise === 'string' && record.exercise.trim() && Number(record.exerciseMinutes) > 0)
      .map((record) => ({
        id: `legacy-${record.date}`,
        activity: record.exercise,
        minutes: Number(record.exerciseMinutes),
        date: record.date,
      }))
    : [];
}

function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function fixedCostDay(cost) {
  return Number(cost.dueDay) || new Date(`${cost.dueDate}T12:00:00`).getDate();
}

function fixedCostDateInMonth(cost, date) {
  const day = Math.min(fixedCostDay(cost), new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate());
  return new Date(date.getFullYear(), date.getMonth(), day, 12);
}

function nextFixedCostDate(cost, from = new Date()) {
  let dueDate = fixedCostDateInMonth(cost, from);
  if (localDate(dueDate) < localDate(from)) {
    dueDate = fixedCostDateInMonth(cost, new Date(from.getFullYear(), from.getMonth() + 1, 1));
  }
  return localDate(dueDate);
}

function currency(value) {
  return new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(Number(value) || 0);
}

function dateLabel(date, options = { weekday: 'long', day: 'numeric', month: 'long' }) {
  return new Intl.DateTimeFormat('es-PE', options).format(date);
}

function weatherDetails(weather) {
  if (!weather) return '';
  const details = [];
  if (weather.descripcion && weather.descripcion !== 'Sin descripción') details.push(weather.descripcion);
  if (Number.isFinite(weather.viento)) {
    details.push(`Viento ${weather.viento} ${weather.unidades?.viento || 'km/h'}`);
  }
  return details.join(' · ');
}

function weatherSummary(weather, error, loading) {
  if (error || weather?.warning) return error || weather.warning;
  return [
    weatherDetails(weather),
    weather?.source || (loading ? 'Consultando proveedores del clima' : 'Sin dato actual'),
  ].filter(Boolean).join(' · ');
}

export default function App() {
  const [vista, setVista] = useState('inicio');
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const usernameAssignments = useRef(new Map());
  const [authError, setAuthError] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [adminClaimReady, setAdminClaimReady] = useState(false);
  const [adminEntryRequested, setAdminEntryRequested] = useState(false);
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [authNotice, setAuthNotice] = useState('');
  const [authMode, setAuthMode] = useState('login');
  const [authUsername, setAuthUsername] = useState('');
  const [usernameSetupOpen, setUsernameSetupOpen] = useState(false);
  const [usernameSetupValue, setUsernameSetupValue] = useState('');
  const [usernameSetupPassword, setUsernameSetupPassword] = useState('');
  const [usernameSetupPasswordConfirmation, setUsernameSetupPasswordConfirmation] = useState('');
  const [usernameSetupError, setUsernameSetupError] = useState('');
  const [usernameSetupLoading, setUsernameSetupLoading] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authPasswordConfirmation, setAuthPasswordConfirmation] = useState('');
  const [rememberSession, setRememberSession] = useState(true);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [legalDocument, setLegalDocument] = useState('');
  const [pendingGoogleCredential, setPendingGoogleCredential] = useState(null);
  const [showCurtain, setShowCurtain] = useState(false);
  const [profile, setProfile] = useState(() => readStored(STORAGE_KEYS.profile, { name: 'Nicol', onboarded: false }));
  const [showEventForm, setShowEventForm] = useState(false);
  const [exerciseActivity, setExerciseActivity] = useState('');
  const [exerciseMinutes, setExerciseMinutes] = useState('');
  const [exerciseDate, setExerciseDate] = useState(localDate());
  const [exerciseSessions, setExerciseSessions] = useState(() => readExerciseSessions(readStored(STORAGE_KEYS.profile, { name: 'Nicol' }).name));
  const [tourStep, setTourStep] = useState(() => {
    const savedProfile = readStored(STORAGE_KEYS.profile, { name: 'Nicol', onboarded: false });
    return savedProfile.onboarded ? -1 : 0;
  });
  const [ciudad, setCiudad] = useState('Cusco');
  const [ingreso, setIngreso] = useState(() => readUserStored(readStored(STORAGE_KEYS.profile, { name: 'Nicol' }).name, STORAGE_KEYS.income, 0));
  const [fixedCosts, setFixedCosts] = useState(() => readUserStored(readStored(STORAGE_KEYS.profile, { name: 'Nicol' }).name, STORAGE_KEYS.fixedCosts, []));
  const [foodBudget, setFoodBudget] = useState(() => readUserStored(readStored(STORAGE_KEYS.profile, { name: 'Nicol' }).name, STORAGE_KEYS.foodBudget, 0));
  const [bodyProfile, setBodyProfile] = useState(() => {
    const savedProfile = readUserStored(readStored(STORAGE_KEYS.profile, { name: 'Nicol' }).name, STORAGE_KEYS.bodyProfile, { weight: '', height: '', sex: '', age: '' });
    return {
      ...savedProfile,
      sex: savedProfile.sex === 'mujer' ? 'femenino' : savedProfile.sex === 'hombre' ? 'masculino' : savedProfile.sex,
    };
  });
  const [workoutPreference, setWorkoutPreference] = useState(() => readUserStored(readStored(STORAGE_KEYS.profile, { name: 'Nicol' }).name, STORAGE_KEYS.workoutPreference, 'casa'));
  const [mealPlans, setMealPlans] = useState(() => {
    const savedMeals = readUserStored(readStored(STORAGE_KEYS.profile, { name: 'Nicol' }).name, STORAGE_KEYS.mealPlans, []);
    return Array.isArray(savedMeals) ? savedMeals.filter((meal) => !meal.generatedRecommendation) : [];
  });
  const [generatedWorkouts, setGeneratedWorkouts] = useState(() => normalizeGeneratedWorkouts(
    readUserStored(readStored(STORAGE_KEYS.profile, { name: 'Nicol' }).name, STORAGE_KEYS.generatedWorkouts, null),
  ));
  const [newHabitName, setNewHabitName] = useState('');
  const [newHabitDetail, setNewHabitDetail] = useState('');
  const [editingHabitId, setEditingHabitId] = useState(null);
  const [isGeneratingWorkout, setIsGeneratingWorkout] = useState(false);
  const [workoutRecommendationMessage, setWorkoutRecommendationMessage] = useState('');
  const [fixedName, setFixedName] = useState('');
  const [fixedAmount, setFixedAmount] = useState('');
  const [fixedDueDate, setFixedDueDate] = useState(localDate());
  const [mealType, setMealType] = useState(mealTypes[0]);
  const [mealName, setMealName] = useState('');
  const [mealCost, setMealCost] = useState('');
  const [mealDate, setMealDate] = useState(localDate());
  const [mealFiber, setMealFiber] = useState('');
  const [mealSodium, setMealSodium] = useState('');
  const [mealAddedSugar, setMealAddedSugar] = useState('');
  const [mealMicronutrients, setMealMicronutrients] = useState('');
  const [mealEnergy, setMealEnergy] = useState('');
  const [mealProtein, setMealProtein] = useState('');
  const [mealCarbohydrates, setMealCarbohydrates] = useState('');
  const [mealFat, setMealFat] = useState('');
  const [mealPortion, setMealPortion] = useState('');
  const [mealNutritionEstimate, setMealNutritionEstimate] = useState(null);
  const [mealNutritionMatches, setMealNutritionMatches] = useState([]);
  const [selectedNutritionMatchIndex, setSelectedNutritionMatchIndex] = useState(-1);
  const [mealNutritionError, setMealNutritionError] = useState('');
  const [isSearchingMealNutrition, setIsSearchingMealNutrition] = useState(false);

  const today = new Date();
  const [eventoNombre, setEventoNombre] = useState('');
  const [eventoFecha, setEventoFecha] = useState(localDate(today));
  const [eventMode, setEventMode] = useState('horas');
  const [horaIn, setHoraIn] = useState('09:00');
  const [horaOut, setHoraOut] = useState('10:00');
  const [statusSelect, setStatusSelect] = useState('amber');
  const [selectedDate, setSelectedDate] = useState(today);
  const [habits, setHabits] = useState(() => readUserStored(
    readStored(STORAGE_KEYS.profile, { name: 'Nicol' }).name,
    STORAGE_KEYS.habits,
    [],
  ));
  const [habitDate, setHabitDate] = useState(() => readUserStored(readStored(STORAGE_KEYS.profile, { name: 'Nicol' }).name, STORAGE_KEYS.habitDate, localDate()));
  const [events, setEvents] = useState(() => readUserStored(readStored(STORAGE_KEYS.profile, { name: 'Nicol' }).name, STORAGE_KEYS.events, []));
  const [notifiedEvents, setNotifiedEvents] = useState(() => readUserStored(readStored(STORAGE_KEYS.profile, { name: 'Nicol' }).name, STORAGE_KEYS.notifiedEvents, []));
  // Los gastos detallados se guardan junto a las finanzas locales para que el panel y el presupuesto compartan los mismos datos.
  const [expenses, setExpenses] = useState(() => readUserStored(readStored(STORAGE_KEYS.profile, { name: 'Nicol' }).name, STORAGE_KEYS.expenses, []));
  const [expenseName, setExpenseName] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseCategory, setExpenseCategory] = useState(expenseCategories[0]);
  const [selectedWorkoutDay, setSelectedWorkoutDay] = useState(() => (new Date().getDay() + 6) % 7);
  const [selectedRecipeVideo, setSelectedRecipeVideo] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [weatherApi, setWeatherApi] = useState(null);
  const [weatherRefresh, setWeatherRefresh] = useState(0);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState('');
  const [notification, setNotification] = useState('');
  const dailyExpenses = expenses.filter((expense) => expense.date === localDate(today));
  const dailyExpenseTotal = dailyExpenses.reduce((total, expense) => total + (Number(expense.amount) || 0), 0);
  const monthlyExpenses = expenses
    .filter((expense) => expense.date.slice(0, 7) === localDate(today).slice(0, 7))
    .reduce((total, expense) => total + (Number(expense.amount) || 0), 0);
  const monthlyFoodExpenses = expenses
    .filter((expense) => expense.date.slice(0, 7) === localDate(today).slice(0, 7) && expense.category === 'Alimentación')
    .reduce((total, expense) => total + (Number(expense.amount) || 0), 0);
  const pendingHabits = habits.filter((habit) => !habit.complete);
  const completeCount = habits.filter((habit) => habit.complete).length;
  const completionRate = habits.length ? Math.round((completeCount / habits.length) * 100) : 0;
  const expenseTotal = dailyExpenseTotal;
  const fixedCostTotal = fixedCosts.reduce((total, item) => total + (Number(item.amount) || 0), 0);
  const availableBudget = Number(ingreso) - fixedCostTotal
    - Math.max(Number(foodBudget) || 0, monthlyFoodExpenses)
    - Math.max(0, monthlyExpenses - monthlyFoodExpenses);
  const upcomingFixedCosts = fixedCosts
    .map((item) => ({ ...item, dueDate: nextFixedCostDate(item) }))
    .filter((item) => {
      const daysUntilDue = (new Date(`${item.dueDate}T12:00:00`) - new Date(`${localDate()}T12:00:00`)) / 86400000;
      return daysUntilDue >= 0 && daysUntilDue <= 7;
    })
    .sort((first, second) => first.dueDate.localeCompare(second.dueDate));
  const notificationItems = [
    ...pendingHabits.map((habit) => ({
      id: `habit-${habit.id}`,
      title: habit.name,
      detail: 'Rutina diaria pendiente',
      action: () => { setVista('inicio'); setNotificationsOpen(false); },
    })),
    ...upcomingFixedCosts.map((cost) => ({
      id: `cost-${cost.id}`,
      title: cost.name,
      detail: `Vence ${dateLabel(new Date(`${cost.dueDate}T12:00:00`), { day: 'numeric', month: 'short' })} · ${currency(cost.amount)}`,
      action: () => { setSelectedDate(new Date(`${cost.dueDate}T12:00:00`)); setVista('finanzas'); setNotificationsOpen(false); },
    })),
    ...events.filter((event) => event.status !== 'green' && event.date <= localDate(today)).map((event) => ({
      id: `event-${event.id}`,
      title: event.name,
      detail: event.date < localDate(today) ? 'Evento atrasado' : 'Evento pendiente de hoy',
      action: () => { setSelectedDate(new Date(`${event.date}T12:00:00`)); setVista('calendario'); setNotificationsOpen(false); },
    })),
  ];
  const todaysExerciseSessions = exerciseSessions.filter((session) => session.date === localDate(today));
  const todaysExerciseMinutes = todaysExerciseSessions.reduce((total, session) => total + (Number(session.minutes) || 0), 0);
  const weeklyExerciseSummary = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6 + index);
    const dateKey = localDate(date);
    return {
      date: dateKey,
      minutes: exerciseSessions
        .filter((session) => session.date === dateKey)
        .reduce((total, session) => total + (Number(session.minutes) || 0), 0),
    };
  });
  // Recomendaciones explicables que se calculan en el navegador; no se envían datos personales a una IA externa.
  const assistantInsight = availableBudget < 0
    ? 'Tus gastos asignados superan el presupuesto. Revisa las compras del mes y ajusta primero los montos flexibles.'
    : dailyExpenseTotal > 0
      ? `Llevas ${currency(dailyExpenseTotal)} en compras hoy. Registrar cada categoría te ayuda a detectar en qué se va tu dinero.`
      : pendingHabits.length
        ? `Tu siguiente paso sencillo: completar “${pendingHabits[0].name}”. Un hábito pequeño también cuenta.`
        : '¡Buen avance! Hoy completaste tus hábitos. Puedes planificar tu próxima comida o actividad.';

  useEffect(() => {
    if (!profile.accountId) return;
    const saved = [
      [STORAGE_KEYS.habits, habits],
      [STORAGE_KEYS.events, events],
      [STORAGE_KEYS.income, ingreso],
      [STORAGE_KEYS.fixedCosts, fixedCosts],
      [STORAGE_KEYS.foodBudget, foodBudget],
      [STORAGE_KEYS.bodyProfile, bodyProfile],
      [STORAGE_KEYS.workoutPreference, workoutPreference],
      [STORAGE_KEYS.mealPlans, mealPlans],
      [STORAGE_KEYS.notifiedEvents, notifiedEvents],
      [STORAGE_KEYS.expenses, expenses],
      [STORAGE_KEYS.habitDate, habitDate],
      [STORAGE_KEYS.generatedWorkouts, generatedWorkouts],
      [STORAGE_KEYS.exerciseSessions, exerciseSessions],
    ];
    saved.forEach(([key, value]) => {
      try {
        window.localStorage.setItem(userStorageKey(profile.accountId, key), JSON.stringify(value));
      } catch (error) {
        console.error(`No se pudo guardar ${key} para la cuenta ${profile.accountId}:`, error);
      }
    });
    try {
      window.localStorage.setItem(userStorageKey(profile.accountId, STORAGE_KEYS.profile), JSON.stringify(profile));
    } catch (error) {
      console.error('No se pudo guardar el perfil de la cuenta en el almacenamiento local:', error);
    }
  }, [habits, events, ingreso, fixedCosts, foodBudget, bodyProfile, workoutPreference, mealPlans, profile, notifiedEvents, expenses, habitDate, generatedWorkouts, exerciseSessions]);

  useEffect(() => {
    const checkForNewDay = () => {
      const currentDate = localDate();
      if (habitDate !== currentDate) {
        setHabits((current) => current.map((habit) => ({ ...habit, complete: false })));
        setHabitDate(currentDate);
      }
    };
    const intervalId = window.setInterval(checkForNewDay, 60000);
    return () => window.clearInterval(intervalId);
  }, [habitDate]);

  useEffect(() => {
    if (!isLoggedIn || !ciudad.trim()) return undefined;
    const controller = new AbortController();
    let active = true;
    const updateWeather = async () => {
      setWeatherLoading(true);
      setWeatherError('');
      try {
        const response = await fetch(apiUrl(`/api/synclife/weather?city=${encodeURIComponent(ciudad.trim())}`), { signal: controller.signal });
        const responseText = await response.text();
        let result;
        try {
          result = JSON.parse(responseText);
        } catch {
          const contentType = response.headers.get('content-type') || '';
          if (contentType.includes('text/html') || /^\s*</.test(responseText)) {
            throw new Error('El backend respondió una página web en vez del clima. Reinicia el backend con «npm run dev» y vuelve a intentar.');
          }
          throw new Error('El backend devolvió una respuesta que no se pudo leer. Reinicia el backend y vuelve a intentar.');
        }
        if (!response.ok) throw new Error(result.error || 'No se pudo consultar el clima.');
        if (active) {
          setWeatherApi(result);
          setWeatherError(result.temp == null ? result.warning || 'No se recibió un dato del clima.' : '');
        }
      } catch (error) {
        if (active && error.name !== 'AbortError') {
          console.error('No se pudo actualizar el clima:', error);
          setWeatherError(error.message || 'No se pudo conectar con el servicio del clima.');
        }
      } finally {
        if (active) setWeatherLoading(false);
      }
    };
    const initialRequest = window.setTimeout(updateWeather, 300);
    const intervalId = window.setInterval(updateWeather, 30 * 60 * 1000);
    const refreshOnReturn = () => {
      if (document.visibilityState === 'visible') updateWeather();
    };
    document.addEventListener('visibilitychange', refreshOnReturn);
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(initialRequest);
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', refreshOnReturn);
    };
  }, [isLoggedIn, ciudad, weatherRefresh]);

  useEffect(() => {
    if (!showCurtain) return undefined;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timeoutId = window.setTimeout(() => setShowCurtain(false), prefersReducedMotion ? 0 : 4000);
    return () => window.clearTimeout(timeoutId);
  }, [showCurtain]);

  useEffect(() => {
    const checkReminders = () => {
      const now = new Date();
      const dueEvents = events.filter((event) => {
        if (event.allDay || notifiedEvents.includes(event.id)) return false;
        const eventTime = new Date(`${event.date}T${event.start || '09:00'}:00`);
        const minutesLate = (now.getTime() - eventTime.getTime()) / 60000;
        return minutesLate >= 0 && minutesLate < 5;
      });
      const dueFixedCosts = fixedCosts.filter((cost) => {
        const reminderId = `fixed-${cost.id}-${localDate(now).slice(0, 7)}`;
        if (notifiedEvents.includes(reminderId) || nextFixedCostDate(cost, now) !== localDate(now)) return false;
        const reminderTime = new Date(`${localDate(now)}T09:00:00`);
        const minutesLate = (now.getTime() - reminderTime.getTime()) / 60000;
        return minutesLate >= 0 && minutesLate < 5;
      });

      if (!dueEvents.length && !dueFixedCosts.length) return;
      const fixedReminderIds = dueFixedCosts.map((cost) => `fixed-${cost.id}-${localDate(now).slice(0, 7)}`);
      setNotifiedEvents((current) => [...new Set([...current, ...dueEvents.map((event) => event.id), ...fixedReminderIds])]);
      dueEvents.forEach((event) => {
        const message = `${profile.name}, ya es hora de: ${event.name}.`;
        setNotification(message);
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('SyncLife OS', { body: message });
        }
      });
      dueFixedCosts.forEach((cost) => {
        const message = `${profile.name}, hoy vence ${cost.name} (${currency(cost.amount)}).`;
        setNotification(message);
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('SyncLife OS', { body: message });
        }
      });
    };

    checkReminders();
    const intervalId = window.setInterval(checkReminders, 30000);
    return () => window.clearInterval(intervalId);
  }, [events, fixedCosts, notifiedEvents, profile.name]);

  const finishTour = () => {
    const name = profile.name.trim() || 'Nicol';
    setProfile((current) => ({ ...current, name, onboarded: true }));
    setTourStep(-1);
  };

  const trackAdminActivity = async (type, recordId, extra = {}) => {
    if (!auth?.currentUser || auth.currentUser.uid === 'local-demo-user') return;
    const token = await auth.currentUser.getIdToken();
    const response = await fetch(apiUrl('/api/admin/activity'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type, recordId, ...extra }),
    });
    if (!response.ok) {
      const responseText = await response.text();
      let result;
      try {
        result = JSON.parse(responseText);
      } catch {
        throw new Error('El backend no devolvió un error legible al actualizar el conteo agregado.');
      }
      throw new Error(result.error || 'No se pudo actualizar el conteo agregado.');
    }
  };

  const enterDemoWorkspace = () => {
    setIsAdmin(false);
    const demoUser = {
      uid: 'local-demo-user',
      displayName: 'Usuario demo',
      email: 'demo@local.test',
      photoURL: '',
    };
    const accountId = demoUser.uid;
    const userProfile = readUserStored(accountId, STORAGE_KEYS.profile, { name: demoUser.displayName, onboarded: true }, demoUser.displayName);
    const savedHabits = readUserStored(accountId, STORAGE_KEYS.habits, []);
    const savedBudget = readUserStored(accountId, STORAGE_KEYS.foodBudget, 0);
    setProfile({ ...userProfile, name: userProfile.name || demoUser.displayName, username: '', accountId, email: demoUser.email, photoURL: demoUser.photoURL });
    setTourStep(userProfile.onboarded ? -1 : 0);
    setHabits(Array.isArray(savedHabits) ? savedHabits : []);
    setEvents(readUserStored(accountId, STORAGE_KEYS.events, []));
    setExerciseSessions(readExerciseSessions(accountId, demoUser.displayName));
    setIngreso(readUserStored(accountId, STORAGE_KEYS.income, 0));
    setFixedCosts(readUserStored(accountId, STORAGE_KEYS.fixedCosts, []));
    setFoodBudget(savedBudget);
    const savedBodyProfile = readUserStored(accountId, STORAGE_KEYS.bodyProfile, { weight: '', height: '', sex: '', age: '' });
    setBodyProfile({
      ...savedBodyProfile,
      sex: savedBodyProfile.sex === 'mujer' ? 'femenino' : savedBodyProfile.sex === 'hombre' ? 'masculino' : savedBodyProfile.sex,
    });
    setWorkoutPreference(readUserStored(accountId, STORAGE_KEYS.workoutPreference, 'casa'));
    const savedMeals = readUserStored(accountId, STORAGE_KEYS.mealPlans, []);
    setMealPlans(Array.isArray(savedMeals) ? savedMeals.filter((meal) => !meal.generatedRecommendation) : []);
    setGeneratedWorkouts(normalizeGeneratedWorkouts(readUserStored(accountId, STORAGE_KEYS.generatedWorkouts, null)));
    setHabitDate(readUserStored(accountId, STORAGE_KEYS.habitDate, localDate()));
    setNotifiedEvents(readUserStored(accountId, STORAGE_KEYS.notifiedEvents, []));
    setExpenses(readUserStored(accountId, STORAGE_KEYS.expenses, []));
    setCiudad('Cusco');
    setExpenseName('');
    setExpenseAmount('');
    setExpenseCategory(expenseCategories[0]);
    setFixedName('');
    setFixedAmount('');
    setFixedDueDate(localDate());
    setMealType(mealTypes[0]);
    setMealName('');
    setMealCost('');
    setMealDate(localDate());
    setMealFiber('');
    setMealSodium('');
    setMealAddedSugar('');
    setMealMicronutrients('');
    setMealEnergy('');
    setMealProtein('');
    setMealCarbohydrates('');
    setMealFat('');
    setMealNutritionEstimate(null);
    setMealNutritionError('');
    setEventoNombre('');
    setEventoFecha(localDate());
    setEventMode('horas');
    setHoraIn('09:00');
    setHoraOut('10:00');
    setStatusSelect('amber');
    setNewHabitName('');
    setNewHabitDetail('');
    setEditingHabitId(null);
    setSelectedRecipeVideo(0);
    setSelectedDate(new Date());
    setSelectedWorkoutDay((new Date().getDay() + 6) % 7);
    setShowEventForm(false);
    setExerciseActivity('');
    setExerciseMinutes('');
    setExerciseDate(localDate());
    setWeatherApi(null);
    setWorkoutRecommendationMessage('');
    setNotification('');
    setIsLoggedIn(true);
    setShowCurtain(true);
  };

  const enterWorkspace = (user) => {
    const accountId = user.uid;
    const name = readUserStored(accountId, STORAGE_KEYS.profile, null, user.displayName || '')?.name
      || user.displayName?.trim()
      || user.email?.split('@')[0]
      || 'Usuario';
    const readAccountData = (key, fallback) => readUserStored(accountId, key, fallback, user.displayName || '');
    const userProfile = readAccountData(STORAGE_KEYS.profile, { name, onboarded: false });
    const savedHabits = readAccountData(STORAGE_KEYS.habits, []);
    const savedBudget = readAccountData(STORAGE_KEYS.foodBudget, 0);
    setProfile({ ...userProfile, name, username: '', accountId, email: user.email || '', photoURL: user.photoURL || '' });
    setTourStep(userProfile.onboarded ? -1 : 0);
    setHabits(Array.isArray(savedHabits) ? savedHabits : []);
    setEvents(readAccountData(STORAGE_KEYS.events, []));
    setExerciseSessions(readExerciseSessions(accountId, user.displayName || ''));
    setIngreso(readAccountData(STORAGE_KEYS.income, 0));
    setFixedCosts(readAccountData(STORAGE_KEYS.fixedCosts, []));
    setFoodBudget(savedBudget);
    const savedBodyProfile = readAccountData(STORAGE_KEYS.bodyProfile, { weight: '', height: '', sex: '', age: '' });
    setBodyProfile({
      ...savedBodyProfile,
      sex: savedBodyProfile.sex === 'mujer' ? 'femenino' : savedBodyProfile.sex === 'hombre' ? 'masculino' : savedBodyProfile.sex,
    });
    setWorkoutPreference(readAccountData(STORAGE_KEYS.workoutPreference, 'casa'));
    const savedMeals = readAccountData(STORAGE_KEYS.mealPlans, []);
    setMealPlans(Array.isArray(savedMeals) ? savedMeals.filter((meal) => !meal.generatedRecommendation) : []);
    setGeneratedWorkouts(normalizeGeneratedWorkouts(readAccountData(STORAGE_KEYS.generatedWorkouts, null)));
    setHabitDate(readAccountData(STORAGE_KEYS.habitDate, localDate()));
    setNotifiedEvents(readAccountData(STORAGE_KEYS.notifiedEvents, []));
    setExpenses(readAccountData(STORAGE_KEYS.expenses, []));
    setCiudad('Cusco');
    setExpenseName('');
    setExpenseAmount('');
    setExpenseCategory(expenseCategories[0]);
    setFixedName('');
    setFixedAmount('');
    setFixedDueDate(localDate());
    setMealType(mealTypes[0]);
    setMealName('');
    setMealCost('');
    setMealDate(localDate());
    setMealFiber('');
    setMealSodium('');
    setMealAddedSugar('');
    setMealMicronutrients('');
    setMealEnergy('');
    setMealProtein('');
    setMealCarbohydrates('');
    setMealFat('');
    setMealNutritionEstimate(null);
    setMealNutritionError('');
    setEventoNombre('');
    setEventoFecha(localDate());
    setEventMode('horas');
    setHoraIn('09:00');
    setHoraOut('10:00');
    setStatusSelect('amber');
    setNewHabitName('');
    setNewHabitDetail('');
    setEditingHabitId(null);
    setSelectedRecipeVideo(0);
    setSelectedDate(new Date());
    setSelectedWorkoutDay((new Date().getDay() + 6) % 7);
    setShowEventForm(false);
    setExerciseActivity('');
    setExerciseMinutes('');
    setExerciseDate(localDate());
    setWeatherApi(null);
    setWorkoutRecommendationMessage('');
    setNotification('');
    setIsLoggedIn(true);
    setShowCurtain(true);
  };

  useEffect(() => {
    if (!auth || !firebaseConfigured) {
      enterDemoWorkspace();
      setAdminClaimReady(true);
      setAuthReady(true);
      setAuthError('');
      return undefined;
    }
    getRedirectResult(auth).then(async (result) => {
      const username = window.sessionStorage.getItem('synclife-pending-username');
      if (result?.user && username) {
        try {
          await assignUsername(result.user, username);
        } catch (error) {
          await signOut(auth);
          throw error;
        } finally {
          window.sessionStorage.removeItem('synclife-pending-username');
        }
      } else {
        window.sessionStorage.removeItem('synclife-pending-username');
      }
    }).catch((error) => {
      window.sessionStorage.removeItem('synclife-pending-username');
      console.error('No se pudo completar el acceso redirigido de Google:', error);
      if (error.code === 'auth/account-exists-with-different-credential') {
        const credential = GoogleAuthProvider.credentialFromError(error);
        if (credential) setPendingGoogleCredential(credential);
        setAuthMode('login');
        setAuthEmail(error.customData?.email || '');
        setAuthError('Este correo ya tiene una cuenta con contraseña. Ingresa con esa contraseña una vez para vincular Google y después podrás usar ambos métodos con la misma cuenta.');
      } else {
        setAuthError(error.message || 'No se pudo completar el acceso con Google. Comprueba la configuración de Firebase e inténtalo otra vez.');
      }
    });
    return onAuthStateChanged(auth, (user) => {
      if (user) {
        setAuthError('');
        setAdminClaimReady(false);
        enterWorkspace(user);
        accountRequest('/username', { user }).then(({ username }) => {
          const assignedUsername = username || usernameAssignments.current.get(user.uid);
          if (assignedUsername) {
            setProfile((current) => ({ ...current, name: assignedUsername, username: assignedUsername }));
            setUsernameSetupOpen(false);
          } else {
            setProfile((current) => ({ ...current, username: '' }));
            setUsernameSetupOpen(true);
          }
        }).catch((error) => {
          console.error('No se pudo consultar el nombre de usuario de la cuenta:', error);
        });
        const applyAdminClaims = async (forceRefresh) => {
          const tokenResult = await user.getIdTokenResult(forceRefresh);
          if (auth?.currentUser?.uid !== user.uid) return;
          const admin = tokenResult.claims.admin === true;
          setIsAdmin(admin);
          setIsSuperAdmin(tokenResult.claims.superAdmin === true);
          if (admin) setVista('admin');
          setAdminClaimReady(true);
        };
        syncAccountWithBackend(user).then(() => applyAdminClaims(true)).catch((syncError) => {
          console.error('No se pudo sincronizar el usuario con la base de datos de Render:', syncError);
          setNotification(`No se sincronizó la cuenta con PostgreSQL: ${syncError.message}`);
          return applyAdminClaims(true);
        }).catch((error) => {
          console.error('No se pudo comprobar el rol administrativo:', error);
          setIsAdmin(false);
          setIsSuperAdmin(false);
          setAdminClaimReady(true);
          setAuthError('No se pudo comprobar el acceso administrativo. Vuelve a iniciar sesión.');
        });
      } else {
        setIsLoggedIn(false);
        setIsAdmin(false);
        setIsSuperAdmin(false);
        setAdminClaimReady(true);
        setAdminEntryRequested(false);
        setShowCurtain(false);
        setUsernameSetupOpen(false);
        setUsernameSetupValue('');
        setUsernameSetupPassword('');
        setUsernameSetupPasswordConfirmation('');
        setUsernameSetupError('');
        setNotificationsOpen(false);
        setTourStep(-1);
      }
      setAuthReady(true);
    }, (error) => {
      console.error('No se pudo comprobar la sesión de Firebase:', error);
      setAuthError('No se pudo comprobar la sesión de Google. Vuelve a intentarlo.');
      setAuthReady(true);
    });
  }, []);

  useEffect(() => {
    if (isAdmin && vista !== 'admin') setVista('admin');
    if (!isAdmin && vista === 'admin') setVista('inicio');
  }, [isAdmin, vista]);

  useEffect(() => {
    if (!adminEntryRequested || !isLoggedIn || !adminClaimReady) return;
    if (isAdmin) {
      setNotification('');
      setVista('admin');
    } else {
      setNotification('No tienes permisos de administrador');
    }
    setAdminEntryRequested(false);
  }, [adminClaimReady, adminEntryRequested, isAdmin, isLoggedIn]);

  const refreshAdminClaim = async () => {
    if (!auth?.currentUser) return;
    setAdminClaimReady(false);
    try {
      const tokenResult = await auth.currentUser.getIdTokenResult(true);
      const admin = tokenResult.claims.admin === true;
      setIsAdmin(admin);
      setIsSuperAdmin(tokenResult.claims.superAdmin === true);
      if (admin) setVista('admin');
      setAdminClaimReady(true);
      setAuthError('');
    } catch (error) {
      console.error('No se pudo actualizar el rol administrativo:', error);
      setAuthError('No se pudo comprobar tu rol. Vuelve a iniciar sesión.');
      setIsAdmin(false);
      setIsSuperAdmin(false);
      setAdminClaimReady(true);
    }
  };

  const assignUsername = async (user, username) => {
    const result = await saveAccountUsername(user, username);
    await updateProfile(user, { displayName: result.username });
    usernameAssignments.current.set(user.uid, result.username);
    setProfile((current) => ({ ...current, name: result.username, username: result.username }));
    setUsernameSetupOpen(false);
    return result.username;
  };

  const hasPasswordProvider = auth?.currentUser?.providerData.some((provider) => provider.providerId === 'password');

  const submitUsernameSetup = async (event) => {
    event.preventDefault();
    const user = auth?.currentUser;
    if (!user || !/^[a-zA-Z0-9._-]{3,24}$/.test(usernameSetupValue.trim())) {
      setUsernameSetupError('Elige un nombre de usuario de 3 a 24 caracteres: letras, números, punto, guion o guion bajo.');
      return;
    }
    if (!hasPasswordProvider && usernameSetupPassword.length < 6) {
      setUsernameSetupError('Crea una contraseña de al menos 6 caracteres para poder iniciar con tu nombre de usuario.');
      return;
    }
    if (!hasPasswordProvider && usernameSetupPassword !== usernameSetupPasswordConfirmation) {
      setUsernameSetupError('Las contraseñas no coinciden.');
      return;
    }

    setUsernameSetupLoading(true);
    setUsernameSetupError('');
    try {
      if (!hasPasswordProvider) {
        if (!user.email) throw new Error('Tu cuenta no tiene un correo asociado para agregar una contraseña.');
        await linkWithCredential(user, EmailAuthProvider.credential(user.email, usernameSetupPassword));
      }
      const username = await assignUsername(user, usernameSetupValue.trim());
      setUsernameSetupOpen(false);
      setUsernameSetupPassword('');
      setUsernameSetupPasswordConfirmation('');
      setNotification(`Tu nombre de usuario es ${username}. Ya puedes usarlo para iniciar sesión.`);
    } catch (error) {
      console.error('No se pudo guardar el nombre de usuario de la cuenta:', error);
      setUsernameSetupError(error.code === 'auth/email-already-in-use' || error.code === 'auth/credential-already-in-use'
        ? 'Este correo ya tiene otra cuenta con contraseña. Inicia sesión con ese correo o usa Google como hasta ahora.'
        : error.code === 'auth/operation-not-allowed'
          ? 'Activa Correo electrónico/Contraseña en Firebase Authentication para poder añadir este método.'
          : error.message || 'No se pudo guardar el nombre de usuario. Inténtalo otra vez.');
    } finally {
      setUsernameSetupLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    if (!auth) {
      setAuthError('Configura Firebase en frontend/.env.local para habilitar el acceso con Google.');
      return;
    }
    if (authMode === 'register' && !/^[a-zA-Z0-9._-]{3,24}$/.test(authUsername.trim())) {
      setAuthError('Elige un nombre de usuario de 3 a 24 caracteres: letras, números, punto, guion o guion bajo.');
      return;
    }
    if (authMode === 'register' && !acceptedTerms) {
      setAuthError('Para crear tu cuenta, confirma que leíste los términos y la política de privacidad.');
      return;
    }
    setAuthLoading(true);
    setAuthError('');
    try {
      await setPersistence(auth, rememberSession ? browserLocalPersistence : browserSessionPersistence);
      const provider = new GoogleAuthProvider();
      if (window.matchMedia('(max-width: 760px)').matches) {
        if (authMode === 'register') {
          window.sessionStorage.setItem('synclife-pending-username', authUsername.trim());
        }
        await signInWithRedirect(auth, provider);
      } else {
        const credential = await signInWithPopup(auth, provider);
        if (authMode === 'register') {
          try {
            await assignUsername(credential.user, authUsername.trim());
          } catch (error) {
            await signOut(auth);
            throw error;
          }
        }
      }
    } catch (error) {
      console.error('No se pudo iniciar sesión con Google:', error);
      if (handleGoogleAccountConflict(error)) return;
      setAuthError(error.code === 'auth/popup-closed-by-user'
        ? 'Se cerró la ventana de Google antes de completar el acceso.'
        : error.code === 'auth/unauthorized-domain'
          ? 'Este dominio no está autorizado en Firebase Authentication.'
          : error.code === 'auth/popup-blocked'
            ? 'El navegador bloqueó la ventana de Google. Permite las ventanas emergentes e inténtalo otra vez.'
            : error.message || 'No se pudo iniciar sesión con Google. Comprueba la configuración de Firebase e inténtalo otra vez.');
    } finally {
      setAuthLoading(false);
    }
  };

  const openAdminEntry = () => {
    if (isAdmin) {
      setNotification('');
      setVista('admin');
    } else if (isLoggedIn) {
      setNotification('No tienes permisos de administrador');
    } else {
      setAdminEntryRequested(true);
      setAuthMode('login');
      setAuthEmail('admin@gmail.com');
      setAuthError('');
      setAuthNotice('Inicia sesión con admin@gmail.com o con otra cuenta que ya tenga el rol de administrador.');
    }
  };

  const submitEmailAuth = async (event) => {
    event.preventDefault();
    if (!auth) {
      setAuthError('La autenticación no está disponible. Comprueba la configuración de Firebase.');
      return;
    }
    if (authMode === 'register' && !/^[a-zA-Z0-9._-]{3,24}$/.test(authUsername.trim())) {
      setAuthError('Elige un nombre de usuario de 3 a 24 caracteres: letras, números, punto, guion o guion bajo.');
      return;
    }
    if (authMode === 'register' && authPassword !== authPasswordConfirmation) {
      setAuthError('Las contraseñas no coinciden.');
      return;
    }
    if (authMode === 'register' && !acceptedTerms) {
      setAuthError('Para crear tu cuenta, confirma que leíste los términos y la política de privacidad.');
      return;
    }
    setAuthLoading(true);
    setAuthError('');
    setAuthNotice('');
    try {
      await setPersistence(auth, rememberSession ? browserLocalPersistence : browserSessionPersistence);
      if (authMode === 'register') {
        const credential = await createUserWithEmailAndPassword(auth, authEmail.trim(), authPassword);
        try {
          await assignUsername(credential.user, authUsername.trim());
        } catch (error) {
          await deleteUser(credential.user);
          throw error;
        }
        enterWorkspace(credential.user);
      } else {
        const identifier = authEmail.trim();
        const credential = identifier.includes('@')
          ? await signInWithEmailAndPassword(auth, identifier, authPassword)
          : await (async () => {
            const result = await accountRequest('/username/login', {
              method: 'POST',
              body: JSON.stringify({ username: identifier, password: authPassword }),
            });
            return signInWithCustomToken(auth, result.token);
          })();
        if (pendingGoogleCredential) {
          await linkWithCredential(credential.user, pendingGoogleCredential);
          setPendingGoogleCredential(null);
          setAuthNotice('Google ya está vinculado. Desde ahora puedes entrar con Google o con tu contraseña.');
        }
      }
    } catch (error) {
      console.error(`No se pudo ${authMode === 'register' ? 'crear la cuenta' : 'iniciar sesión'} con correo:`, error);
      setAuthError(error.code === 'auth/email-already-in-use'
        ? 'Ya existe una cuenta con este correo. Inicia sesión o recupera tu contraseña.'
        : error.code === 'auth/invalid-email'
          ? 'Escribe un correo electrónico válido.'
          : error.code === 'auth/weak-password'
            ? 'La contraseña debe tener al menos 6 caracteres.'
            : error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password'
              ? 'El correo o la contraseña no son correctos.'
              : error.code === 'auth/operation-not-allowed'
                ? 'Activa el proveedor Correo electrónico/Contraseña en Firebase Authentication.'
                : error.code === 'auth/too-many-requests'
                  ? 'Hubo demasiados intentos. Espera un momento y vuelve a probar.'
                  : error.message || 'No se pudo completar el acceso. Comprueba tu conexión e inténtalo otra vez.');
    } finally {
      setAuthLoading(false);
    }
  };

  const resetEmailPassword = async () => {
    if (!auth) {
      setAuthError('La autenticación no está disponible. Comprueba la configuración de Firebase.');
      return;
    }
    if (!authEmail.trim() || !authEmail.includes('@')) {
      setAuthError('Escribe tu correo para enviarte el enlace de recuperación.');
      return;
    }
    setAuthLoading(true);
    setAuthError('');
    setAuthNotice('');
    try {
      await sendPasswordResetEmail(auth, authEmail.trim());
      setAuthNotice('Si hay una cuenta asociada a ese correo, recibirás un enlace para restablecer la contraseña.');
    } catch (error) {
      console.error('No se pudo enviar el correo para restablecer la contraseña:', error);
      setAuthError(error.code === 'auth/invalid-email'
        ? 'Escribe un correo electrónico válido.'
        : error.code === 'auth/too-many-requests'
          ? 'Hubo demasiados intentos. Espera un momento y vuelve a probar.'
          : 'No se pudo enviar el enlace. Comprueba el correo e inténtalo otra vez.');
    } finally {
      setAuthLoading(false);
    }
  };

  const changeAuthMode = (mode) => {
    setAuthMode(mode);
    setAuthError('');
    setAuthNotice('');
    setAuthPassword('');
    setAuthPasswordConfirmation('');
    setAcceptedTerms(false);
    if (mode !== 'login') setPendingGoogleCredential(null);
  };

  const switchUser = () => {
    setLogoutError('');
    setShowLogoutDialog(true);
  };

  const confirmLogout = async () => {
    setAuthLoading(true);
    setLogoutError('');
    try {
      if (auth?.currentUser) await signOut(auth);
      setIsAdmin(false);
      setIsLoggedIn(false);
      setAdminEntryRequested(false);
      setShowLogoutDialog(false);
      setVista('inicio');
      setTourStep(-1);
      setNotificationsOpen(false);
      setShowCurtain(false);
      setAuthMode('login');
      setAuthPassword('');
      setAuthPasswordConfirmation('');
    } catch (error) {
      console.error('No se pudo cerrar la sesión:', error);
      setLogoutError('No se pudo cerrar la sesión. Inténtalo otra vez.');
    } finally {
      setAuthLoading(false);
    }
  };

  const toggleHabit = (id) => {
    setHabits((current) => current.map((habit) => (
      habit.id === id ? { ...habit, complete: !habit.complete } : habit
    )));
  };

  const saveHabit = (event) => {
    event.preventDefault();
    const name = newHabitName.trim();
    const detail = newHabitDetail.trim();
    if (!name) return;
    if (editingHabitId) {
      setHabits((current) => current.map((habit) => (
        habit.id === editingHabitId ? { ...habit, name, detail } : habit
      )));
      setEditingHabitId(null);
    } else {
      setHabits((current) => [...current, {
        id: `habit-${Date.now()}`,
        name,
        detail,
        complete: false,
      }]);
    }
    setNewHabitName('');
    setNewHabitDetail('');
  };

  const editHabit = (habit) => {
    setEditingHabitId(habit.id);
    setNewHabitName(habit.name);
    setNewHabitDetail(habit.detail);
    window.setTimeout(() => document.getElementById('habit-name')?.focus(), 0);
  };

  const cancelHabitEdit = () => {
    setEditingHabitId(null);
    setNewHabitName('');
    setNewHabitDetail('');
  };

  const addDailyExpense = (event) => {
    event.preventDefault();
    const amount = Number(expenseAmount);
    if (!expenseName.trim() || !Number.isFinite(amount) || amount <= 0) {
      setNotification('Escribe el concepto y un monto válido para registrar el gasto.');
      return;
    }
    const expense = {
      id: `${Date.now()}`,
      name: expenseName.trim(),
      category: expenseCategory,
      amount,
      date: localDate(),
    };
    setExpenses((current) => [expense, ...current]);
    setExpenseName('');
    setExpenseAmount('');
    setNotification(`Gasto registrado: ${expense.name} · ${currency(expense.amount)} (${expense.category}).`);
  };

  const addFixedCost = (event) => {
    event.preventDefault();
    const amount = Number(fixedAmount);
    if (!fixedName.trim() || !Number.isFinite(amount) || amount <= 0 || !fixedDueDate) return;
    setFixedCosts((current) => [...current, {
      id: `${Date.now()}`,
      name: fixedName.trim(),
      amount,
      dueDay: Number(fixedDueDate.split('-')[2]),
      dueDate: fixedDueDate,
    }].sort((first, second) => first.dueDate.localeCompare(second.dueDate)));
    setFixedName('');
    setFixedAmount('');
    setNotification(`Agregué ${fixedName.trim()} al calendario para el ${dateLabel(new Date(`${fixedDueDate}T12:00:00`), { day: 'numeric', month: 'long' })}.`);
  };

  const clearMealNutritionEstimate = () => {
    setMealNutritionEstimate(null);
    setMealNutritionMatches([]);
    setSelectedNutritionMatchIndex(-1);
    setMealNutritionError('');
    setMealEnergy('');
    setMealProtein('');
    setMealCarbohydrates('');
    setMealFat('');
    setMealFiber('');
    setMealSodium('');
    setMealAddedSugar('');
    setMealMicronutrients('');
  };

  const selectNutritionMatch = (product, index) => {
    const portionGrams = getPortionWeightInGrams(mealPortion);
    const factor = portionGrams ? portionGrams / 100 : 1;
    const nutrition = product.per100g;
    const micronutrients = nutrition.micronutrients
      .map((item) => `${item.name.toLocaleLowerCase('es')} ${scaleNutritionValue(item.value, factor, 2)} ${item.unit}`)
      .join(', ');
    setSelectedNutritionMatchIndex(index);
    setMealEnergy(scaleNutritionValue(nutrition.energyKcal, factor, 0));
    setMealProtein(scaleNutritionValue(nutrition.proteinG, factor));
    setMealCarbohydrates(scaleNutritionValue(nutrition.carbohydratesG, factor));
    setMealFat(scaleNutritionValue(nutrition.fatG, factor));
    setMealFiber(scaleNutritionValue(nutrition.fiberG, factor));
    setMealSodium(scaleNutritionValue(nutrition.sodiumMg, factor, 0));
    setMealAddedSugar(scaleNutritionValue(nutrition.addedSugarG, factor));
    setMealMicronutrients(micronutrients);
    setMealNutritionEstimate({
      source: product.source || 'USDA FoodData Central',
      retrievedAt: product.retrievedAt || null,
      productName: product.name,
      brand: product.brand,
      searchMatch: product.searchMatch || 'partial',
      basis: portionGrams
        ? `Valores por 100 g ajustados a ${portionGrams} g.`
        : 'Valores de la API por 100 g; indica el peso en gramos para calcular tu porción.',
    });
  };

  const searchMealNutrition = async () => {
    if (!mealName.trim()) {
      setMealNutritionError('Escribe el nombre del alimento antes de buscar sus nutrientes.');
      return;
    }

    setIsSearchingMealNutrition(true);
    setMealNutritionError('');
    setMealNutritionEstimate(null);
    setMealNutritionMatches([]);
    setSelectedNutritionMatchIndex(-1);
    try {
      const response = await fetch(apiUrl('/api/synclife/nutrition/search'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ food: mealName.trim() }),
      });
      const responseText = await response.text();
      let result;
      try {
        result = JSON.parse(responseText);
      } catch {
        throw new Error('El backend no devolvió una respuesta válida. Comprueba la conexión e inténtalo otra vez.');
      }
      if (!response.ok) throw new Error(result.error || 'No se pudieron consultar los nutrientes.');

      const matches = result.matches.map((product, index) => ({
        ...product,
        key: `${product.code || product.name}-${index}`,
        retrievedAt: result.retrievedAt,
      }));
      setMealNutritionMatches(matches);
      if (!matches.length) throw new Error('No encontramos una coincidencia nutricional suficiente. Prueba con los ingredientes principales o ingresa los nutrientes manualmente.');
      selectNutritionMatch(matches[0], 0);
    } catch (error) {
      console.error('No se pudieron consultar los nutrientes de FoodData Central:', error);
      setMealNutritionError(error.message || 'No se pudo conectar con la API nutricional.');
    } finally {
      setIsSearchingMealNutrition(false);
    }
  };

  const addMealPlan = (event) => {
    event.preventDefault();
    const cost = Number(mealCost);
    if (!mealName.trim() || !Number.isFinite(cost) || cost < 0 || !mealDate) return;
    const optionalAmount = (value) => value === '' ? null : Number(value);
    const energy = optionalAmount(mealEnergy);
    const protein = optionalAmount(mealProtein);
    const carbohydrates = optionalAmount(mealCarbohydrates);
    const fat = optionalAmount(mealFat);
    const fiber = optionalAmount(mealFiber);
    const sodium = optionalAmount(mealSodium);
    const addedSugar = optionalAmount(mealAddedSugar);
    if ([energy, protein, carbohydrates, fat, fiber, sodium, addedSugar]
      .some((value) => value !== null && (!Number.isFinite(value) || value < 0))) return;
    const mealRecordId = `${Date.now()}`;
    setMealPlans((current) => [...current, {
      id: mealRecordId,
      type: mealType,
      name: mealName.trim(),
      cost,
      date: mealDate,
      nutrition: {
        energyKcal: energy,
        proteinG: protein,
        carbohydratesG: carbohydrates,
        fatG: fat,
        fiberG: fiber,
        sodiumMg: sodium,
        addedSugarG: addedSugar,
        micronutrients: mealMicronutrients.trim(),
        portion: mealPortion.trim(),
        source: mealNutritionEstimate?.source || 'Registro manual',
        productName: mealNutritionEstimate?.productName || '',
        brand: mealNutritionEstimate?.brand || '',
        estimatedAt: mealNutritionEstimate?.retrievedAt || null,
        basis: mealNutritionEstimate?.basis || '',
      },
    }].sort((first, second) => first.date.localeCompare(second.date)));
    setNotification(`${mealTypeLabels[mealType] || mealType} añadido a tu plan para el ${dateLabel(new Date(`${mealDate}T12:00:00`), { day: 'numeric', month: 'long' })}.`);
    trackAdminActivity('meal', mealRecordId).catch((error) => {
      console.error('No se pudo actualizar el conteo agregado de comidas:', error);
      setNotification('La comida se guardó en este navegador, pero no se pudo actualizar el conteo administrativo.');
    });
    setMealName('');
    setMealCost('');
    setMealEnergy('');
    setMealProtein('');
    setMealCarbohydrates('');
    setMealFat('');
    setMealFiber('');
    setMealSodium('');
    setMealAddedSugar('');
    setMealMicronutrients('');
    setMealPortion('');
    setMealNutritionEstimate(null);
    setMealNutritionMatches([]);
    setSelectedNutritionMatchIndex(-1);
    setMealNutritionError('');
  };

  const createLocalWorkouts = () => {
    const age = Number(bodyProfile.age);
    const weight = Number(bodyProfile.weight);
    const height = Number(bodyProfile.height) / 100;
    const bmi = weight / (height * height);
    const lowImpact = age >= 60 || bmi >= 30 || bmi < 18.5;
    const home = weekdays.map((day, index) => ({
      day,
      activities: index === 6 ? ['Descanso y recuperación'] : [
        homeWorkoutMoves[index % homeWorkoutMoves.length],
        homeWorkoutMoves[(index + 1) % homeWorkoutMoves.length],
        'Caminata suave y estiramientos',
      ],
      duration: index === 6 ? 0 : lowImpact ? 20 : 30,
    }));
    const gym = weekdays.map((day, index) => ({
      day,
      activities: index === 6 ? ['Descanso y recuperación'] : [
        gymWorkoutMoves[index % gymWorkoutMoves.length],
        gymWorkoutMoves[(index + 1) % gymWorkoutMoves.length],
        'Movilidad y vuelta a la calma',
      ],
      duration: index === 6 ? 0 : lowImpact ? 20 : 30,
    }));
    setGeneratedWorkouts(normalizeGeneratedWorkouts({
      casa: home,
      gimnasio: gym,
      intensity: lowImpact ? 'Bajo impacto y progresión gradual' : 'Intensidad moderada y progresiva',
      bmiContext: bmi >= 30 || bmi < 18.5,
    }));
    trackAdminActivity('routine', `routine-${Date.now()}`).catch((error) => {
      console.error('No se pudo actualizar el conteo agregado de rutinas:', error);
      setNotification('La rutina se creó, pero no se pudo actualizar el conteo administrativo.');
    });
  };

  const generatePersonalizedWorkouts = async () => {
    const age = Number(bodyProfile.age);
    const weight = Number(bodyProfile.weight);
    const height = Number(bodyProfile.height);
    if (!Number.isInteger(age) || age < 13 || age > 120 || !Number.isFinite(weight) || weight < 1 || weight > 500
      || !Number.isFinite(height) || height < 30 || height > 280 || !bodyProfile.sex) {
      setWorkoutRecommendationMessage('Completa peso (1–500 kg), talla (30–280 cm), género y edad (13–120) en “Tu punto de partida”.');
      return;
    }
    setIsGeneratingWorkout(true);
    setWorkoutRecommendationMessage('');
    try {
      const response = await fetch(apiUrl('/api/synclife/ai/workout-plan'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: bodyProfile, preference: workoutPreference }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'La IA no pudo crear la rutina.');
      const normalizedWorkouts = normalizeGeneratedWorkouts(result);
      if (!normalizedWorkouts) throw new Error('La rutina recibida no tiene un formato válido. Se mostrará una rutina de ejemplo.');
      setGeneratedWorkouts(normalizedWorkouts);
      setWorkoutRecommendationMessage(`Rutina semanal personalizada generada con ${result.provider || 'IA'} para casa y gimnasio.`);
      trackAdminActivity('routine', `routine-${Date.now()}`).catch((trackingError) => {
        console.error('No se pudo actualizar el conteo agregado de rutinas:', trackingError);
        setNotification('La rutina se creó, pero no se pudo actualizar el conteo administrativo.');
      });
    } catch (error) {
      console.error('No se pudo generar la rutina con IA:', error);
      createLocalWorkouts();
      setWorkoutRecommendationMessage(`${error.message} Se creó una rutina local de ejemplo. Revisa la configuración del proveedor de IA para volver a intentar.`);
    } finally {
      setIsGeneratingWorkout(false);
    }
  };

  const workoutForDate = (date) => {
    const day = (date.getDay() + 6) % 7 + 1;
    return initialWorkouts.find((workout) => workout.day === day);
  };

  const saveCalendarEvent = async (event) => {
    event.preventDefault();
    if (!eventoNombre.trim() || !eventoFecha) return;
    const nextEvent = {
      id: `${Date.now()}`,
      name: eventoNombre.trim(),
      date: eventoFecha,
      status: statusSelect,
      allDay: eventMode === 'allday',
      start: horaIn,
      end: horaOut,
    };
    setEvents((current) => [...current.filter((item) => item.date !== eventoFecha || item.name !== nextEvent.name), nextEvent]);
    setSelectedDate(new Date(`${eventoFecha}T12:00:00`));
    setShowEventForm(false);
    setEventoNombre('');
    let reminderMessage = `${profile.name}, guardé "${nextEvent.name}" en tu calendario de este dispositivo.`;
    const reminderTime = new Date(`${nextEvent.date}T${nextEvent.start}:00`);
    const isReminderUpcoming = !nextEvent.allDay && reminderTime > new Date();
    if (isReminderUpcoming && 'Notification' in window && Notification.permission === 'default') {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') reminderMessage += ' Activa las notificaciones del navegador para recibir el aviso.';
      } catch (error) {
        console.error('No se pudo solicitar permiso para las notificaciones:', error);
        reminderMessage += ' El recordatorio funcionará mientras la página esté abierta.';
      }
    } else if (isReminderUpcoming && (!('Notification' in window) || Notification.permission !== 'granted')) {
      reminderMessage += ' El recordatorio en pantalla funcionará mientras la página esté abierta.';
    }
    setNotification(reminderMessage);
  };

  const saveExerciseSession = (event) => {
    event.preventDefault();
    const minutes = Number(exerciseMinutes);
    if (!exerciseActivity.trim() || !exerciseDate || !Number.isInteger(minutes) || minutes < 1 || minutes > 600) return;
    const sessionId = `${Date.now()}`;
    setExerciseSessions((current) => [
      { id: sessionId, activity: exerciseActivity.trim(), minutes, date: exerciseDate },
      ...current,
    ]);
    setNotification('Actividad física guardada en tu historial.');
    trackAdminActivity('exercise', sessionId).catch((error) => {
      console.error('No se pudo actualizar el conteo agregado de actividad física:', error);
      setNotification('La actividad se guardó en este dispositivo, pero no se pudo actualizar el conteo administrativo.');
    });
    setExerciseActivity('');
    setExerciseMinutes('');
    setExerciseDate(localDate());
  };

  const descargarPDF = async () => {
    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 17;
      let y = 18;
      const logoResponse = await fetch('/synclife-logo.png');
      if (!logoResponse.ok) throw new Error('No se pudo cargar el logo para el informe.');
      const logoBlob = await logoResponse.blob();
      const logoData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('No se pudo leer el logo para el informe.'));
        reader.readAsDataURL(logoBlob);
      });
      const ensureSpace = (height = 8) => {
        if (y + height > pageHeight - 18) {
          pdf.addPage();
          y = 18;
        }
      };
      const addParagraph = (text, size = 10, color = [59, 47, 42]) => {
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(size);
        pdf.setTextColor(...color);
        const lines = pdf.splitTextToSize(String(text), pageWidth - margin * 2);
        ensureSpace(lines.length * 5 + 2);
        pdf.text(lines, margin, y);
        y += lines.length * 5 + 2;
      };
      const addSection = (title) => {
        ensureSpace(14);
        y += 3;
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(12);
        pdf.setTextColor(50, 81, 62);
        pdf.text(title, margin, y);
        y += 5;
        pdf.setDrawColor(214, 224, 215);
        pdf.line(margin, y, pageWidth - margin, y);
        y += 6;
      };

      // El reporte se compone con texto y tablas para mantener legibilidad e imprimir varias páginas.
      pdf.setFillColor(39, 83, 62);
      pdf.rect(0, 0, pageWidth, 43, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(20);
      pdf.setTextColor(255, 255, 255);
      pdf.addImage(logoData, 'PNG', pageWidth - margin - 32, 6, 32, 32);
      pdf.text('SyncLife OS', margin, 20);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      pdf.text('INFORME PERSONAL DE BIENESTAR Y FINANZAS', margin, 28);
      pdf.setTextColor(225, 238, 227);
      pdf.text(`Generado el ${dateLabel(new Date(), { day: 'numeric', month: 'long', year: 'numeric' })}`, margin, 36);
      y = 54;

      addSection('Resumen ejecutivo');
      addParagraph(`Perfil: ${profile.name}  |  Fecha: ${dateLabel(new Date(`${localDate()}T12:00:00`), { day: 'numeric', month: 'long', year: 'numeric' })}`);
      addParagraph(`Presupuesto mensual: ${currency(ingreso)}  |  Disponible estimado: ${currency(availableBudget)}`);
      addParagraph(`Compras y otros gastos del mes: ${currency(monthlyExpenses)}  |  Compras registradas hoy: ${currency(dailyExpenseTotal)}`);
      addParagraph(`Actividad física de hoy: ${todaysExerciseMinutes} minutos en ${todaysExerciseSessions.length} sesión(es).`);
      addParagraph(`Comidas planificadas para hoy: ${mealsToday.length}.`);

      addSection('Gastos registrados');
      if (expenses.length) {
        expenses.slice(0, 30).forEach((item) => {
          addParagraph(`${item.date}  |  ${item.category}  |  ${item.name}  |  ${currency(item.amount)}`, 9);
        });
      } else {
        addParagraph('No hay gastos diarios categorizados guardados.');
      }

      addSection('Actividad física');
      if (exerciseSessions.length) {
        exerciseSessions.slice(0, 30).forEach((item) => addParagraph(`${item.date}  |  ${item.activity}  |  ${item.minutes} min`, 9));
      } else {
        addParagraph('Aún no hay actividades físicas guardadas.');
      }

      addSection('Plan de comidas');
      if (mealPlans.length) {
        mealPlans.slice(0, 30).forEach((item) => addParagraph(`${item.date}  |  ${mealTypeLabels[item.type] || item.type}  |  ${item.name}  |  ${currency(item.cost)}`, 9));
      } else {
        addParagraph('Aún no hay comidas planificadas.');
      }

      addSection('Hábitos');
      if (habits.length) {
        habits.forEach((habit) => addParagraph(`${habit.complete ? '[COMPLETADO]' : '[PENDIENTE]'}  ${habit.name} — ${habit.detail}`, 9));
      } else {
        addParagraph('Aún no hay hábitos guardados.');
      }

      const pageCount = pdf.getNumberOfPages();
      for (let page = 1; page <= pageCount; page += 1) {
        pdf.setPage(page);
        pdf.setDrawColor(223, 228, 220);
        pdf.line(margin, pageHeight - 13, pageWidth - margin, pageHeight - 13);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(110, 120, 110);
        pdf.text('Documento personal · Datos guardados en este dispositivo', margin, pageHeight - 8);
        pdf.text(`${page} / ${pageCount}`, pageWidth - margin, pageHeight - 8, { align: 'right' });
      }
      pdf.save(`Reporte_SyncLife_${localDate()}.pdf`);
    } catch (error) {
      console.error('No se pudo generar el reporte PDF:', error);
      setNotification('No se pudo generar el PDF. Inténtalo de nuevo.');
    }
  };

  const calendarDays = useMemo(() => {
    const year = selectedDate.getFullYear();
    const month = selectedDate.getMonth();
    const offset = (new Date(year, month, 1).getDay() + 6) % 7;
    const count = new Date(year, month + 1, 0).getDate();
    return [...Array(offset).fill(null), ...Array.from({ length: count }, (_, index) => index + 1)];
  }, [selectedDate]);

  const changeMonth = (offset) => {
    setSelectedDate((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  const openCalendarEventForm = () => {
    setEventoFecha(localDate(selectedDate));
    setShowEventForm(true);
    setVista('calendario');
  };

  const currentEvents = events.filter((event) => event.date === localDate(selectedDate));
  const currentFixedCosts = fixedCosts.filter((item) => (
    Math.min(fixedCostDay(item), new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0).getDate()) === selectedDate.getDate()
  ));
  const currentMeals = mealPlans.filter((item) => item.date === localDate(selectedDate));
  const currentExerciseSessions = exerciseSessions.filter((session) => session.date === localDate(selectedDate));
  const currentWorkout = workoutForDate(selectedDate);
  const activeWeeklyWorkouts = generatedWorkouts?.[workoutPreference];
  const selectedDayItems = [
    ...currentEvents.map((item) => ({
      id: `event-${item.id}`,
      time: item.allDay ? 'Todo el día' : item.start || '09:00',
      title: item.name,
      detail: item.allDay ? 'Evento' : `Evento · hasta ${item.end || '—'}`,
      kind: 'event',
    })),
    ...currentFixedCosts.map((item) => ({
      id: `cost-${item.id}`,
      time: '09:00',
      title: `Vence: ${item.name}`,
      detail: `Pago fijo · ${currency(item.amount)}`,
      kind: 'cost',
    })),
    ...currentMeals.map((item) => ({
      id: `meal-${item.id}`,
      time: ({ Desayuno: '08:00', Break: '11:00', Almuerzo: '13:00', Cena: '19:00' })[item.type] || '12:00',
      title: item.name,
      detail: `${item.type} · ${currency(item.cost)}`,
      kind: 'meal',
    })),
    ...currentExerciseSessions.map((session) => ({
      id: `exercise-${session.id}`,
      time: '07:00',
      title: session.activity,
      detail: `Actividad realizada · ${session.minutes} min`,
      kind: 'workout',
    })),
    ...(currentWorkout?.duration > 0 ? [{
      id: `workout-${currentWorkout.day}`,
      time: '07:00',
      title: currentWorkout.name,
      detail: `Rutina sugerida · ${currentWorkout.duration} min · ${workoutPreference}`,
      kind: 'workout',
    }] : []),
  ].sort((first, second) => first.time.localeCompare(second.time));
  const hasCalendarItems = (date) => events.some((item) => item.date === localDate(date))
    || fixedCosts.some((item) => Math.min(fixedCostDay(item), new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()) === date.getDate())
    || mealPlans.some((item) => item.date === localDate(date))
    || exerciseSessions.some((session) => session.date === localDate(date))
    || workoutForDate(date)?.duration > 0;
  const monthLabel = dateLabel(selectedDate, { month: 'long', year: 'numeric' });
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);
  const weeklyMealPlans = mealPlans.filter((item) => item.date >= localDate(weekStart) && item.date < localDate(weekEnd));
  const weeklyMealCost = weeklyMealPlans.reduce((total, item) => total + (Number(item.cost) || 0), 0);
  const weeklyFoodLimit = (Number(foodBudget) || 0) / 4.33;
  const mealsToday = mealPlans.filter((item) => item.date === localDate(today));
  const dailyMealCategorySummary = mealTypes.map((type) => ({
    type,
    meals: mealsToday.filter((item) => item.type === type).map((item) => {
      const nutrientFields = [
        { key: 'energyKcal', label: 'Energía', unit: 'kcal' },
        { key: 'proteinG', label: 'Proteínas', unit: 'g' },
        { key: 'carbohydratesG', label: 'Carbohidratos', unit: 'g' },
        { key: 'fatG', label: 'Grasas', unit: 'g' },
        { key: 'fiberG', label: 'Fibra', unit: 'g' },
        { key: 'sodiumMg', label: 'Sodio', unit: 'mg' },
        { key: 'addedSugarG', label: 'Azúcares añadidos', unit: 'g' },
      ];
      const recordedNutrients = nutrientFields.flatMap(({ key, label, unit }) => {
        const value = item.nutrition?.[key];
        if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) || Number(value) < 0) return [];
        return [{ label, value: `${new Intl.NumberFormat('es-PE', { maximumFractionDigits: 1 }).format(Number(value))} ${unit}` }];
      });
      return {
        id: item.id,
        name: item.name,
        portion: item.nutrition?.portion || '',
        source: item.nutrition?.source || '',
        basis: item.nutrition?.basis || '',
        recommendation: typeof item.nutrition?.recommendation === 'string' ? item.nutrition.recommendation.trim() : '',
        recordedNutrients,
        micronutrients: typeof item.nutrition?.micronutrients === 'string' ? item.nutrition.micronutrients.trim() : '',
      };
    }),
  }));

  const navItems = [
    { id: 'inicio', label: 'Inicio', icon: LayoutDashboard },
    { id: 'calendario', label: 'Calendario', icon: CalendarDays },
    { id: 'bienestar', label: 'Bienestar', icon: Dumbbell },
    { id: 'finanzas', label: 'Finanzas', icon: Wallet },
    { id: 'analisis', label: 'Análisis', icon: BarChart3 },
  ];
  const tourSteps = [
    { title: `¡Hola, ${profile.name || 'Nicol'}!`, text: 'Este es tu espacio personal. Puedes entrar con Google o con correo y contraseña; tus datos personales de uso se guardan en este navegador.' },
    { title: 'Tu panel de un vistazo', text: 'Desde el inicio puedes entrar al calendario, bienestar y finanzas; también verás un resumen del día.' },
    { title: 'Actividad física', text: 'Encuentra tus rutinas y guarda cada sesión de ejercicio en Bienestar.' },
    { title: 'Eventos y recordatorios', text: 'Añade eventos desde Calendario. Si permites las notificaciones, recibirás un aviso mientras la página esté abierta.' },
    { title: 'Analiza tu evolución', text: 'Consulta tus actividades, comidas, hábitos y gastos en Análisis.' },
  ];
  const backdropIcons = {
    inicio: LayoutDashboard,
    calendario: CalendarDays,
    admin: ShieldCheck,
    'actividad-fisica': Activity,
    alimentacion: Salad,
    finanzas: Wallet,
    analisis: BarChart3,
  };
  const ScreenBackdropIcon = backdropIcons[vista] || LayoutDashboard;

  const handleGoogleAccountConflict = (error) => {
    if (error.code !== 'auth/account-exists-with-different-credential') return false;
    const credential = GoogleAuthProvider.credentialFromError(error);
    if (credential) setPendingGoogleCredential(credential);
    setAuthMode('login');
    setAuthEmail(error.customData?.email || authEmail);
    setAuthPassword('');
    setAuthError('Este correo ya tiene una cuenta con contraseña. Ingresa con esa contraseña una vez para vincular Google y después podrás usar ambos métodos con la misma cuenta.');
    return true;
  };

  if (!isLoggedIn) {
    return (
      <main className="login-screen login-split-screen">
        <div className="login-backdrop-orb login-orb-one" />
        <div className="login-backdrop-orb login-orb-two" />
        <div className="login-icon login-icon-calendar"><CalendarDays /></div>
        <div className="login-icon login-icon-activity"><Activity /></div>
        <div className="login-icon login-icon-food"><Salad /></div>
        <div className="login-icon login-icon-finance"><Wallet /></div>
        <button className="login-admin-entry" type="button" onClick={openAdminEntry}>
          <ShieldCheck size={16} /> Admin
        </button>
        <div className="login-layout">
        <aside className="login-art-panel" aria-label="Bienestar en equilibrio">
          <div className="login-art-glow" />
          <div className="login-art-stars" aria-hidden="true" />
          <div className="login-art-moon" aria-hidden="true" />
          <div className="login-art-hill login-art-hill-back" aria-hidden="true" />
          <div className="login-art-hill login-art-hill-front" aria-hidden="true" />
          <div className="login-art-copy">
            <img src="/synclife-logo.png" alt="" />
            <span className="section-kicker">TU VIDA EN SINCRONÍA</span>
            <h2>{authMode === 'register' ? <>Empieza a cuidarte<br />a tu manera.</> : <>Qué bueno tenerte<br />de vuelta.</>}</h2>
            <p>Un espacio para avanzar a tu ritmo, celebrar tus pequeños pasos y construir hábitos que te hagan bien.</p>
            <ul className="login-benefits">
              <li><CheckCircle2 size={17} /><span>Organiza tus hábitos y tus días</span></li>
              <li><CheckCircle2 size={17} /><span>Cuida tu bienestar con calma</span></li>
              <li><CheckCircle2 size={17} /><span>Revisa tu progreso cuando quieras</span></li>
            </ul>
            <div className="login-welcome-note"><Sparkles size={16} /><span>Pequeños pasos, grandes cambios.</span></div>
          </div>
          <div className="login-art-orbit login-art-orbit-one" aria-hidden="true" />
          <div className="login-art-orbit login-art-orbit-two" aria-hidden="true" />
        </aside>
        <section className="login-card" aria-labelledby="login-title">
          <img className="login-logo" src="/synclife-logo.png" alt="Logo de SyncLife OS" />
          <span className="section-kicker">{authMode === 'register' ? 'ÚNETE A SYNCLIFE' : 'TU ESPACIO PERSONAL'}</span>
          <h1 id="login-title">{authMode === 'register' ? 'Crea tu cuenta' : 'Inicio de sesión'}</h1>
          <p>{authMode === 'register'
            ? 'Crea tu cuenta y organiza tus hábitos, bienestar y finanzas.'
            : 'Organiza tus hábitos, tu bienestar y tus finanzas en un solo lugar.'}</p>
          {!authReady && <p className="login-auth-status" role="status">Comprobando tu sesión…</p>}
          {authError && <p className="login-auth-error" role="alert">{authError}</p>}
          {authNotice && <p className="login-auth-status" role="status">{authNotice}</p>}
          {!firebaseConfigured && <p className="login-auth-error" role="alert">Falta configurar Firebase. Completa las variables VITE_FIREBASE_* en frontend/.env.local y reinicia Vite.</p>}
          <form className="login-auth-form" onSubmit={submitEmailAuth}>
            {authMode === 'register' && (
              <label className="login-field">
                <span>Nombre de usuario</span>
                <input
                  type="text"
                  autoComplete="username"
                  value={authUsername}
                  onChange={(event) => setAuthUsername(event.target.value)}
                  placeholder="Ej. nicol2005"
                  minLength={3}
                  maxLength={24}
                  pattern="[A-Za-z0-9._-]{3,24}"
                  required
                  disabled={!authReady || authLoading || !firebaseConfigured}
                />
                <small className="field-hint">Lo usarás para iniciar sesión y aparecerá en tu perfil.</small>
              </label>
            )}
            <label className="login-field">
              <span>{authMode === 'register' ? 'Correo electrónico' : 'Correo o nombre de usuario'}</span>
              <input
                type={authMode === 'register' ? 'email' : 'text'}
                autoComplete={authMode === 'register' ? 'email' : 'username'}
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
                placeholder={authMode === 'register' ? 'tu@correo.com' : 'tu@correo.com o tu usuario'}
                required
                disabled={!authReady || authLoading || !firebaseConfigured}
              />
            </label>
            <label className="login-field">
              <span>Contraseña</span>
              <input
                type="password"
                autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                placeholder={authMode === 'register' ? 'Mínimo 6 caracteres' : 'Tu contraseña'}
                minLength={6}
                required
                disabled={!authReady || authLoading || !firebaseConfigured}
              />
            </label>
            {authMode === 'register' && (
              <label className="login-field">
                <span>Confirmar contraseña</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={authPasswordConfirmation}
                  onChange={(event) => setAuthPasswordConfirmation(event.target.value)}
                  placeholder="Repite tu contraseña"
                  minLength={6}
                  required
                  disabled={!authReady || authLoading || !firebaseConfigured}
                />
              </label>
            )}
            {authMode === 'login' && (
              <button
                className="login-text-button login-forgot-button"
                type="button"
                onClick={resetEmailPassword}
                disabled={!authReady || authLoading || !firebaseConfigured}
              >
                ¿Olvidaste tu contraseña?
              </button>
            )}
            <button className="login-submit" type="submit" disabled={!authReady || authLoading || !firebaseConfigured}>
              {authLoading
                ? (authMode === 'register' ? 'Creando cuenta…' : 'Ingresando…')
                : (authMode === 'register' ? 'Crear cuenta' : 'Iniciar sesión')}
            </button>
          </form>
          {authMode === 'register' && (
            <div className="login-terms-check">
              <input id="login-terms-accepted" type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} disabled={authLoading} />
              <span><label htmlFor="login-terms-accepted">Confirmo que leí y acepto los</label>{' '}<button type="button" onClick={() => setLegalDocument('terms')}>Términos de uso</button>{' '}y la{' '}<button type="button" onClick={() => setLegalDocument('privacy')}>Política de privacidad</button>.</span>
            </div>
          )}
          {authMode === 'login' && (
            <label className="login-remember-check">
              <input type="checkbox" checked={rememberSession} onChange={(event) => setRememberSession(event.target.checked)} disabled={authLoading} />
              <span>Mantener mi sesión iniciada</span>
            </label>
          )}
          <div className="login-divider"><span>o también puedes entrar con</span></div>
          <button className="login-submit google-login-button" type="button" onClick={signInWithGoogle} disabled={!authReady || authLoading || !firebaseConfigured}>
            <span className="google-mark" aria-hidden="true">G</span>
            {authLoading ? 'Conectando con Google…' : authMode === 'register' ? 'Crear cuenta con Google' : 'Entrar con Google'}
          </button>
          <p className="login-mode-switch">
            {authMode === 'register' ? '¿Ya tienes una cuenta?' : '¿Eres nuevo?'}
            {' '}
            <button className="login-text-button" type="button" onClick={() => changeAuthMode(authMode === 'register' ? 'login' : 'register')}>
              {authMode === 'register' ? 'Inicia sesión' : 'Crea una cuenta'}
            </button>
          </p>
          {(!firebaseConfigured || authError) && (
            <button className="login-submit secondary-login-button" type="button" onClick={enterDemoWorkspace}>
              Usar vista demo
            </button>
          )}
          <small>Puedes entrar con correo y contraseña, nombre de usuario y contraseña o Google. Las cuentas antiguas pueden elegir un nombre de usuario después de iniciar sesión.</small>
        </section>
        </div>
        <footer className="login-legal-footer">
          <span>Al continuar, aceptas nuestros</span>
          <button type="button" onClick={() => setLegalDocument('terms')}>Términos de uso</button>
          <span>y</span>
          <button type="button" onClick={() => setLegalDocument('privacy')}>Política de privacidad</button>
          <span className="login-legal-copy">© {new Date().getFullYear()} SyncLife OS · Tu bienestar, a tu ritmo.</span>
        </footer>
        {legalDocument && (
          <div className="login-legal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setLegalDocument(''); }}>
            <section className="login-legal-dialog" role="dialog" aria-modal="true" aria-labelledby="login-legal-title">
              <button type="button" className="login-legal-close" onClick={() => setLegalDocument('')} aria-label="Cerrar">×</button>
              <span className="login-legal-kicker">SYNCLIFE OS</span>
              <h2 id="login-legal-title">{legalDocument === 'terms' ? 'Términos de uso' : 'Política de privacidad'}</h2>
              {legalDocument === 'terms' ? (
                <div className="login-legal-body">
                  <p><strong>Última actualización: 10 de noviembre de 2026.</strong> Texto informativo inicial; conviene revisarlo legalmente antes de presentarlo como aviso definitivo.</p>
                  <p>SyncLife OS ofrece herramientas de organización personal para hábitos, bienestar, alimentación, finanzas y calendario. La información que muestra es orientativa y no sustituye el consejo de profesionales de salud o finanzas.</p>
                  <p>Usa una cuenta propia, mantén segura tu contraseña y registra información veraz. Eres responsable de revisar los datos antes de guardar decisiones personales. No uses la aplicación para emergencias ni como servicio médico.</p>
                  <p>Al crear una cuenta o iniciar sesión, aceptas usar el servicio de forma responsable. Puedes dejar de usarlo y cerrar sesión cuando quieras.</p>
                </div>
              ) : (
                <div className="login-legal-body">
                  <p><strong>Última actualización: 10 de noviembre de 2026.</strong> Texto informativo inicial; conviene revisarlo legalmente antes de presentarlo como aviso definitivo.</p>
                  <p>Firebase Authentication gestiona el acceso. Si eliges Google, SyncLife recibe los datos básicos de perfil que autorizas, como correo y nombre. El identificador de cuenta, correo, nombre y rol pueden sincronizarse con el servidor de SyncLife.</p>
                  <p>Los datos de hábitos, comidas, rutinas, finanzas, sesiones de ejercicio y calendario se guardan principalmente en este navegador. El servidor solo recibe conteos agregados de comidas, rutinas y sesiones, además de los datos básicos de la cuenta; no se envían allí tus datos de peso ni tus finanzas. Los registros diarios antiguos del panel administrativo se conservan, pero ya no se generan nuevos puntajes diarios.</p>
                  <p>Las consultas de alimentos se envían a USDA FoodData Central a través del backend; la ciudad se envía al proveedor del clima al consultar el tiempo. Evita escribir información privada que no sea necesaria para esas funciones.</p>
                  <p>Puedes borrar los datos locales desde el navegador; hacerlo no elimina tu cuenta de Firebase ni los registros que ya se sincronizaron con el servidor. Esta explicación resume el comportamiento actual de SyncLife OS y puede actualizarse si cambian sus funciones.</p>
                </div>
              )}
              <button type="button" className="login-legal-accept" onClick={() => setLegalDocument('')}>Entendido</button>
            </section>
          </div>
        )}
      </main>
    );
  }

  if (isLoggedIn && !adminClaimReady) {
    return <main className="admin-loading admin-auth-loading" role="status">Verificando acceso seguro a SyncLife…</main>;
  }

  if (isAdmin && vista === 'admin') {
    return <AdminPanel user={auth?.currentUser} isAdmin={isAdmin} isSuperAdmin={isSuperAdmin}
      onRefreshClaim={refreshAdminClaim} onExit={confirmLogout} />;
  }

  return (
    <div className="app-container">
      {showCurtain && (
        <div className="opening-curtain" aria-hidden="true">
          <div className="curtain-panel curtain-left" />
          <div className="curtain-panel curtain-right" />
          <div className="curtain-brand">
            <img src="/synclife-logo.png" alt="" />
            <span>Tu vida en sincronía</span>
          </div>
        </div>
      )}
      <div className={`screen-watermark watermark-${vista}`} aria-hidden="true"><ScreenBackdropIcon /></div>
      <aside className={`sidebar ${mobileNavigationOpen ? 'is-mobile-open' : ''}`}>
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setVista('inicio'); setMobileNavigationOpen(false); }}>
          <img className="brand-logo" src="/synclife-logo.png" alt="" />
          <span>SyncLife<span className="brand-light"> OS</span></span>
        </a>
        <button type="button" className="sidebar-menu-toggle" aria-expanded={mobileNavigationOpen}
          aria-controls="primary-navigation" onClick={() => setMobileNavigationOpen((open) => !open)}>
          {mobileNavigationOpen ? <X size={18} /> : <Menu size={18} />}
          <span>{mobileNavigationOpen ? 'Cerrar menú' : 'Menú'}</span>
        </button>

        <div className="workspace-label">ESPACIO PERSONAL</div>
        <nav id="primary-navigation" className="sidebar-btns" aria-label="Navegación principal" onClick={() => setMobileNavigationOpen(false)}>
          {navItems.map(({ id, label, icon: Icon }) => (
            id === 'bienestar' ? (
              <div className="sidebar-nav-group" key={id}>
                <div className="sidebar-nav-heading"><Icon size={18} strokeWidth={1.8} /><span>{label}</span></div>
                <div className="sidebar-nav-children">
                  <button className={`btn-side ${vista === 'actividad-fisica' ? 'active' : ''}`} onClick={() => setVista('actividad-fisica')} aria-current={vista === 'actividad-fisica' ? 'page' : undefined}>
                    <Activity size={17} strokeWidth={1.8} /><span>Actividad Física</span>
                  </button>
                  <button className={`btn-side ${vista === 'alimentacion' ? 'active' : ''}`} onClick={() => setVista('alimentacion')} aria-current={vista === 'alimentacion' ? 'page' : undefined}>
                    <Salad size={17} strokeWidth={1.8} /><span>Alimentación</span>
                  </button>
                </div>
              </div>
            ) : (
              <button key={id} className={`btn-side ${vista === id ? 'active' : ''}`} onClick={() => setVista(id)} data-tooltip={`Abrir ${label.toLowerCase()}`}>
                <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
              </button>
            )
          ))}
          {isAdmin && (
              <button className={`btn-side ${vista === 'admin' ? 'active' : ''}`} onClick={() => setVista('admin')} aria-current={vista === 'admin' ? 'page' : undefined}>
                <ShieldCheck size={18} strokeWidth={1.8} /><span>Administración</span>
              </button>
          )}
        </nav>

        <div className="sidebar-card">
          <div className="sidebar-card-icon"><Target size={17} /></div>
          <p>Tu progreso, a tu ritmo</p>
          <span>Pequeños pasos, grandes cambios.</span>
          <div className="sidebar-progress"><i style={{ width: `${completionRate}%` }} /></div>
          <small>{completionRate}% de tareas completadas hoy</small>
        </div>

        <div className="sidebar-bottom">
          <div className="avatar">{profile.photoURL ? <img src={profile.photoURL} alt="" /> : profile.name.charAt(0).toUpperCase()}</div>
          <div><strong>{profile.name}</strong><span>{profile.email || 'Cuenta Google'}</span></div>
          {!profile.username && <button className="profile-edit" aria-label="Elegir nombre de usuario" data-tooltip="Elegir nombre de usuario" onClick={() => { setUsernameSetupError(''); setUsernameSetupOpen(true); }}><Pencil size={16} /></button>}
          <button className="profile-edit" aria-label="Repetir recorrido guiado" data-tooltip="Repetir recorrido guiado" onClick={() => setTourStep(0)}><HelpCircle size={16} /></button>
          <button className="profile-edit" aria-label="Cerrar sesión" data-tooltip="Cerrar sesión" onClick={switchUser}><LogOut size={16} /></button>
          <span className="online-dot" aria-label="En línea" />
        </div>
      </aside>

      <main className="main-content">
        <header className="header-top">
          <div className="page-heading">
            <span className="eyebrow">{dateLabel(today, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
            <h1>{({
              inicio: `Un día equilibrado empieza aquí, ${profile.name}`,
              calendario: 'Tu tiempo, en sincronía',
              'actividad-fisica': 'Actividad Física',
              alimentacion: 'Alimentación',
              finanzas: 'Tu dinero, con claridad',
              analisis: `Tu progreso, ${profile.name}`,
              admin: 'Panel administrativo',
            })[vista]}</h1>
            <p>{({
              inicio: 'Una vista clara de tu tiempo, tu bienestar y tu presupuesto.',
              calendario: 'Eventos, rutinas, comidas y vencimientos en una sola agenda.',
              'actividad-fisica': 'Organiza tus rutinas y preferencias de entrenamiento.',
              alimentacion: 'Planifica tus comidas y revisa tus recomendaciones.',
              finanzas: 'Planifica tu presupuesto mensual y anticipa tus próximos pagos.',
              analisis: 'Consulta la actividad, alimentación, hábitos y gastos que guardas en cada sección.',
              admin: 'Indicadores agregados, cuentas y estado de servicios.',
            })[vista]}</p>
          </div>
          <div className="header-actions">
            <button className="admin-entry-button" type="button" onClick={openAdminEntry}>
              <ShieldCheck size={15} /> Admin
            </button>
            <div className="api-status" title={weatherError || undefined}>
              <span className={`status-dot ${weatherError ? 'is-error' : weatherApi ? 'is-online' : ''}`} />
              {weatherError ? 'Clima no disponible' : weatherLoading ? 'Consultando clima' : weatherApi ? 'Clima actualizado' : 'SyncLife listo'}
            </div>
            <button className="icon-button help-button" aria-label="Ver recorrido guiado" data-tooltip="Ver recorrido guiado" onClick={() => setTourStep(0)}><HelpCircle size={18} /></button>
            <button className="icon-button notification-button" aria-label="Notificaciones pendientes" aria-expanded={notificationsOpen} data-tooltip="Ver tareas y recordatorios pendientes" onClick={() => setNotificationsOpen((open) => !open)}>
              <Bell size={19} />
              {notificationItems.length > 0 && <i />}
              {notificationItems.length > 0 && <span className="notification-count">{notificationItems.length}</span>}
            </button>
            {notificationsOpen && (
              <div className="notification-popover" role="dialog" aria-label="Pendientes y recordatorios">
                <div className="notification-popover-heading">
                  <div><strong>Tu lista pendiente</strong><small>{notificationItems.length ? `${notificationItems.length} cosas para revisar` : 'Todo al día'}</small></div>
                  <button onClick={() => setNotificationsOpen(false)} aria-label="Cerrar notificaciones">×</button>
                </div>
                {notificationItems.length ? notificationItems.slice(0, 6).map((item) => (
                  <button className="notification-item" key={item.id} onClick={item.action}>
                    <span className="notification-item-dot" /><span><strong>{item.title}</strong><small>{item.detail}</small></span><ChevronRight size={15} />
                  </button>
                )) : <p className="notification-empty">No tienes tareas o vencimientos pendientes. ¡Buen trabajo!</p>}
              </div>
            )}
            <div className="avatar avatar-top" data-tooltip={profile.name}>{profile.name.charAt(0).toUpperCase()}</div>
          </div>
        </header>

        {notification && <div className="toast-message" role="status">{notification}<button onClick={() => setNotification('')} aria-label="Cerrar notificación">×</button></div>}
        {showLogoutDialog && (
          <div className="logout-dialog-backdrop">
            <section className="logout-dialog" role="dialog" aria-modal="true" aria-labelledby="logout-dialog-title">
              <span className="logout-dialog-icon"><LogOut size={20} /></span>
              <h2 id="logout-dialog-title">¿Cerrar sesión?</h2>
              <p>Volverás a la portada de SyncLife.</p>
              {logoutError && <p className="login-auth-error" role="alert">{logoutError}</p>}
              <div className="logout-dialog-actions">
                <button type="button" className="logout-cancel-button" onClick={() => setShowLogoutDialog(false)} disabled={authLoading}>Cancelar</button>
                <button type="button" className="logout-confirm-button" onClick={confirmLogout} disabled={authLoading}>
                  {authLoading ? 'Saliendo…' : 'Sí, salir'}
                </button>
              </div>
            </section>
          </div>
        )}
        {usernameSetupOpen && tourStep < 0 && (
          <div className="username-setup-backdrop">
            <form className="username-setup-dialog" role="dialog" aria-modal="true" aria-labelledby="username-setup-title" onSubmit={submitUsernameSetup}>
              <span className="section-kicker">TU CUENTA SYNCLIFE</span>
              <h2 id="username-setup-title">Elige cómo iniciar sesión</h2>
              <p>Tu nombre de usuario será más fácil de recordar y aparecerá en tu perfil. También puedes seguir entrando con Google.</p>
              {usernameSetupError && <p className="login-auth-error" role="alert">{usernameSetupError}</p>}
              <label className="login-field">
                <span>Nombre de usuario</span>
                <input type="text" autoComplete="username" value={usernameSetupValue} onChange={(event) => setUsernameSetupValue(event.target.value)} minLength={3} maxLength={24} pattern="[A-Za-z0-9._-]{3,24}" placeholder="Ej. nicol2005" required disabled={usernameSetupLoading} />
              </label>
              {!hasPasswordProvider && (
                <>
                  <p className="field-hint">Para iniciar también con este nombre, crea una contraseña. Tu acceso con Google seguirá disponible.</p>
                  <label className="login-field">
                    <span>Crear contraseña</span>
                    <input type="password" autoComplete="new-password" value={usernameSetupPassword} onChange={(event) => setUsernameSetupPassword(event.target.value)} minLength={6} required disabled={usernameSetupLoading} />
                  </label>
                  <label className="login-field">
                    <span>Confirmar contraseña</span>
                    <input type="password" autoComplete="new-password" value={usernameSetupPasswordConfirmation} onChange={(event) => setUsernameSetupPasswordConfirmation(event.target.value)} minLength={6} required disabled={usernameSetupLoading} />
                  </label>
                </>
              )}
              <div className="username-setup-actions">
                <button type="button" className="logout-cancel-button" onClick={() => setUsernameSetupOpen(false)} disabled={usernameSetupLoading}>Ahora no</button>
                <button type="submit" className="logout-confirm-button" disabled={usernameSetupLoading}>{usernameSetupLoading ? 'Guardando…' : 'Guardar nombre'}</button>
              </div>
            </form>
          </div>
        )}

        {vista === 'inicio' && (
          <>
            <section className="module-shortcuts" aria-label="Módulos principales">
              <button className="module-shortcut" onClick={() => setVista('calendario')}>
                <span className="shortcut-icon shortcut-blue"><CalendarDays size={19} /></span>
                <span><strong>Calendario</strong><small>Eventos y vencimientos</small></span>
                <ChevronRight size={17} />
              </button>
              <button className="module-shortcut" onClick={() => setVista('actividad-fisica')}>
                <span className="shortcut-icon shortcut-green"><Dumbbell size={19} /></span>
                <span><strong>Actividad Física</strong><small>Rutinas y ejercicio</small></span>
                <ChevronRight size={17} />
              </button>
              <button className="module-shortcut" onClick={() => setVista('finanzas')}>
                <span className="shortcut-icon shortcut-violet"><Wallet size={19} /></span>
                <span><strong>Finanzas personales</strong><small>Presupuesto y pagos</small></span>
                <ChevronRight size={17} />
              </button>
            </section>
            <article className="card assistant-card">
              <span className="assistant-sparkle"><Sparkles size={18} /></span>
              <div><span className="section-kicker">ASISTENTE INTELIGENTE LOCAL</span><p>{assistantInsight}</p><small>Consejo generado con tus hábitos y presupuesto guardados en este dispositivo.</small></div>
              <button className="text-action" onClick={() => setVista(availableBudget < 0 || dailyExpenseTotal > 0 ? 'finanzas' : 'actividad-fisica')}>Ver detalle <ChevronRight size={16} /></button>
            </article>
            <section className="metric-card-grid">
              <article className="metric-box metric-primary">
                <div className="metric-top"><span className="metric-icon blue"><Activity size={18} /></span><span className="metric-note">HOY</span></div>
                <span className="metric-label">Actividad física</span>
                <div className="metric-val">{todaysExerciseMinutes}<small> min</small></div>
                <span className="metric-foot">{todaysExerciseSessions.length} sesión(es) guardadas</span>
              </article>
              <article className="metric-box">
                <div className="metric-top"><span className="metric-icon violet"><Flame size={18} /></span><span className="metric-note">SEGUIMIENTO</span></div>
                <span className="metric-label">Tareas completadas</span>
                <div className="metric-val">{completeCount}<small> / {habits.length}</small></div>
                <div className="metric-progress"><i className="violet-fill" style={{ width: `${completionRate}%` }} /></div>
              </article>
              <article className="metric-box">
                <div className="metric-top"><span className="metric-icon green"><Wallet size={18} /></span><span className="metric-note">GASTOS DEL DÍA</span></div>
                <span className="metric-label">Gasto registrado</span>
                <div className="metric-val metric-money">{currency(expenseTotal)}</div>
                <span className="metric-foot">{dailyExpenses.length} compras categorizadas hoy</span>
              </article>
              <article className="metric-box">
                <div className="metric-top"><span className="metric-icon amber"><CloudSun size={18} /></span><span className="metric-note">CLIMA LOCAL</span><button type="button" className="weather-refresh" onClick={() => setWeatherRefresh((current) => current + 1)} disabled={weatherLoading} aria-label="Actualizar clima" title="Actualizar clima"><RefreshCw size={14} /></button></div>
                <span className="metric-label">{weatherApi?.ciudad || ciudad}</span>
                <div className="metric-val">{weatherApi?.temp == null ? '—' : `${weatherApi.temp}°`}<small>{weatherApi?.temp == null ? (weatherLoading ? 'Consultando' : '') : 'C'}</small></div>
                <span className="metric-foot">{weatherSummary(weatherApi, weatherError, weatherLoading)}{weatherApi?.stale ? ' · dato de respaldo' : ''}</span>
              </article>
            </section>

            <section className="dashboard-grid">
              <article className="card habits-panel">
                <div className="section-heading">
                  <div><span className="section-kicker">CONSTANCIA SOBRE PERFECCIÓN</span><h2><ListTodo size={19} /> Hábitos diarios</h2></div>
                  <span className="count-pill">{completeCount}/{habits.length} listos</span>
                </div>
                <p className="section-description">Cada check cuenta. Marca tus avances mientras transcurre el día.</p>
                <div className="habit-list">
                  {habits.length ? habits.map((habit) => (
                    <div key={habit.id} className={`habit-row ${habit.complete ? 'is-complete' : ''}`}>
                      <button className="habit-toggle" onClick={() => toggleHabit(habit.id)} aria-label={`${habit.complete ? 'Marcar pendiente' : 'Completar'} ${habit.name}`}>
                        <span className="habit-check">{habit.complete && <Check size={15} />}</span>
                        <span className="habit-copy"><strong>{habit.name}</strong><small>{habit.detail || 'Hábito diario'}</small></span>
                        <span className={`habit-state ${habit.complete ? 'done' : ''}`}>{habit.complete ? 'Hecho' : 'Pendiente'}</span>
                      </button>
                      <button className="habit-action" aria-label={`Editar ${habit.name}`} onClick={() => editHabit(habit)}><Pencil size={14} /></button>
                      <button className="habit-action" aria-label={`Eliminar ${habit.name}`} onClick={() => setHabits((current) => current.filter((item) => item.id !== habit.id))}><Trash2 size={14} /></button>
                    </div>
                  )) : <p className="no-events">Aún no tienes hábitos diarios. Agrega uno para empezar.</p>}
                </div>
                <form className="habit-editor" onSubmit={saveHabit}>
                  <div className="field"><label htmlFor="habit-name">{editingHabitId ? 'Editar hábito diario' : 'Nuevo hábito diario'}</label><input id="habit-name" value={newHabitName} onChange={(event) => setNewHabitName(event.target.value)} placeholder="Ej. Tomar agua" required /></div>
                  <div className="field"><label htmlFor="habit-detail">Detalle (opcional)</label><input id="habit-detail" value={newHabitDetail} onChange={(event) => setNewHabitDetail(event.target.value)} placeholder="Ej. Beber 6 vasos durante el día" /></div>
                  <div className="habit-editor-actions"><button className="small-add" type="submit"><Plus size={15} /> {editingHabitId ? 'Guardar' : 'Agregar'}</button>{editingHabitId && <button className="text-action" type="button" onClick={cancelHabitEdit}>Cancelar</button>}</div>
                </form>
                <button className="text-action" onClick={() => setVista('actividad-fisica')}>Ver actividad física <ChevronRight size={16} /></button>
              </article>

              <article className="card daily-expense-panel">
                <div className="section-heading">
                  <div><span className="section-kicker">FINANZAS CONECTADAS</span><h2><Wallet size={19} /> Gastos de hoy</h2></div>
                  <strong className="expense-total">{currency(dailyExpenseTotal)}</strong>
                </div>
                <form className="quick-expense-form" onSubmit={addDailyExpense}>
                  <div className="field"><label htmlFor="daily-spend-name">¿Qué compraste?</label><input id="daily-spend-name" value={expenseName} onChange={(event) => setExpenseName(event.target.value)} placeholder="Ej. Chompa, gaseosa" required /></div>
                  <div className="field"><label htmlFor="daily-spend-amount">Monto (PEN)</label><input id="daily-spend-amount" type="number" min="0.01" step="0.01" value={expenseAmount} onChange={(event) => setExpenseAmount(event.target.value)} placeholder="0.00" required /></div>
                  <div className="field"><label htmlFor="daily-spend-category">Categoría</label><select id="daily-spend-category" value={expenseCategory} onChange={(event) => setExpenseCategory(event.target.value)}>{expenseCategories.map((category) => <option key={category}>{category}</option>)}</select></div>
                  <button className="small-add expense-submit" type="submit"><Plus size={15} /> Agregar gasto</button>
                </form>
                <div className="daily-expense-list">
                  {dailyExpenses.length ? dailyExpenses.slice(0, 5).map((item) => {
                    const CategoryIcon = expenseCategoryIcons[item.category] || CircleDollarSign;
                    return (
                      <div className="daily-expense-row" key={item.id}>
                        <span className="expense-category-icon"><CategoryIcon size={16} /></span>
                        <span><strong>{item.name}</strong><small>{item.category}</small></span>
                        <strong>{currency(item.amount)}</strong>
                        <button aria-label={`Eliminar gasto ${item.name}`} onClick={() => setExpenses((current) => current.filter((expense) => expense.id !== item.id))}><Trash2 size={14} /></button>
                      </div>
                    );
                  }) : <p className="no-events">Registra aquí compras como ropa, medicamentos o bebidas.</p>}
                </div>
                <button className="text-action" onClick={() => setVista('finanzas')}>Ver presupuesto completo <ChevronRight size={16} /></button>
              </article>

              <article className="card trend-panel">
                <div className="section-heading">
                  <div><span className="section-kicker">MOVIMIENTO REGISTRADO</span><h2><BarChart3 size={19} /> Actividad de la semana</h2></div>
                  <span className="period-tag">Minutos por día</span>
                </div>
                <div className="chart-legend"><span><i /> Minutos de ejercicio</span></div>
                <BarChart records={weeklyExerciseSummary} />
              </article>

              <article className="card calendar-panel">
                <div className="section-heading">
                  <div><span className="section-kicker">PLANIFICACIÓN</span><h2><CalendarDays size={19} /> Calendario</h2></div>
                  <button className="small-add" onClick={openCalendarEventForm}><Plus size={15} /> Evento</button>
                </div>
                <div className="calendar-nav">
                  <button className="calendar-arrow" onClick={() => changeMonth(-1)} aria-label="Mes anterior"><ChevronLeft size={17} /></button>
                  <strong>{monthLabel}</strong>
                  <button className="calendar-arrow" onClick={() => changeMonth(1)} aria-label="Mes siguiente"><ChevronRight size={17} /></button>
                </div>
                <div className="cal-grid">
                  {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((day, index) => <span className="cal-head" key={`${day}-${index}`}>{day}</span>)}
                  {calendarDays.map((day, index) => {
                    if (!day) return <span key={`empty-${index}`} className="calendar-empty" />;
                    const dayDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), day);
                    const key = localDate(dayDate);
                    const hasEvent = hasCalendarItems(dayDate);
                    const isToday = key === localDate(today);
                    const isSelected = key === localDate(selectedDate);
                    return (
                      <button
                        key={key}
                        className={`cal-day ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}`}
                        onClick={() => setSelectedDate(dayDate)}
                        aria-label={`${day} ${monthLabel}${hasEvent ? ', tiene evento' : ''}`}
                      >
                        {day}{hasEvent && <i />}
                      </button>
                    );
                  })}
                </div>
                <div className="selected-day-events">
                  <div className="event-date-heading"><span>{dateLabel(selectedDate, { weekday: 'short', day: 'numeric', month: 'short' })}</span><button onClick={openCalendarEventForm}><Plus size={15} /> Añadir</button></div>
                  {currentEvents.length ? currentEvents.map((item) => (
                    <div className={`event-row event-${item.status}`} key={item.id}>
                      <span className="event-marker" /><div><strong>{item.name}</strong><small>{item.allDay ? 'Todo el día' : `${item.start} — ${item.end}`}</small></div>
                    </div>
                  )) : <p className="no-events">Sin eventos para este día.</p>}
                </div>
              </article>

              <article className="card finance-panel">
                <div className="section-heading">
                  <div><span className="section-kicker">PRESUPUESTO MENSUAL</span><h2><CircleDollarSign size={19} /> Finanzas personales</h2></div>
                  <span className="local-tag">Guardado local</span>
                </div>
                <label className="income-field"><span>Presupuesto mensual (PEN)</span><input type="number" min="0" value={ingreso} onChange={(event) => setIngreso(event.target.value)} placeholder="0.00" /></label>
                <div className="finance-compare">
                  <div className="finance-line"><span><i className="expense-dot" /> Costos fijos</span><strong>{currency(fixedCostTotal)}</strong></div>
                  <div className="finance-line"><span><i className="food-dot" /> Alimentación asignada</span><strong>{currency(foodBudget)}</strong></div>
                  <div className="finance-bar"><i style={{ width: `${Math.min(100, Number(ingreso) > 0 ? ((fixedCostTotal + Number(foodBudget)) / Number(ingreso)) * 100 : 0)}%` }} /></div>
                  <small>Saldo disponible: {currency(availableBudget)}</small>
                </div>
                {upcomingFixedCosts.slice(0, 2).map((item) => (
                  <button className="upcoming-cost" key={item.id} onClick={() => { setSelectedDate(new Date(`${item.dueDate}T12:00:00`)); setVista('calendario'); }}>
                    <span>{item.name} · vence {dateLabel(new Date(`${item.dueDate}T12:00:00`), { day: 'numeric', month: 'short' })}</span><strong>{currency(item.amount)}</strong>
                  </button>
                ))}
                <button className="text-action" onClick={() => setVista('finanzas')}>Administrar presupuesto <ChevronRight size={16} /></button>
              </article>

              <article className="card nutrition-panel">
                <div className="section-heading">
                  <div><span className="section-kicker">BIENESTAR</span><h2><Salad size={19} /> Alimentación y energía</h2></div>
                  <span className="nutrition-icon"><Utensils size={16} /></span>
                </div>
                <div className="meal-highlight">
                  <div className="meal-symbol"><Utensils size={20} /></div>
                  <div className="meal-highlight-content">
                    <span>COMIDAS DE HOY · {mealsToday.length} registradas</span>
                    <div className="today-meal-groups">
                      {mealTypes.map((type) => {
                        const categoryMeals = mealsToday.filter((item) => item.type === type);
                        return (
                          <div className={`today-meal-group ${categoryMeals.length ? 'has-meals' : ''}`} key={type}>
                            <span>{mealCategoryLabels[type]}</span>
                            <strong>{categoryMeals.map((item) => item.name).join(', ') || 'Sin registro'}</strong>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div className="nutrition-stats">
                  <div><span>Presupuesto mensual</span><strong>{currency(foodBudget)}</strong></div>
                  <div><span>Costo planificado hoy</span><strong>{currency(mealsToday.reduce((total, item) => total + (Number(item.cost) || 0), 0))}</strong></div>
                </div>
                <button className="text-action" onClick={() => setVista('alimentacion')}>Planificar comidas <ChevronRight size={16} /></button>
              </article>
            </section>
          </>
        )}

        {vista === 'calendario' && (
          <section className="calendar-module-layout">
            <article className="card full-calendar-card">
              <div className="section-heading">
                <div><span className="section-kicker">AGENDA INTEGRADA</span><h2><CalendarDays size={19} /> {monthLabel}</h2></div>
                <button className="small-add" onClick={openCalendarEventForm}><Plus size={15} /> Nuevo evento</button>
              </div>
              <div className="calendar-nav">
                <button className="calendar-arrow" onClick={() => changeMonth(-1)} aria-label="Mes anterior"><ChevronLeft size={17} /></button>
                <strong>{monthLabel}</strong>
                <button className="calendar-arrow" onClick={() => changeMonth(1)} aria-label="Mes siguiente"><ChevronRight size={17} /></button>
              </div>
              <div className="cal-grid full-cal-grid">
                {weekdays.map((day) => <span className="cal-head" key={day}>{day.slice(0, 2)}</span>)}
                {calendarDays.map((day, index) => {
                  if (!day) return <span key={`calendar-empty-${index}`} className="calendar-empty" />;
                  const dayDate = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), day);
                  const dateKey = localDate(dayDate);
                  return (
                    <button
                      key={dateKey}
                      className={`cal-day ${dateKey === localDate(today) ? 'today' : ''} ${dateKey === localDate(selectedDate) ? 'selected' : ''}`}
                      onClick={() => setSelectedDate(dayDate)}
                      aria-label={`${dateLabel(dayDate, { day: 'numeric', month: 'long' })}${hasCalendarItems(dayDate) ? ', tiene actividades planificadas' : ''}`}
                    >
                      {day}{hasCalendarItems(dayDate) && <i />}
                    </button>
                  );
                })}
              </div>
              <div className="calendar-legend">
                <span><i className="legend-event" /> Eventos</span>
                <span><i className="legend-auto" /> Rutinas, comidas y pagos</span>
              </div>
            </article>
            <aside className="calendar-side-column">
              <article className="card day-timeline">
                <div className="section-heading">
                  <div><span className="section-kicker">DÍA SELECCIONADO</span><h2>{dateLabel(selectedDate, { weekday: 'long', day: 'numeric', month: 'long' })}</h2></div>
                  <button className="small-add" onClick={openCalendarEventForm}><Plus size={15} /> Añadir</button>
                </div>
                <div className="day-weather">
                  <CloudSun size={20} />
                  <div><strong>{weatherApi ? `${weatherApi.temp == null ? '—' : `${weatherApi.temp}°C`} · ${weatherApi.ciudad}` : `Clima de ${ciudad}`}</strong><span>{weatherSummary(weatherApi, weatherError, weatherLoading)}{weatherApi?.stale ? ' · dato de respaldo' : ''}</span></div>
                  <button type="button" className="weather-refresh" onClick={() => setWeatherRefresh((current) => current + 1)} disabled={weatherLoading} aria-label="Actualizar clima" title="Actualizar clima"><RefreshCw size={14} /></button>
                </div>
                <div className="timeline-list">
                  {selectedDayItems.length ? selectedDayItems.map((item) => (
                    <div className={`timeline-item timeline-${item.kind}`} key={item.id}>
                      <time>{item.time}</time><span className="timeline-marker" />
                      <div><strong>{item.title}</strong><small>{item.detail}</small></div>
                    </div>
                  )) : <p className="no-events">No hay actividades planificadas para este día.</p>}
                </div>
                {showEventForm && (
                  <form className="calendar-event-form" onSubmit={saveCalendarEvent}>
                    <div className="section-heading"><h3>Nuevo evento</h3><button type="button" className="text-action" onClick={() => setShowEventForm(false)}>Cancelar</button></div>
                    <div className="field"><label htmlFor="calendar-event-name">Nombre</label><input id="calendar-event-name" value={eventoNombre} onChange={(event) => setEventoNombre(event.target.value)} placeholder="Ej. Cita médica" required /></div>
                    <div className="form-grid">
                      <div className="field"><label htmlFor="calendar-event-date">Fecha</label><input id="calendar-event-date" type="date" value={eventoFecha} onChange={(event) => setEventoFecha(event.target.value)} required /></div>
                      <div className="field"><label htmlFor="calendar-event-status">Estado</label><select id="calendar-event-status" value={statusSelect} onChange={(event) => setStatusSelect(event.target.value)}><option value="amber">En proceso</option><option value="green">Completado</option><option value="red">Pendiente</option></select></div>
                      <div className="field field-wide"><label htmlFor="calendar-event-mode">Horario</label><select id="calendar-event-mode" value={eventMode} onChange={(event) => setEventMode(event.target.value)}><option value="horas">Horario específico</option><option value="allday">Todo el día</option></select></div>
                      {eventMode === 'horas' && <>
                        <div className="field"><label htmlFor="calendar-event-start">Inicio</label><input id="calendar-event-start" type="time" value={horaIn} onChange={(event) => setHoraIn(event.target.value)} /></div>
                        <div className="field"><label htmlFor="calendar-event-end">Fin</label><input id="calendar-event-end" type="time" value={horaOut} onChange={(event) => setHoraOut(event.target.value)} /></div>
                      </>}
                    </div>
                    <button className="btn-flow" type="submit"><Plus size={16} /> Guardar evento</button>
                  </form>
                )}
              </article>
              <article className="card upcoming-panel">
                <div className="section-heading"><div><span className="section-kicker">PRÓXIMOS 7 DÍAS</span><h2><Bell size={18} /> Vencimientos</h2></div></div>
                {upcomingFixedCosts.length ? upcomingFixedCosts.map((item) => (
                  <button className="upcoming-cost" key={item.id} onClick={() => setSelectedDate(new Date(`${item.dueDate}T12:00:00`))}>
                    <span>{item.name}<small>{dateLabel(new Date(`${item.dueDate}T12:00:00`), { weekday: 'short', day: 'numeric', month: 'short' })}</small></span><strong>{currency(item.amount)}</strong>
                  </button>
                )) : <p className="no-events">No tienes pagos que venzan esta semana.</p>}
              </article>
            </aside>
          </section>
        )}

        {vista === 'actividad-fisica' && (
          <section className="wellness-view">
            <article className="card wellness-profile">
              <div className="section-heading">
                <div><span className="section-kicker">PERFIL Y PREFERENCIAS</span><h2><Activity size={19} /> Tu punto de partida</h2></div>
                <span className="local-tag">Guardado en este dispositivo</span>
              </div>
              <p className="section-description">Completa estos datos una vez y actualízalos cuando quieras. Las rutinas son sugerencias generales: adapta el esfuerzo a cómo te sientes.</p>
              <div className="form-grid">
                <div className="field"><label htmlFor="body-weight">Peso (kg)</label><input id="body-weight" type="number" min="1" max="500" step="0.1" value={bodyProfile.weight} onChange={(event) => setBodyProfile((current) => ({ ...current, weight: event.target.value }))} placeholder="Ej. 65" /></div>
                <div className="field"><label htmlFor="body-height">Talla (cm)</label><input id="body-height" type="number" min="30" max="280" value={bodyProfile.height} onChange={(event) => setBodyProfile((current) => ({ ...current, height: event.target.value }))} placeholder="Ej. 165" /></div>
                <div className="field"><label htmlFor="body-sex">Género</label><select id="body-sex" value={bodyProfile.sex} onChange={(event) => setBodyProfile((current) => ({ ...current, sex: event.target.value }))}><option value="" disabled>Selecciona una opción</option><option value="masculino">Masculino</option><option value="femenino">Femenino</option><option value="otro">Otro</option><option value="prefiero no decirlo">Prefiero no decirlo</option></select></div>
                <div className="field"><label htmlFor="body-age">Edad</label><input id="body-age" type="number" min="13" max="120" value={bodyProfile.age} onChange={(event) => setBodyProfile((current) => ({ ...current, age: event.target.value }))} placeholder="Ej. 25" /></div>
              </div>
              <div className="preference-row">
                <span>¿Dónde prefieres entrenar?</span>
                <div>
                  <button className={`preference-button ${workoutPreference === 'casa' ? 'active' : ''}`} onClick={() => setWorkoutPreference('casa')}><Home size={16} /> En casa</button>
                  <button className={`preference-button ${workoutPreference === 'gimnasio' ? 'active' : ''}`} onClick={() => setWorkoutPreference('gimnasio')}><Dumbbell size={16} /> Gimnasio</button>
                </div>
              </div>
            </article>

            <article className="card">
              <div className="section-heading">
                <div><span className="section-kicker">MOVIMIENTO</span><h2><Dumbbell size={19} /> Rutina personalizada</h2></div>
                <button className="small-add" type="button" onClick={generatePersonalizedWorkouts} disabled={isGeneratingWorkout}><Sparkles size={15} /> {isGeneratingWorkout ? 'Creando rutina…' : 'Crear con mi perfil'}</button>
              </div>
              <p className="section-description">Al generar, peso, talla, edad y género se envían al proveedor de IA configurado. Las rutinas son sugerencias generales, no una indicación médica.</p>
              {workoutRecommendationMessage && <p className="recommendation-status" role="status">{workoutRecommendationMessage}</p>}
              <div className="workout-week">
                {(activeWeeklyWorkouts || initialWorkouts).map((workout, index) => (
                  <button
                    className={`workout-day ${selectedWorkoutDay === index ? 'active' : ''}`}
                    key={workout.day}
                    onClick={() => setSelectedWorkoutDay(index)}
                    aria-pressed={selectedWorkoutDay === index}
                  >
                    <span className="weekday-label">{weekdays[index]}</span>
                    <div><strong>{workout.activities?.join(' · ') || workout.name}</strong><small>{workout.duration ? `${workout.duration} min · ${workoutPreference}` : 'Recuperación'}</small></div>
                  </button>
                ))}
              </div>
              {generatedWorkouts && (
                <>
                  <p className="workout-intensity">{generatedWorkouts.intensity}. El género se conserva como dato de perfil, sin usarlo para imponer ejercicios distintos.</p>
                  {generatedWorkouts.bmiContext && <p className="field-hint">Se priorizaron opciones de bajo impacto como punto de partida; el IMC es solo una referencia general y no un diagnóstico.</p>}
                  <div className="workout-options">
                    {['casa', 'gimnasio'].map((place) => {
                      const plan = generatedWorkouts[place][selectedWorkoutDay];
                      return <article className="workout-option" key={place}>
                        <strong>{place === 'casa' ? 'En casa' : 'En gimnasio'} · {plan.duration ? `${plan.duration} min` : 'Descanso'}</strong>
                        <ul>{plan.activities.map((activity) => <li key={activity}>{activity}</li>)}</ul>
                      </article>;
                    })}
                  </div>
                </>
              )}
              <section className="exercise-session-panel">
                <div className="section-heading">
                  <div><span className="section-kicker">TU MOVIMIENTO</span><h2><Activity size={19} /> Guardar actividad realizada</h2></div>
                </div>
                <p className="section-description">Anota el ejercicio que hiciste y el tiempo. Tus sesiones también aparecerán en el calendario.</p>
                <form className="exercise-session-form" onSubmit={saveExerciseSession}>
                  <div className="field"><label htmlFor="exercise-session-name">Actividad</label><input id="exercise-session-name" value={exerciseActivity} onChange={(event) => setExerciseActivity(event.target.value)} placeholder="Ej. Caminata, bicicleta o yoga" required /></div>
                  <div className="field"><label htmlFor="exercise-session-minutes">Duración (minutos)</label><input id="exercise-session-minutes" type="number" min="1" max="600" step="1" value={exerciseMinutes} onChange={(event) => setExerciseMinutes(event.target.value)} placeholder="30" required /></div>
                  <div className="field"><label htmlFor="exercise-session-date">Fecha</label><input id="exercise-session-date" type="date" value={exerciseDate} onChange={(event) => setExerciseDate(event.target.value)} required /></div>
                  <button className="btn-flow" type="submit"><Plus size={16} /> Guardar actividad</button>
                </form>
                <div className="exercise-session-list">
                  {exerciseSessions.length ? exerciseSessions.slice(0, 5).map((session) => (
                    <div className="exercise-session-row" key={session.id}>
                      <span><strong>{session.activity}</strong><small>{dateLabel(new Date(`${session.date}T12:00:00`), { weekday: 'short', day: 'numeric', month: 'short' })}</small></span>
                      <strong>{session.minutes} min</strong>
                      <button type="button" aria-label={`Eliminar actividad ${session.activity}`} onClick={() => setExerciseSessions((current) => current.filter((item) => item.id !== session.id))}><Trash2 size={15} /></button>
                    </div>
                  )) : <p className="no-events">Aún no hay sesiones guardadas. Se mostrarán aquí después de agregarlas.</p>}
                </div>
              </section>
              <EmbeddedVideoCarousel
                title={`Movimiento · ${weekdays[selectedWorkoutDay]}`}
                videos={workoutVideos}
                selectedIndex={selectedWorkoutDay}
                onSelect={setSelectedWorkoutDay}
                onPrevious={() => setSelectedWorkoutDay((index) => (index + workoutVideos.length - 1) % workoutVideos.length)}
                onNext={() => setSelectedWorkoutDay((index) => (index + 1) % workoutVideos.length)}
                autoAdvanceMs={10000}
              />
            </article>
          </section>
        )}

        {vista === 'alimentacion' && (
          <section className="wellness-view">
            <article className="card meal-planner-card">
              <div className="section-heading">
                <div><span className="section-kicker">ALIMENTACIÓN</span><h2><Salad size={19} /> Planifica tus comidas</h2></div>
                <button className="text-action" onClick={() => setVista('finanzas')}>Presupuesto: {currency(foodBudget)} <ChevronRight size={16} /></button>
              </div>
              <div className="weekly-food-summary">
                <div><span>Total estimado de tus comidas esta semana</span><strong>{currency(weeklyMealCost)}</strong></div>
                <div><span>Presupuesto semanal de referencia</span><strong>{currency(weeklyFoodLimit)}</strong></div>
                <div className="finance-bar"><i style={{ width: `${Math.min(100, weeklyFoodLimit > 0 ? weeklyMealCost / weeklyFoodLimit * 100 : 0)}%` }} /></div>
                <p className="food-cost-note">Los costos de cada plato son estimados. El presupuesto semanal es tu asignación mensual dividida entre 4.33.</p>
              </div>
              <section className="micronutrient-card" aria-labelledby="micronutrient-title">
                <div className="micronutrient-heading">
                  <span className="micronutrient-icon"><Activity size={17} /></span>
                  <div><span className="section-kicker">SEGUIMIENTO POR COMIDA</span><h3 id="micronutrient-title">Nutrientes de hoy</h3></div>
                </div>
                <p className="micronutrient-intro">Cada alimento conserva sus propios valores y queda agrupado en su categoría. Registra solo los datos que conozcas.</p>
                <div className="micronutrient-category-grid">
                  {dailyMealCategorySummary.map(({ type, meals }) => (
                    <article className="micronutrient-category" key={type}>
                      <div className="micronutrient-category-heading">
                        <strong>{mealTypeLabels[type]}</strong>
                        <span>{meals.length} {meals.length === 1 ? 'alimento' : 'alimentos'}</span>
                      </div>
                      {meals.length ? (
                        <div className="micronutrient-food-list">
                          {meals.map(({ id, name, portion, source, basis, recordedNutrients, micronutrients }) => (
                            <div className="micronutrient-food" key={id}>
                              <strong>{name}</strong>
                              {portion && <small className="micronutrient-food-notes">Porción: {portion}</small>}
                              {recordedNutrients.length ? (
                                <div className="micronutrient-food-values">
                                  {recordedNutrients.map(({ label, value }) => <span key={label}>{label}: {value}</span>)}
                                </div>
                              ) : <small className="micronutrient-no-data">{source && source !== 'Registro manual' ? 'La IA no pudo estimar valores' : 'Sin nutrientes registrados'}</small>}
                              {micronutrients && <small className="micronutrient-food-notes">Vitaminas/minerales: {micronutrients}</small>}
                              {source && <small className="micronutrient-food-notes">{source === 'Registro manual' ? source : `Estimación de ${source} · revisar`}{basis ? ` · ${basis}` : ''}</small>}
                            </div>
                          ))}
                        </div>
                      ) : <p className="micronutrient-empty">Aún no registras alimentos de esta categoría.</p>}
                    </article>
                  ))}
                </div>
                <p className="micronutrient-disclaimer">Seguimiento manual de los alimentos de hoy; los campos vacíos no significan cero. No es un análisis nutricional ni sustituye la orientación profesional.</p>
              </section>
              <div className="meal-step-heading">
                <span className="meal-step-number">1</span>
                <div><h3>Elige la categoría</h3><p>Selecciona el tipo de comida y completa sus datos en esta sección.</p></div>
              </div>
              <div className="meal-category-buttons" role="group" aria-label="Categoría de comida">
                {mealTypes.map((type) => (
                  <button
                    className={`meal-category-button ${mealType === type ? 'active' : ''}`}
                    type="button"
                    key={type}
                    onClick={() => {
                      setMealType(type);
                      const videoIndex = recipeVideos.findIndex((video) => video.recipeType === type);
                      if (videoIndex >= 0) setSelectedRecipeVideo(videoIndex);
                    }}
                    aria-pressed={mealType === type}
                  >
                    {mealCategoryLabels[type]}
                  </button>
                ))}
              </div>
              <EmbeddedVideoCarousel
                title={`Video de preparación · ${mealTypeLabels[recipeVideos[selectedRecipeVideo].recipeType]}`}
                videos={recipeVideos}
                selectedIndex={selectedRecipeVideo}
                onSelect={setSelectedRecipeVideo}
                onPrevious={() => setSelectedRecipeVideo((index) => (index + recipeVideos.length - 1) % recipeVideos.length)}
                onNext={() => setSelectedRecipeVideo((index) => (index + 1) % recipeVideos.length)}
              />
              <div className="meal-step-heading meal-entry-heading">
                <span className="meal-step-number">2</span>
                <div><h3>Registra tu comida</h3><p>Indica la fecha, categoría, alimento, porción y costo; puedes estimar y revisar sus nutrientes antes de guardar.</p></div>
              </div>
              <form className="meal-entry-form" onSubmit={addMealPlan}>
                <div className="field"><label htmlFor="meal-date">Fecha</label><input id="meal-date" type="date" value={mealDate} onChange={(event) => setMealDate(event.target.value)} required /></div>
                <div className="field"><label htmlFor="meal-type">Tipo de comida</label><select id="meal-type" value={mealType} disabled={isSearchingMealNutrition} onChange={(event) => { if (event.target.value !== mealType) clearMealNutritionEstimate(); setMealType(event.target.value); }}>{mealTypes.map((type) => <option key={type} value={type}>{mealTypeLabels[type]}</option>)}</select></div>
                <div className="field"><label htmlFor="meal-name">Alimento o plato</label><input id="meal-name" value={mealName} disabled={isSearchingMealNutrition} onChange={(event) => { if (event.target.value !== mealName) clearMealNutritionEstimate(); setMealName(event.target.value); }} placeholder="Ej. arroz, pollo y ensalada" required /></div>
                <div className="field"><label htmlFor="meal-portion">Porción o cantidad (opcional)</label><input id="meal-portion" value={mealPortion} disabled={isSearchingMealNutrition} onChange={(event) => { if (event.target.value !== mealPortion) clearMealNutritionEstimate(); setMealPortion(event.target.value); }} placeholder="Ej. 350 g para calcular la porción" /></div>
                <div className="field"><label htmlFor="meal-cost">Costo estimado del plato (PEN)</label><input id="meal-cost" type="number" min="0" step="0.1" value={mealCost} onChange={(event) => setMealCost(event.target.value)} placeholder="0.00" required /></div>
                <details className="meal-nutrition-details" open>
                  <summary><Activity size={15} /> Consultar nutrientes o ingresarlos manualmente</summary>
                  <p>Piensa en «Almuerzo» como una carpeta: la búsqueda consulta lo que escribas en «Alimento o plato». USDA devuelve alimentos de referencia, no calcula recetas; en platos mixtos, revisa que coincidan los ingredientes principales. Si no aparece un resultado adecuado, puedes ingresar los nutrientes manualmente.</p>
                  <button className="estimate-nutrients-button" type="button" onClick={searchMealNutrition} disabled={isSearchingMealNutrition || !mealName.trim()}>
                    <Activity size={15} /> {isSearchingMealNutrition ? 'Buscando…' : 'Consultar API nutricional'}
                  </button>
                  {mealNutritionError && <p className="nutrition-estimate-message is-error" role="alert">{mealNutritionError}</p>}
                  {mealNutritionMatches.length > 0 && (
                    <div className="field">
                      <label htmlFor="nutrition-product-match">Alimento o plato de referencia encontrado</label>
                      <select id="nutrition-product-match" value={selectedNutritionMatchIndex} onChange={(event) => {
                        const index = Number(event.target.value);
                        if (Number.isInteger(index) && mealNutritionMatches[index]) {
                          selectNutritionMatch(mealNutritionMatches[index], index);
                        }
                      }}>
                        {mealNutritionMatches.map((product, index) => (
                          <option key={product.key} value={index}>{product.name}{product.searchMatch === 'complete' ? ' · Coincidencia de ingredientes' : ' · Coincidencia parcial'}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {mealNutritionEstimate && (
                    <div className="nutrition-estimate-message" role="status">
                      Referencia de {mealNutritionEstimate.source}: <strong>{mealNutritionEstimate.productName}</strong>{mealNutritionEstimate.searchMatch === 'partial' ? '. Es una coincidencia parcial; confirma que se parezca a tu plato.' : '. Coinciden los ingredientes principales.'} Los nutrientes que la fuente no publica quedan vacíos. {mealNutritionEstimate.basis}
                    </div>
                  )}
                  <div className="nutrition-facts">
                    <h4>Información nutricional · {mealNutritionEstimate
                      ? (getPortionWeightInGrams(mealPortion)
                        ? `${getPortionWeightInGrams(mealPortion)} g`
                        : 'por 100 g')
                      : (mealPortion.trim() || 'por porción')}</h4>
                    <table className="nutrition-facts-table">
                      <thead><tr><th>Nutriente</th><th>Cantidad</th></tr></thead>
                      <tbody>
                        <tr><th scope="row">Energía</th><td>{mealEnergy !== '' ? `${mealEnergy} kcal` : '—'}</td></tr>
                        <tr><th scope="row">Proteínas</th><td>{mealProtein !== '' ? `${mealProtein} g` : '—'}</td></tr>
                        <tr><th scope="row">Carbohidratos</th><td>{mealCarbohydrates !== '' ? `${mealCarbohydrates} g` : '—'}</td></tr>
                        <tr><th scope="row">Grasas</th><td>{mealFat !== '' ? `${mealFat} g` : '—'}</td></tr>
                        <tr><th scope="row">Fibra</th><td>{mealFiber !== '' ? `${mealFiber} g` : '—'}</td></tr>
                        <tr><th scope="row">Sodio</th><td>{mealSodium !== '' ? `${mealSodium} mg` : '—'}</td></tr>
                        <tr><th scope="row">Azúcares añadidos</th><td>{mealAddedSugar !== '' ? `${mealAddedSugar} g` : '—'}</td></tr>
                        <tr><th scope="row">Vitaminas y minerales</th><td>{mealMicronutrients || '—'}</td></tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="meal-nutrient-fields">
                    <div className="field"><label htmlFor="meal-fiber">Fibra (g)</label><input id="meal-fiber" type="number" min="0" step="0.1" value={mealFiber} onChange={(event) => setMealFiber(event.target.value)} placeholder="Ej. 4.5" /></div>
                    <div className="field"><label htmlFor="meal-sodium">Sodio (mg)</label><input id="meal-sodium" type="number" min="0" step="1" value={mealSodium} onChange={(event) => setMealSodium(event.target.value)} placeholder="Ej. 320" /></div>
                    <div className="field"><label htmlFor="meal-added-sugar">Azúcares añadidos (g)</label><input id="meal-added-sugar" type="number" min="0" step="0.1" value={mealAddedSugar} onChange={(event) => setMealAddedSugar(event.target.value)} placeholder="Ej. 6" /></div>
                    <div className="field field-wide"><label htmlFor="meal-micronutrients">Vitaminas o minerales clave</label><input id="meal-micronutrients" value={mealMicronutrients} onChange={(event) => setMealMicronutrients(event.target.value)} maxLength={120} placeholder="Ej. hierro 4 mg, vitamina C 20 mg" /></div>
                  </div>
                </details>
                <button className="btn-flow" type="submit"><Plus size={16} /> Guardar en mi plan</button>
              </form>
              <div className="planned-meals">
                <div className="planned-meals-heading"><h3>Mi plan de comidas</h3><p>Cada plato aparece con su tipo, fecha y costo para que puedas revisar tu semana.</p></div>
                {mealPlans.length ? mealPlans.map((item) => (
                  <div className="planned-meal" key={item.id}>
                    <div><strong>{item.name}</strong><small><span className="planned-meal-type">{mealTypeLabels[item.type] || item.type}</span> · {dateLabel(new Date(`${item.date}T12:00:00`), { weekday: 'short', day: 'numeric', month: 'short' })}</small>{(item.nutrition?.energyKcal != null || item.nutrition?.proteinG != null || item.nutrition?.carbohydratesG != null || item.nutrition?.fatG != null || item.nutrition?.fiberG != null || item.nutrition?.sodiumMg != null || item.nutrition?.addedSugarG != null || item.nutrition?.micronutrients) && <small className="planned-meal-nutrition">Nutrientes registrados: {[[item.nutrition.energyKcal, 'energía', 'kcal'], [item.nutrition.proteinG, 'proteínas', 'g'], [item.nutrition.carbohydratesG, 'carbohidratos', 'g'], [item.nutrition.fatG, 'grasas', 'g'], [item.nutrition.fiberG, 'fibra', 'g'], [item.nutrition.sodiumMg, 'sodio', 'mg'], [item.nutrition.addedSugarG, 'azúcares añadidos', 'g']].filter(([value]) => value != null).map(([value, label, unit]) => `${label} ${value} ${unit}`).concat(item.nutrition.micronutrients || []).join(' · ')}</small>}{item.nutrition?.recommendation && <small className="planned-meal-nutrition"><strong>Recomendación:</strong> {item.nutrition.recommendation}</small>}</div>
                    <strong>{currency(item.cost)}</strong>
                    <button aria-label={`Eliminar ${item.name}`} onClick={() => setMealPlans((current) => current.filter((meal) => meal.id !== item.id))}><Trash2 size={15} /></button>
                  </div>
                )) : <p className="no-events">Agrega una comida o elige una idea para empezar tu plan semanal.</p>}
              </div>
            </article>
          </section>
        )}

        {vista === 'finanzas' && (
          <section className="finance-view">
            <article className="budget-hero">
              <div><span className="section-kicker">PRESUPUESTO MENSUAL</span><label htmlFor="monthly-budget">¿Cuánto tienes disponible este mes?</label></div>
              <div className="budget-input"><span>S/</span><input id="monthly-budget" type="number" min="0" step="0.01" value={ingreso} onChange={(event) => setIngreso(event.target.value)} placeholder="0.00" /></div>
              <div className="budget-balance"><span>Saldo sin asignar</span><strong className={availableBudget < 0 ? 'text-amber' : ''}>{currency(availableBudget)}</strong></div>
            </article>
            <div className="finance-summary-grid">
              <article className="card finance-summary-card"><span>Presupuesto del mes</span><strong>{currency(ingreso)}</strong><small>Tu monto de referencia</small></article>
              <article className="card finance-summary-card"><span>Costos fijos</span><strong>{currency(fixedCostTotal)}</strong><small>{fixedCosts.length} pagos registrados</small></article>
              <article className="card finance-summary-card"><span>Alimentación</span><strong>{currency(foodBudget)}</strong><small>Asignado para tus comidas</small></article>
              <article className="card finance-summary-card"><span>Compras y otros gastos</span><strong>{currency(monthlyExpenses)}</strong><small>Registros de este mes; se consideran en el saldo disponible</small></article>
              <article className="card finance-summary-card"><span>Disponible</span><strong className={availableBudget < 0 ? 'text-amber' : ''}>{currency(availableBudget)}</strong><small>Luego de pagos, alimentación y gastos</small></article>
            </div>
            <div className="finance-view-grid">
              <article className="card fixed-cost-card">
                <div className="section-heading"><div><span className="section-kicker">PAGOS Y VENCIMIENTOS</span><h2><CircleDollarSign size={19} /> Costos fijos</h2></div></div>
                <p className="section-description">Cada vencimiento también aparece como recordatorio en tu calendario.</p>
                <form className="fixed-cost-form" onSubmit={addFixedCost}>
                  <div className="field"><label htmlFor="fixed-name">Concepto</label><input id="fixed-name" value={fixedName} onChange={(event) => setFixedName(event.target.value)} placeholder="Alquiler, servicios…" required /></div>
                  <div className="field"><label htmlFor="fixed-amount">Monto (PEN)</label><input id="fixed-amount" type="number" min="0.01" step="0.01" value={fixedAmount} onChange={(event) => setFixedAmount(event.target.value)} placeholder="0.00" required /></div>
                  <div className="field"><label htmlFor="fixed-due-date">Fecha de vencimiento</label><input id="fixed-due-date" type="date" value={fixedDueDate} onChange={(event) => setFixedDueDate(event.target.value)} required /></div>
                  <button className="btn-flow" type="submit"><Plus size={16} /> Añadir costo</button>
                </form>
                <div className="fixed-cost-list">
                  {fixedCosts.length ? fixedCosts.map((item) => (
                    <div className="fixed-cost-row" key={item.id}>
                      <button className="fixed-cost-date" onClick={() => { setSelectedDate(new Date(`${nextFixedCostDate(item)}T12:00:00`)); setVista('calendario'); }}>
                        <CalendarDays size={17} /><span><strong>{item.name}</strong><small>Vence cada mes · día {fixedCostDay(item)}</small></span>
                      </button>
                      <strong>{currency(item.amount)}</strong>
                      <button className="remove-cost" aria-label={`Eliminar costo ${item.name}`} onClick={() => setFixedCosts((current) => current.filter((cost) => cost.id !== item.id))}><Trash2 size={15} /></button>
                    </div>
                  )) : <p className="no-events">Todavía no has agregado costos fijos.</p>}
                </div>
              </article>
              <aside className="finance-side-column">
                <article className="card daily-expense-finance-card">
                  <div className="section-heading"><div><span className="section-kicker">REGISTRO DE COMPRAS</span><h2><Wallet size={19} /> Gasto diario</h2></div><strong className="expense-total">{currency(dailyExpenseTotal)}</strong></div>
                  <p className="section-description">Estos gastos se descuentan automáticamente del disponible mensual.</p>
                  <form className="finance-expense-form" onSubmit={addDailyExpense}>
                    <div className="field"><label htmlFor="finance-spend-name">Concepto</label><input id="finance-spend-name" value={expenseName} onChange={(event) => setExpenseName(event.target.value)} placeholder="Ej. Medicamentos" required /></div>
                    <div className="field"><label htmlFor="finance-spend-category">Categoría</label><select id="finance-spend-category" value={expenseCategory} onChange={(event) => setExpenseCategory(event.target.value)}>{expenseCategories.map((category) => <option key={category}>{category}</option>)}</select></div>
                    <div className="field"><label htmlFor="finance-spend-amount">Monto (PEN)</label><input id="finance-spend-amount" type="number" min="0.01" step="0.01" value={expenseAmount} onChange={(event) => setExpenseAmount(event.target.value)} placeholder="0.00" required /></div>
                    <button className="btn-flow" type="submit"><Plus size={16} /> Registrar gasto</button>
                  </form>
                  <div className="daily-expense-list">
                    {dailyExpenses.length ? dailyExpenses.map((item) => {
                      const CategoryIcon = expenseCategoryIcons[item.category] || CircleDollarSign;
                      return (
                        <div className="daily-expense-row" key={item.id}>
                          <span className="expense-category-icon"><CategoryIcon size={16} /></span>
                          <span><strong>{item.name}</strong><small>{item.category}</small></span>
                          <strong>{currency(item.amount)}</strong>
                          <button aria-label={`Eliminar gasto ${item.name}`} onClick={() => setExpenses((current) => current.filter((expense) => expense.id !== item.id))}><Trash2 size={14} /></button>
                        </div>
                      );
                    }) : <p className="no-events">Todavía no hay compras registradas hoy.</p>}
                  </div>
                </article>
                <article className="card food-budget-card">
                  <span className="section-kicker">CONECTADO CON BIENESTAR</span>
                  <h2><Salad size={19} /> Presupuesto de alimentación</h2>
                  <p className="section-description">Este monto queda disponible en tu plan semanal de comidas.</p>
                  <label className="field"><span className="field-label">Asignar al mes (PEN)</span><input type="number" min="0" step="0.01" max={Math.max(0, Number(ingreso) - fixedCostTotal)} value={foodBudget} onChange={(event) => setFoodBudget(event.target.value)} /></label>
                  {availableBudget < 0 && <p className="budget-warning" role="status">La suma de tus costos y alimentación supera el presupuesto mensual.</p>}
                  <button className="text-action" onClick={() => setVista('alimentacion')}>Ver mi plan de comidas <ChevronRight size={16} /></button>
                </article>
                <article className="card upcoming-panel">
                  <div className="section-heading"><div><span className="section-kicker">ANTICÍPATE</span><h2><Bell size={18} /> Próximos vencimientos</h2></div></div>
                  {upcomingFixedCosts.length ? upcomingFixedCosts.map((item) => (
                    <button className="upcoming-cost" key={item.id} onClick={() => { setSelectedDate(new Date(`${item.dueDate}T12:00:00`)); setVista('calendario'); }}>
                      <span>{item.name}<small>{dateLabel(new Date(`${item.dueDate}T12:00:00`), { weekday: 'short', day: 'numeric', month: 'short' })}</small></span><strong>{currency(item.amount)}</strong>
                    </button>
                  )) : <p className="no-events">Sin vencimientos durante los próximos 7 días.</p>}
                </article>
              </aside>
            </div>
          </section>
        )}

        {vista === 'analisis' && (
          <section className="analysis-view">
            <div className="metric-card-grid analysis-metrics">
              <article className="metric-box"><span className="metric-label">Hábitos completados hoy</span><div className="metric-val">{completeCount}<small> / {habits.length}</small></div><span className="metric-foot">Avances que marcaste en Inicio</span></article>
              <article className="metric-box"><span className="metric-label">Actividad física hoy</span><div className="metric-val">{todaysExerciseMinutes}<small> min</small></div><span className="metric-foot">{todaysExerciseSessions.length} sesión(es) guardadas</span></article>
              <article className="metric-box"><span className="metric-label">Comidas de hoy</span><div className="metric-val">{mealsToday.length}</div><span className="metric-foot">Comidas en tu plan de alimentación</span></article>
              <article className="metric-box"><span className="metric-label">Gastos de hoy</span><div className="metric-val metric-money">{currency(dailyExpenseTotal)}</div><span className="metric-foot">{dailyExpenses.length} compras registradas en Finanzas</span></article>
            </div>
            <div className="analysis-grid">
              <article className="card analysis-chart-card">
                <div className="section-heading"><div><span className="section-kicker">ÚLTIMOS 7 DÍAS</span><h2><Activity size={19} /> Minutos de actividad física</h2></div></div>
                <BarChart records={weeklyExerciseSummary} />
              </article>
              <article className="card insight-card">
                <div className="insight-head"><span className="insight-badge"><Sparkles size={18} /></span><span className="section-kicker">RESUMEN DE TUS SECCIONES</span></div>
                <h2>Tu información se organiza donde la necesitas.</h2>
                <div className="insight-details">
                  <div><span>Actividad física</span><strong>{exerciseSessions.length ? `${exerciseSessions.length} sesión(es) guardadas` : 'Aún no has guardado sesiones'}</strong></div>
                  <div><span>Alimentación</span><strong>{mealPlans.length ? `${mealPlans.length} comida(s) en tu plan` : 'Aún no has agregado comidas'}</strong></div>
                  <div><span>Calendario</span><strong>{events.length ? `${events.length} evento(s) guardados` : 'Aún no tienes eventos'}</strong></div>
                  <div><span>Finanzas</span><strong>{expenses.length ? `${expenses.length} gasto(s) registrados` : 'Aún no has agregado gastos'}</strong></div>
                </div>
              </article>
            </div>
            <button className="btn-pdf" onClick={descargarPDF}><Download size={17} /> Descargar informe PDF</button>
          </section>
        )}

        {tourStep >= 0 && (
          <div className="tour-backdrop">
            <section className="tour-dialog" role="dialog" aria-modal="true" aria-labelledby="tour-title">
              <div className="tour-topline"><span className="tour-icon"><Sparkles size={19} /></span><span>RECORRIDO GUIADO · {tourStep + 1} DE {tourSteps.length}</span></div>
              <div className="tour-progress">{tourSteps.map((step, index) => <i key={step.title} className={index <= tourStep ? 'visited' : ''} />)}</div>
              <h2 id="tour-title">{tourSteps[tourStep].title}</h2>
              <p>{tourSteps[tourStep].text}</p>
              <div className="tour-actions">
                <button className="tour-skip" onClick={finishTour}>Saltar recorrido</button>
                <div>
                  {tourStep > 0 && <button className="tour-back" onClick={() => setTourStep((step) => step - 1)}>Atrás</button>}
                  <button className="tour-next" onClick={() => tourStep === tourSteps.length - 1 ? finishTour() : setTourStep((step) => step + 1)}>
                    {tourStep === tourSteps.length - 1 ? 'Entrar al panel' : tourStep === 0 ? 'Empezar recorrido' : 'Siguiente'}
                    {tourStep !== tourSteps.length - 1 && <ChevronRight size={16} />}
                  </button>
                </div>
              </div>
              <span className="tour-note">El perfil y tus preferencias se guardan en este dispositivo.</span>
            </section>
          </div>
        )}

        <footer className="app-footer"><span className="footer-brand"><img src="/synclife-logo.png" alt="" />SyncLife OS</span><span>Tu bienestar también merece un buen sistema.</span></footer>
      </main>
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity, ArrowDownRight, ArrowUpRight, BarChart3, Bell, CalendarDays, Clock3,
  Check, CheckCircle2, ChevronLeft, ChevronRight, Circle, CircleDollarSign,
  ClipboardList, CloudSun, Download, Dumbbell, Flame, HelpCircle, Home, LayoutDashboard, LogOut, Pause, Play,
  ListTodo, MapPin, Pencil, Plus, Salad, Save, Sparkles, Star, Target, Trash2, Utensils, Wallet,
  Shirt, Pill, ShoppingBag, Coffee, RefreshCw,
} from 'lucide-react';
import jsPDF from 'jspdf';
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
};

const weekdays = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
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
    return <div className="chart-empty"><BarChart3 size={22} /><span>Guarda tu primer registro para ver aquí tu evolución.</span></div>;
  }

  const max = Math.max(100, ...records.map((record) => Number(record.score) || 0));
  return (
    <div className="bar-chart" role="img" aria-label="Gráfico de barras del rendimiento diario">
      {records.map((record, index) => {
        const value = Number(record.score) || 0;
        return (
          <div className="bar-chart-column" key={`${record.date}-${index}`} title={`${record.date}: ${value} puntos`}>
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

function userStorageKey(name, key) {
  const normalizedName = String(name || '').trim().toLocaleLowerCase('es');
  return `synclife-user:${encodeURIComponent(normalizedName)}:${key}`;
}

function readUserStored(name, key, fallback) {
  try {
    const scopedValue = window.localStorage.getItem(userStorageKey(name, key));
    if (scopedValue !== null) return JSON.parse(scopedValue);
    const lastProfile = readStored(STORAGE_KEYS.profile, { name: 'Nicol' });
    if (String(lastProfile.name || '').trim().toLocaleLowerCase('es') === String(name || '').trim().toLocaleLowerCase('es')) {
      return readStored(key, fallback);
    }
    return fallback;
  } catch (error) {
    console.error(`No se pudo leer ${key} para el perfil ${name}:`, error);
    return fallback;
  }
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

function TrendChart({ records }) {
  const width = 720;
  const height = 220;
  const padding = { top: 16, right: 16, bottom: 32, left: 30 };
  const values = records.map((record) => record.score);
  const min = 0;
  const max = 100;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const points = values.map((value, index) => {
    const x = records.length === 1
      ? padding.left + chartWidth / 2
      : padding.left + (index / (records.length - 1)) * chartWidth;
    const y = padding.top + ((max - value) / (max - min)) * chartHeight;
    return { x, y, value, label: records[index].date };
  });
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
  const area = points.length ? `${path} L ${points[points.length - 1].x} ${height - padding.bottom} L ${points[0].x} ${height - padding.bottom} Z` : '';

  if (!records.length) {
    return <div className="chart-empty"><Activity size={22} /><span>Guarda tu primer registro para ver aquí tu evolución.</span></div>;
  }

  return (
    <div className="trend-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Tendencia de rendimiento diario">
        {[0, 50, 100].map((tick) => {
          const y = padding.top + ((max - tick) / max) * chartHeight;
          return (
            <g key={tick}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} className="chart-grid-line" />
              <text x="0" y={y + 4} className="chart-axis-label">{tick}</text>
            </g>
          );
        })}
        <path d={area} className="chart-area" />
        <path d={path} className="chart-line" />
        {points.map((point, index) => (
          <g key={`${point.label}-${index}`}>
            <circle cx={point.x} cy={point.y} r="4" className="chart-point" />
            <text x={point.x} y={point.y - 11} textAnchor="middle" className="chart-value">{point.value}</text>
            {(records.length < 8 || index === 0 || index === records.length - 1) && (
              <text x={point.x} y={height - 7} textAnchor="middle" className="chart-axis-label">{point.label.slice(5)}</text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

export default function App() {
  const [vista, setVista] = useState('inicio');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginName, setLoginName] = useState('');
  const [showCurtain, setShowCurtain] = useState(false);
  const [profile, setProfile] = useState(() => readStored(STORAGE_KEYS.profile, { name: 'Nicol', onboarded: false }));
  const [tourStep, setTourStep] = useState(() => {
    const savedProfile = readStored(STORAGE_KEYS.profile, { name: 'Nicol', onboarded: false });
    return savedProfile.onboarded ? -1 : 0;
  });
  const [actividad, setActividad] = useState('Desarrollo de plataformas web');
  const [horas, setHoras] = useState(4);
  const [animo, setAnimo] = useState(8);
  const [comidaNombre, setComidaNombre] = useState('Pechuga a la plancha con arroz');
  const [costoComida, setCostoComida] = useState(8.5);
  const [ejercicio, setEjercicio] = useState('');
  const [ejercicioCumplido, setEjercicioCumplido] = useState(false);
  const [duracionEjercicio, setDuracionEjercicio] = useState(30);
  const [intensidadEjercicio, setIntensidadEjercicio] = useState(3);
  const [productividadEjercicio, setProductividadEjercicio] = useState(3);
  const [gastoUSD, setGastoUSD] = useState(10);
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
  const [generatedWorkouts, setGeneratedWorkouts] = useState(() => readUserStored(readStored(STORAGE_KEYS.profile, { name: 'Nicol' }).name, STORAGE_KEYS.generatedWorkouts, null));
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
  const [mealPortion, setMealPortion] = useState('');
  const [mealNutritionEstimate, setMealNutritionEstimate] = useState(null);
  const [mealNutritionError, setMealNutritionError] = useState('');
  const [isEstimatingMealNutrition, setIsEstimatingMealNutrition] = useState(false);

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
  const [history, setHistory] = useState(() => readUserStored(readStored(STORAGE_KEYS.profile, { name: 'Nicol' }).name, STORAGE_KEYS.history, []));
  // Los gastos detallados se guardan junto a las finanzas locales para que el panel y el presupuesto compartan los mismos datos.
  const [expenses, setExpenses] = useState(() => readUserStored(readStored(STORAGE_KEYS.profile, { name: 'Nicol' }).name, STORAGE_KEYS.expenses, []));
  const [expenseName, setExpenseName] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseCategory, setExpenseCategory] = useState(expenseCategories[0]);
  const [selectedWorkoutDay, setSelectedWorkoutDay] = useState(() => (new Date().getDay() + 6) % 7);
  const [selectedRecipeVideo, setSelectedRecipeVideo] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [dataApi, setDataApi] = useState(null);
  const [weatherApi, setWeatherApi] = useState(null);
  const [weatherRefresh, setWeatherRefresh] = useState(0);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState('');
  const [apiError, setApiError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
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
  const latestScore = dataApi?.diagnostico?.score ?? history[history.length - 1]?.score;
  const otherExpense = Number(dataApi?.finanzas?.gastoPEN || 0);
  const foodExpense = Number(costoComida) || 0;
  const expenseTotal = dailyExpenseTotal + (dataApi ? foodExpense + otherExpense : 0);
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
  const averageScore = history.length
    ? Math.round(history.reduce((total, item) => total + item.score, 0) / history.length)
    : null;
  // Recomendaciones explicables que se calculan en el navegador; no se envían datos personales a una IA externa.
  const assistantInsight = availableBudget < 0
    ? 'Tus gastos asignados superan el presupuesto. Revisa las compras del mes y ajusta primero los montos flexibles.'
    : dailyExpenseTotal > 0
      ? `Llevas ${currency(dailyExpenseTotal)} en compras hoy. Registrar cada categoría te ayuda a detectar en qué se va tu dinero.`
      : pendingHabits.length
        ? `Tu siguiente paso sencillo: completar “${pendingHabits[0].name}”. Un hábito pequeño también cuenta.`
        : '¡Buen avance! Hoy completaste tus hábitos. Puedes cerrar el día con una nota en tu registro.';

  useEffect(() => {
    const saved = [
      [STORAGE_KEYS.habits, habits],
      [STORAGE_KEYS.events, events],
      [STORAGE_KEYS.history, history],
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
    ];
    saved.forEach(([key, value]) => {
      try {
        window.localStorage.setItem(userStorageKey(profile.name, key), JSON.stringify(value));
      } catch (error) {
        console.error(`No se pudo guardar ${key} para el perfil ${profile.name}:`, error);
      }
    });
    try {
      window.localStorage.setItem(STORAGE_KEYS.profile, JSON.stringify(profile));
    } catch (error) {
      console.error('No se pudo guardar el último perfil en el almacenamiento local:', error);
    }
  }, [habits, events, history, ingreso, fixedCosts, foodBudget, bodyProfile, workoutPreference, mealPlans, profile, notifiedEvents, expenses, habitDate, generatedWorkouts]);

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
        const response = await fetch(`/api/synclife/weather?city=${encodeURIComponent(ciudad.trim())}`, { signal: controller.signal });
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
    setProfile({ name, onboarded: true });
    setTourStep(-1);
  };

  const enterWorkspace = (event) => {
    event.preventDefault();
    const name = loginName.trim() || profile.name || 'Nicol';
    const userProfile = readUserStored(name, STORAGE_KEYS.profile, { name, onboarded: false });
    const savedHabits = readUserStored(name, STORAGE_KEYS.habits, []);
    const savedBudget = readUserStored(name, STORAGE_KEYS.foodBudget, 0);
    setProfile({ ...userProfile, name });
    setTourStep(userProfile.onboarded ? -1 : 0);
    setHabits(Array.isArray(savedHabits) ? savedHabits : []);
    setEvents(readUserStored(name, STORAGE_KEYS.events, []));
    setHistory(readUserStored(name, STORAGE_KEYS.history, []));
    setIngreso(readUserStored(name, STORAGE_KEYS.income, 0));
    setFixedCosts(readUserStored(name, STORAGE_KEYS.fixedCosts, []));
    setFoodBudget(savedBudget);
    const savedBodyProfile = readUserStored(name, STORAGE_KEYS.bodyProfile, { weight: '', height: '', sex: '', age: '' });
    setBodyProfile({
      ...savedBodyProfile,
      sex: savedBodyProfile.sex === 'mujer' ? 'femenino' : savedBodyProfile.sex === 'hombre' ? 'masculino' : savedBodyProfile.sex,
    });
    setWorkoutPreference(readUserStored(name, STORAGE_KEYS.workoutPreference, 'casa'));
    const savedMeals = readUserStored(name, STORAGE_KEYS.mealPlans, []);
    setMealPlans(Array.isArray(savedMeals) ? savedMeals.filter((meal) => !meal.generatedRecommendation) : []);
    setGeneratedWorkouts(readUserStored(name, STORAGE_KEYS.generatedWorkouts, null));
    setHabitDate(readUserStored(name, STORAGE_KEYS.habitDate, localDate()));
    setNotifiedEvents(readUserStored(name, STORAGE_KEYS.notifiedEvents, []));
    setExpenses(readUserStored(name, STORAGE_KEYS.expenses, []));
    setActividad('Desarrollo de plataformas web');
    setHoras(4);
    setAnimo(8);
    setComidaNombre('Pechuga a la plancha con arroz');
    setCostoComida(8.5);
    setEjercicio('');
    setEjercicioCumplido(false);
    setDuracionEjercicio(30);
    setIntensidadEjercicio(3);
    setProductividadEjercicio(3);
    setGastoUSD(10);
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
    setDataApi(null);
    setWeatherApi(null);
    setApiError('');
    setWorkoutRecommendationMessage('');
    setNotification('');
    setIsLoggedIn(true);
    setShowCurtain(true);
  };

  const switchUser = () => {
    setIsLoggedIn(false);
    setShowCurtain(false);
    setLoginName('');
    setNotificationsOpen(false);
    setTourStep(-1);
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
      setApiError('Escribe el concepto y un monto válido para registrar el gasto.');
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
    setApiError('');
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
    setMealNutritionError('');
    setMealFiber('');
    setMealSodium('');
    setMealAddedSugar('');
    setMealMicronutrients('');
  };

  const estimateMealNutrition = async () => {
    if (!mealName.trim() || !mealPortion.trim()) {
      setMealNutritionError('Escribe el alimento y la porción antes de pedir la estimación.');
      return;
    }

    setIsEstimatingMealNutrition(true);
    setMealNutritionError('');
    try {
      const response = await fetch('/api/synclife/ai/nutrition-estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ food: mealName.trim(), portion: mealPortion.trim(), mealType }),
      });
      const responseText = await response.text();
      let result;
      try {
        result = JSON.parse(responseText);
      } catch {
        throw new Error('El backend no devolvió una respuesta válida. Comprueba que esté iniciado e inténtalo otra vez.');
      }
      if (!response.ok) throw new Error(result.error || 'No se pudo estimar la nutrición.');

      setMealFiber(result.fiberG == null ? '' : String(result.fiberG));
      setMealSodium(result.sodiumMg == null ? '' : String(result.sodiumMg));
      setMealAddedSugar(result.addedSugarG == null ? '' : String(result.addedSugarG));
      setMealMicronutrients(result.micronutrients || '');
      setMealNutritionEstimate({
        source: result.source,
        estimatedAt: result.estimatedAt,
        basis: result.basis,
      });
    } catch (error) {
      console.error('No se pudo estimar la nutrición de la comida:', error);
      setMealNutritionError(error.message || 'No se pudo conectar con el servicio de IA.');
    } finally {
      setIsEstimatingMealNutrition(false);
    }
  };

  const addMealPlan = (event) => {
    event.preventDefault();
    const cost = Number(mealCost);
    if (!mealName.trim() || !Number.isFinite(cost) || cost < 0 || !mealDate) return;
    const optionalAmount = (value) => value === '' ? null : Number(value);
    const fiber = optionalAmount(mealFiber);
    const sodium = optionalAmount(mealSodium);
    const addedSugar = optionalAmount(mealAddedSugar);
    if ([fiber, sodium, addedSugar].some((value) => value !== null && (!Number.isFinite(value) || value < 0))) return;
    setMealPlans((current) => [...current, {
      id: `${Date.now()}`,
      type: mealType,
      name: mealName.trim(),
      cost,
      date: mealDate,
      nutrition: {
        fiberG: fiber,
        sodiumMg: sodium,
        addedSugarG: addedSugar,
        micronutrients: mealMicronutrients.trim(),
        portion: mealPortion.trim(),
        source: mealNutritionEstimate?.source || 'Registro manual',
        estimatedAt: mealNutritionEstimate?.estimatedAt || null,
        basis: mealNutritionEstimate?.basis || '',
      },
    }].sort((first, second) => first.date.localeCompare(second.date)));
    setNotification(`${mealTypeLabels[mealType] || mealType} añadido a tu plan para el ${dateLabel(new Date(`${mealDate}T12:00:00`), { day: 'numeric', month: 'long' })}.`);
    setMealName('');
    setMealCost('');
    setMealFiber('');
    setMealSodium('');
    setMealAddedSugar('');
    setMealMicronutrients('');
    setMealPortion('');
    setMealNutritionEstimate(null);
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
    setGeneratedWorkouts({
      home,
      gym,
      intensity: lowImpact ? 'Bajo impacto y progresión gradual' : 'Intensidad moderada y progresiva',
      bmiContext: bmi >= 30 || bmi < 18.5,
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
      const response = await fetch('/api/synclife/ai/workout-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: bodyProfile, preference: workoutPreference }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'La IA no pudo crear la rutina.');
      setGeneratedWorkouts(result);
      setWorkoutRecommendationMessage(`Rutina semanal personalizada generada con ${result.provider || 'IA'} para casa y gimnasio.`);
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

  const synchronize = async () => {
    const payload = {
      ciudad,
      montoUSD: Number(gastoUSD),
      comidaDetalle: comidaNombre,
      costoComidaPEN: Number(costoComida),
      animoValor: Number(animo),
      horasEnfoque: Number(horas),
      actividadNombre: actividad,
      ejercicioCliente: ejercicioCumplido
        ? `${ejercicio} · ${Number(duracionEjercicio) || 0} min · intensidad ${intensidadEjercicio}/5 · productividad percibida ${productividadEjercicio}/5`
        : 'No realizó ejercicio hoy',
      ejercitado: ejercicioCumplido,
    };

    try {
      const response = await fetch('/api/synclife/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'No se pudo sincronizar con el servidor.');
      }

      setDataApi(result);
      setApiError('');
      return result;
    } catch (error) {
      console.error('No se pudo conectar con el backend de SyncLife:', error);
      const fallbackScore = Math.min(100, Math.max(15, (Number(payload.horasEnfoque) || 0) * 10 + (Number(payload.animoValor) || 0) * 2 + (Number(payload.ejercitado) ? 20 : 5) + (Number(payload.costoComidaPEN) <= 15 ? 20 : 10)));
      const fallback = {
        actividadNombre: payload.actividadNombre,
        diagnostico: {
          score: fallbackScore,
          resumen: fallbackScore >= 80 ? 'Día de alto rendimiento y enfoque estratégico excelente.' : 'Día productivo estable con margen de mejora en gestión de tiempo.',
        },
        finanzas: {
          montoUSD: Number(payload.montoUSD) || 0,
          gastoPEN: ((Number(payload.montoUSD) || 0) * 3.75).toFixed(2),
          tasa: 3.75,
          source: 'estimación local',
          stale: true,
        },
        clima: {
          ciudad: payload.ciudad || 'Cusco',
          temp: null,
          source: 'sin conexión',
          stale: true,
        },
        nutricion: {
          alimento: payload.comidaDetalle || 'Comida del día',
          calorias: 220,
          source: 'estimación local',
          stale: true,
        },
        serviciosDisponibles: false,
      };

      setDataApi(fallback);
      setApiError('No se pudo conectar con el backend. Se guardó un cálculo local aproximado; clima, tipo de cambio y nutrición no se consultaron.');
      return fallback;
    }
  };

  const handleGuardar = async (event) => {
    event.preventDefault();
    if (!actividad.trim() || !comidaNombre.trim()) {
      setApiError('Completa la actividad y la comida antes de guardar.');
      return;
    }
    setIsSaving(true);
    setApiError('');
    try {
      if (eventoNombre.trim()) {
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
        let reminderMessage = `${profile.name}, guardé "${nextEvent.name}" en tu calendario de este dispositivo.`;
        const reminderTime = new Date(`${nextEvent.date}T${nextEvent.start}:00`);
        const isReminderUpcoming = !nextEvent.allDay && reminderTime > new Date();
        if (isReminderUpcoming && 'Notification' in window && Notification.permission === 'default') {
          const permission = await Notification.requestPermission();
          if (permission !== 'granted') reminderMessage += ' Activa las notificaciones del navegador para recibir el aviso.';
        } else if (isReminderUpcoming && (!('Notification' in window) || Notification.permission !== 'granted')) {
          reminderMessage += ' El recordatorio en pantalla funcionará mientras la página esté abierta.';
        }
        setNotification(reminderMessage);
      }
      const result = await synchronize();
      const record = {
        date: localDate(),
        score: Number(result.diagnostico.score),
        exercise: ejercicioCumplido ? ejercicio : '',
        exerciseMinutes: ejercicioCumplido ? Number(duracionEjercicio) || 0 : 0,
        exerciseIntensity: ejercicioCumplido ? Number(intensidadEjercicio) : null,
        exerciseProductivity: ejercicioCumplido ? Number(productividadEjercicio) : null,
      };
      setHistory((current) => [...current.filter((item) => item.date !== record.date), record].slice(-30));
      setVista('analisis');
    } catch (error) {
      console.error('Error al guardar el registro diario:', error);
      setApiError('No se pudo guardar el registro. Revisa la conexión y vuelve a intentarlo.');
    } finally {
      setIsSaving(false);
    }
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
      addParagraph(`Perfil: ${profile.name}  |  Fecha del registro: ${dateLabel(new Date(`${localDate()}T12:00:00`), { day: 'numeric', month: 'long', year: 'numeric' })}`);
      addParagraph(`Puntaje de bienestar: ${dataApi?.diagnostico?.score ?? latestScore ?? 'Sin registro'} / 100`);
      addParagraph(`Presupuesto mensual: ${currency(ingreso)}  |  Disponible estimado: ${currency(availableBudget)}`);
      addParagraph(`Compras y otros gastos del mes: ${currency(monthlyExpenses)}  |  Compras registradas hoy: ${currency(dailyExpenseTotal)}`);
      if (dataApi?.diagnostico?.resumen) addParagraph(`Lectura del día: ${dataApi.diagnostico.resumen}`);

      addSection('Gastos registrados');
      if (expenses.length) {
        expenses.slice(0, 30).forEach((item) => {
          addParagraph(`${item.date}  |  ${item.category}  |  ${item.name}  |  ${currency(item.amount)}`, 9);
        });
      } else {
        addParagraph('No hay gastos diarios categorizados guardados.');
      }

      addSection('Rutinas del día');
      habits.forEach((habit) => addParagraph(`${habit.complete ? '[COMPLETADO]' : '[PENDIENTE]'}  ${habit.name} — ${habit.detail}`, 9));

      addSection('Historial de rendimiento');
      if (history.length) {
        history.slice(-30).forEach((item) => addParagraph(`${item.date}  |  Puntaje: ${item.score}/100${item.exercise ? `  |  Ejercicio: ${item.exercise} (${item.exerciseMinutes} min)` : ''}`, 9));
      } else {
        addParagraph('Aún no hay registros históricos guardados.');
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
      setApiError('No se pudo generar el PDF. Inténtalo de nuevo.');
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

  const openRegistration = () => {
    setEventoFecha(localDate(selectedDate));
    setVista('registro');
  };

  const currentEvents = events.filter((event) => event.date === localDate(selectedDate));
  const currentFixedCosts = fixedCosts.filter((item) => (
    Math.min(fixedCostDay(item), new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 0).getDate()) === selectedDate.getDate()
  ));
  const currentMeals = mealPlans.filter((item) => item.date === localDate(selectedDate));
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
    { id: 'registro', label: 'Registro', icon: ClipboardList },
    { id: 'analisis', label: 'Análisis', icon: BarChart3 },
  ];
  const tourSteps = [
    { title: `¡Hola, ${profile.name || 'Nicol'}!`, text: 'Este es tu espacio personal. El nombre se guarda solo en este navegador; no es una cuenta ni una contraseña.' },
    { title: 'Tu panel de un vistazo', text: 'Desde el inicio puedes entrar al calendario, bienestar y finanzas; también verás un resumen del día.' },
    { title: 'Registra ejercicio y enfoque', text: 'En Registro diario anota qué actividad hiciste, cuántos minutos, la intensidad y cómo sentiste tu productividad.' },
    { title: 'Eventos y recordatorios', text: 'Añade un evento con hora. Si permites las notificaciones, recibirás un aviso personalizado mientras la página esté abierta.' },
    { title: 'Analiza tu evolución', text: 'El análisis muestra tus registros y el diagnóstico actual. La productividad del ejercicio es tu autoevaluación, no una medición automática.' },
  ];
  const backdropIcons = {
    inicio: LayoutDashboard,
    calendario: CalendarDays,
    'actividad-fisica': Activity,
    alimentacion: Salad,
    finanzas: Wallet,
    registro: ClipboardList,
    analisis: BarChart3,
  };
  const ScreenBackdropIcon = backdropIcons[vista] || LayoutDashboard;

  if (!isLoggedIn) {
    return (
      <main className="login-screen">
        <div className="login-backdrop-orb login-orb-one" />
        <div className="login-backdrop-orb login-orb-two" />
        <div className="login-icon login-icon-calendar"><CalendarDays /></div>
        <div className="login-icon login-icon-activity"><Activity /></div>
        <div className="login-icon login-icon-food"><Salad /></div>
        <div className="login-icon login-icon-finance"><Wallet /></div>
        <form className="login-card" onSubmit={enterWorkspace}>
          <img className="login-logo" src="/synclife-logo.png" alt="Logo de SyncLife OS" />
          <div className="login-icon-row" aria-hidden="true">
            {[CalendarDays, Activity, Salad, Wallet].map((Icon, index) => (
              <span className={`login-icon-badge login-icon-badge-${index}`} key={index}><Icon size={17} /></span>
            ))}
          </div>
          <span className="section-kicker">TU ESPACIO PERSONAL</span>
          <h1>Bienvenido a SyncLife</h1>
          <p>Organiza tus hábitos, tu bienestar y tus finanzas en un solo lugar.</p>
          <label className="login-field" htmlFor="login-name">¿Cómo te llamamos?</label>
          <input id="login-name" maxLength={40} autoComplete="name" value={loginName} onChange={(event) => setLoginName(event.target.value)} placeholder={profile.name || 'Escribe tu nombre'} />
          <button className="login-submit" type="submit">Ingresar <ChevronRight size={17} /></button>
          <small>Acceso personal en este dispositivo; tus datos permanecen en el navegador.</small>
        </form>
      </main>
    );
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
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setVista('inicio'); }}>
          <img className="brand-logo" src="/synclife-logo.png" alt="" />
          <span>SyncLife<span className="brand-light"> OS</span></span>
        </a>

        <div className="workspace-label">ESPACIO PERSONAL</div>
        <nav className="sidebar-btns" aria-label="Navegación principal">
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
        </nav>

        <div className="sidebar-card">
          <div className="sidebar-card-icon"><Target size={17} /></div>
          <p>Tu progreso, a tu ritmo</p>
          <span>Pequeños pasos, grandes cambios.</span>
          <div className="sidebar-progress"><i style={{ width: `${completionRate}%` }} /></div>
          <small>{completionRate}% de tareas completadas hoy</small>
        </div>

        <div className="sidebar-bottom">
          <div className="avatar">{profile.name.charAt(0).toUpperCase()}</div>
          <div><strong>{profile.name}</strong><span>Plan personal</span></div>
          <button className="profile-edit" aria-label="Repetir recorrido guiado" data-tooltip="Repetir recorrido guiado" onClick={() => setTourStep(0)}><HelpCircle size={16} /></button>
          <button className="profile-edit" aria-label="Cambiar de usuario" data-tooltip="Cambiar de usuario" onClick={switchUser}><LogOut size={16} /></button>
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
              registro: `${profile.name}, tu día con intención`,
              analisis: `Tu progreso, ${profile.name}`,
            })[vista]}</h1>
            <p>{({
              inicio: 'Una vista clara de tu tiempo, tu bienestar y tu presupuesto.',
              calendario: 'Eventos, rutinas, comidas y vencimientos en una sola agenda.',
              'actividad-fisica': 'Organiza tus rutinas y preferencias de entrenamiento.',
              alimentacion: 'Planifica tus comidas y revisa tus recomendaciones.',
              finanzas: 'Planifica tu presupuesto mensual y anticipa tus próximos pagos.',
              registro: 'Registra tu día para actualizar tu resumen personal.',
              analisis: 'Consulta los datos de tus registros sincronizados.',
            })[vista]}</p>
          </div>
          <div className="header-actions">
            <div className="api-status"><span className={`status-dot ${apiError ? 'is-error' : dataApi ? 'is-online' : ''}`} />{apiError ? 'Revisar conexión' : dataApi ? 'Datos sincronizados' : 'Listo para sincronizar'}</div>
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

        {apiError && <div className="alert-banner" role="alert"><span>{apiError}</span><button onClick={() => setApiError('')} aria-label="Cerrar alerta">×</button></div>}
        {notification && <div className="toast-message" role="status">{notification}<button onClick={() => setNotification('')} aria-label="Cerrar notificación">×</button></div>}

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
                <span className="metric-label">Rendimiento diario</span>
                <div className="metric-val">{latestScore == null ? '—' : `${latestScore}`}<small>{latestScore == null ? 'Sin registro' : '/ 100'}</small></div>
                <span className="metric-foot">{latestScore == null ? 'Guarda tu día para comenzar' : 'Puntaje de tu último registro'}</span>
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
                <span className="metric-label">{weatherApi?.ciudad || dataApi?.clima?.ciudad || ciudad}</span>
                <div className="metric-val">{(weatherApi || dataApi?.clima)?.temp == null ? '—' : `${(weatherApi || dataApi.clima).temp}°`}<small>{(weatherApi || dataApi?.clima)?.temp == null ? (weatherLoading ? 'Consultando' : '') : 'C'}</small></div>
                <span className="metric-foot">{weatherError || (weatherApi || dataApi?.clima)?.warning || (weatherApi || dataApi?.clima)?.source || (weatherLoading ? 'Consultando proveedores del clima' : 'Sin dato actual')}{(weatherApi || dataApi?.clima)?.stale ? ' · dato de respaldo' : ''}</span>
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
                <button className="text-action" onClick={() => setVista('registro')}>Registrar mi día <ChevronRight size={16} /></button>
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
                  <div><span className="section-kicker">TUS DATOS, SIN SUPOSICIONES</span><h2><BarChart3 size={19} /> Tendencia de rendimiento</h2></div>
                  <span className="period-tag">Últimos registros</span>
                </div>
                <div className="chart-legend"><span><i /> Puntaje diario</span>{averageScore != null && <span>Promedio: <strong>{averageScore}</strong></span>}</div>
                <TrendChart records={history.slice(-7)} />
              </article>

              <article className="card calendar-panel">
                <div className="section-heading">
                  <div><span className="section-kicker">PLANIFICACIÓN</span><h2><CalendarDays size={19} /> Calendario</h2></div>
                  <button className="small-add" onClick={openRegistration}><Plus size={15} /> Evento</button>
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
                  <div className="event-date-heading"><span>{dateLabel(selectedDate, { weekday: 'short', day: 'numeric', month: 'short' })}</span><button onClick={openRegistration}><Plus size={15} /> Añadir</button></div>
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
                <button className="small-add" onClick={openRegistration}><Plus size={15} /> Nuevo evento</button>
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
                  <button className="small-add" onClick={openRegistration}><Plus size={15} /> Añadir</button>
                </div>
                <div className="day-weather">
                  <CloudSun size={20} />
                  <div><strong>{(weatherApi || dataApi?.clima) ? `${(weatherApi || dataApi.clima).temp == null ? '—' : `${(weatherApi || dataApi.clima).temp}°C`} · ${(weatherApi || dataApi.clima).ciudad}` : `Clima de ${ciudad}`}</strong><span>{weatherError || (weatherApi || dataApi?.clima)?.warning || (weatherApi || dataApi?.clima)?.source || (weatherLoading ? 'Consultando proveedores del clima' : 'Sin dato actual')}{(weatherApi || dataApi?.clima)?.stale ? ' · dato de respaldo' : ''}</span></div>
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
                <div><h3>Elige la categoría</h3><p>Selecciona el tipo de comida y completa sus datos en el formulario de registro.</p></div>
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
                <div><h3>Registra tu comida</h3><p>Indica la categoría, el alimento, la porción, la fecha y el costo. Luego puedes pedirle a la IA una estimación nutricional y revisarla antes de guardar.</p></div>
              </div>
              <form className="meal-entry-form" onSubmit={addMealPlan}>
                <div className="field"><label htmlFor="meal-date">Fecha</label><input id="meal-date" type="date" value={mealDate} onChange={(event) => setMealDate(event.target.value)} required /></div>
                <div className="field"><label htmlFor="meal-type">Tipo de comida</label><select id="meal-type" value={mealType} disabled={isEstimatingMealNutrition} onChange={(event) => { if (event.target.value !== mealType) clearMealNutritionEstimate(); setMealType(event.target.value); }}>{mealTypes.map((type) => <option key={type} value={type}>{mealTypeLabels[type]}</option>)}</select></div>
                <div className="field"><label htmlFor="meal-name">Alimento o plato</label><input id="meal-name" value={mealName} disabled={isEstimatingMealNutrition} onChange={(event) => { if (event.target.value !== mealName) clearMealNutritionEstimate(); setMealName(event.target.value); }} placeholder="Ej. arroz, pollo y ensalada" required /></div>
                <div className="field"><label htmlFor="meal-portion">Porción o cantidad</label><input id="meal-portion" value={mealPortion} disabled={isEstimatingMealNutrition} onChange={(event) => { if (event.target.value !== mealPortion) clearMealNutritionEstimate(); setMealPortion(event.target.value); }} placeholder="Ej. 1 plato (350 g)" /></div>
                <div className="field"><label htmlFor="meal-cost">Costo estimado del plato (PEN)</label><input id="meal-cost" type="number" min="0" step="0.1" value={mealCost} onChange={(event) => setMealCost(event.target.value)} placeholder="0.00" required /></div>
                <details className="meal-nutrition-details">
                  <summary><Activity size={15} /> Estimar nutrientes con IA o ingresarlos manualmente</summary>
                  <p>Especifica alimento e ingredientes y una porción aproximada para obtener una estimación más útil. La IA no reemplaza una etiqueta nutricional y sus resultados pueden variar.</p>
                  <button className="estimate-nutrients-button" type="button" onClick={estimateMealNutrition} disabled={isEstimatingMealNutrition || !mealName.trim() || !mealPortion.trim()}>
                    <Sparkles size={15} /> {isEstimatingMealNutrition ? 'Estimando nutrientes…' : 'Estimar con IA'}
                  </button>
                  {mealNutritionError && <p className="nutrition-estimate-message is-error" role="alert">{mealNutritionError}</p>}
                  {mealNutritionEstimate && <p className="nutrition-estimate-message" role="status">Estimación de {mealNutritionEstimate.source} lista. Revísala y corrige los campos si hace falta antes de guardar. Los valores que la IA no pudo estimar quedan vacíos.{mealNutritionEstimate.basis ? ` Supuesto: ${mealNutritionEstimate.basis}` : ''}</p>}
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
                    <div><strong>{item.name}</strong><small><span className="planned-meal-type">{mealTypeLabels[item.type] || item.type}</span> · {dateLabel(new Date(`${item.date}T12:00:00`), { weekday: 'short', day: 'numeric', month: 'short' })}</small>{(item.nutrition?.fiberG != null || item.nutrition?.sodiumMg != null || item.nutrition?.addedSugarG != null || item.nutrition?.micronutrients) && <small className="planned-meal-nutrition">Nutrientes registrados: {item.nutrition.fiberG != null ? `fibra ${item.nutrition.fiberG} g` : ''}{item.nutrition.sodiumMg != null ? `${item.nutrition.fiberG != null ? ' · ' : ''}sodio ${item.nutrition.sodiumMg} mg` : ''}{item.nutrition.addedSugarG != null ? `${item.nutrition.fiberG != null || item.nutrition.sodiumMg != null ? ' · ' : ''}azúcares añadidos ${item.nutrition.addedSugarG} g` : ''}{item.nutrition.micronutrients ? `${item.nutrition.fiberG != null || item.nutrition.sodiumMg != null || item.nutrition.addedSugarG != null ? ' · ' : ''}${item.nutrition.micronutrients}` : ''}</small>}</div>
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

        {vista === 'registro' && (
          <form className="registration-layout" onSubmit={handleGuardar}>
            <section className="card registration-form">
              <div className="section-heading">
                <div><span className="section-kicker">REGISTRO DIARIO</span><h2><ClipboardList size={19} /> Tu bienestar en un solo lugar</h2></div>
                <span className="local-tag">Sincronización segura</span>
              </div>
              <p className="section-description">Al guardar, SyncLife consulta las APIs de clima, conversión de moneda y nutrición, y registra tu resumen diario.</p>

              <div className="form-section">
                <h3><Target size={17} /> Enfoque y movimiento</h3>
                <div className="form-grid">
                  <div className="field field-wide"><label htmlFor="activity">Actividad principal</label><input id="activity" value={actividad} onChange={(event) => setActividad(event.target.value)} required /></div>
                  <div className="field"><label htmlFor="hours">Horas de enfoque</label><input id="hours" type="number" min="0" max="24" step="0.5" value={horas} onChange={(event) => setHoras(event.target.value)} /></div>
                  <div className="field"><label htmlFor="mood">Ánimo de hoy (1–10)</label><input id="mood" type="number" min="1" max="10" value={animo} onChange={(event) => setAnimo(event.target.value)} /></div>
                </div>
              </div>

              <div className="form-section exercise-section">
                <h3><Dumbbell size={17} /> Ejercicio <span className="optional-label">opcional</span></h3>
                <label className={`exercise-check ${ejercicioCumplido ? 'checked' : ''}`}>
                  <input type="checkbox" checked={ejercicioCumplido} onChange={(event) => setEjercicioCumplido(event.target.checked)} />
                  <span className="habit-check">{ejercicioCumplido && <Check size={14} />}</span>
                  <span><strong>¿Hiciste ejercicio hoy?</strong><small>Marca esta casilla para registrar tu sesión.</small></span>
                </label>
                {ejercicioCumplido ? (
                  <div className="exercise-entry">
                    <div className="exercise-entry-heading">
                      <strong>Cuéntame qué hiciste</strong>
                      <span>Tu registro se guardará en tu historial</span>
                    </div>
                    <div className="field">
                      <label htmlFor="exercise">¿Qué ejercicios o actividad realizaste?</label>
                      <textarea
                        id="exercise"
                        value={ejercicio}
                        onChange={(event) => setEjercicio(event.target.value)}
                        placeholder="Por ejemplo: 20 min de bicicleta y 3 series de 12 sentadillas"
                        required={ejercicioCumplido}
                        rows={3}
                      />
                      <small className="field-hint">Puedes anotar el tipo de ejercicio, ejercicios, series o distancia.</small>
                    </div>
                    <div className="form-grid">
                      <div className="field"><label htmlFor="exercise-duration">¿Cuánto tiempo? (minutos)</label><input id="exercise-duration" type="number" min="1" max="600" value={duracionEjercicio} onChange={(event) => setDuracionEjercicio(event.target.value)} required={ejercicioCumplido} /></div>
                      <div className="field"><label htmlFor="exercise-intensity">¿Qué intensidad tuvo? (1–5)</label><select id="exercise-intensity" value={intensidadEjercicio} onChange={(event) => setIntensidadEjercicio(event.target.value)}><option value="1">1 · Suave</option><option value="2">2 · Ligera</option><option value="3">3 · Moderada</option><option value="4">4 · Intensa</option><option value="5">5 · Muy intensa</option></select></div>
                      <div className="field field-wide"><label htmlFor="exercise-productivity">¿Cómo sentiste tu sesión? (1–5)</label><select id="exercise-productivity" value={productividadEjercicio} onChange={(event) => setProductividadEjercicio(event.target.value)}><option value="1">1 · Me costó mucho avanzar</option><option value="2">2 · Avancé un poco</option><option value="3">3 · Sesión normal</option><option value="4">4 · Buena sesión</option><option value="5">5 · Excelente, cumplí mi objetivo</option></select><small className="field-hint">Es tu autoevaluación; no cambia el puntaje calculado por el backend.</small></div>
                    </div>
                  </div>
                ) : (
                  <p className="exercise-empty">Activa la casilla cuando quieras anotar una actividad. No se registrará ejercicio si la dejas desmarcada.</p>
                )}
              </div>

              <div className="form-section">
                <h3><Utensils size={17} /> Alimentación</h3>
                <div className="form-grid">
                  <div className="field"><label htmlFor="meal">Comida del día</label><input id="meal" value={comidaNombre} onChange={(event) => setComidaNombre(event.target.value)} required /></div>
                  <div className="field"><label htmlFor="food-cost">Costo de comida (PEN)</label><input id="food-cost" type="number" min="0" step="0.01" value={costoComida} onChange={(event) => setCostoComida(event.target.value)} /></div>
                </div>
              </div>

              <div className="form-section">
                <h3><Wallet size={17} /> Finanzas y ubicación</h3>
                <div className="form-grid">
                  <div className="field"><label htmlFor="usd-spend">Gasto adicional (USD)</label><input id="usd-spend" type="number" min="0" step="0.01" value={gastoUSD} onChange={(event) => setGastoUSD(event.target.value)} /></div>
                  <div className="field"><label htmlFor="city">Ciudad para consultar clima</label><div className="input-icon"><MapPin size={16} /><input id="city" value={ciudad} onChange={(event) => setCiudad(event.target.value)} /></div></div>
                  <div className="field"><label htmlFor="income">Ingreso mensual (PEN)</label><input id="income" type="number" min="0" step="0.01" value={ingreso} onChange={(event) => setIngreso(event.target.value)} /></div>
                </div>
              </div>

              <div className="form-section event-form-section">
                <h3><CalendarDays size={17} /> Evento del calendario <span className="optional-label">opcional</span></h3>
                <div className="form-grid">
                  <div className="field"><label htmlFor="event-name">Nombre del evento</label><input id="event-name" placeholder="Ej. Revisión de proyecto" value={eventoNombre} onChange={(event) => setEventoNombre(event.target.value)} /></div>
                  <div className="field"><label htmlFor="event-date">Fecha</label><input id="event-date" type="date" value={eventoFecha} onChange={(event) => setEventoFecha(event.target.value)} /></div>
                  <div className="field"><label htmlFor="event-status">Estado de la actividad</label><select id="event-status" value={statusSelect} onChange={(event) => setStatusSelect(event.target.value)}><option value="amber">En proceso</option><option value="green">Completado</option><option value="red">Pendiente / incumplido</option></select></div>
                  <div className="field"><label htmlFor="event-mode">Duración</label><select id="event-mode" value={eventMode} onChange={(event) => setEventMode(event.target.value)}><option value="horas">Horario específico</option><option value="allday">Todo el día</option></select></div>
                  {eventMode === 'horas' && <><div className="field"><label htmlFor="event-start">Hora de inicio</label><input id="event-start" type="time" value={horaIn} onChange={(event) => setHoraIn(event.target.value)} /></div><div className="field"><label htmlFor="event-end">Hora de fin</label><input id="event-end" type="time" value={horaOut} onChange={(event) => setHoraOut(event.target.value)} /></div></>}
                </div>
              </div>
              <button className="btn-flow" type="submit" disabled={isSaving}><Save size={17} />{isSaving ? 'Sincronizando...' : 'Guardar día y actualizar estadísticas'}</button>
            </section>

            <aside className="registration-aside">
              <section className="card api-card">
                <span className="api-card-icon"><Sparkles size={20} /></span>
                <span className="section-kicker">SYNC LIFE INTELLIGENCE</span>
                <h3>Un panorama más completo de tu día.</h3>
                <p>Al guardar, estas fuentes ayudan a enriquecer tu resumen:</p>
                <ul>
                  <li><CloudSun size={16} /><span><strong>Open-Meteo</strong><small>Proveedor principal del clima</small></span><CheckCircle2 size={15} /></li>
                  <li><CloudSun size={16} /><span><strong>wttr.in</strong><small>Proveedor alternativo automático</small></span><CheckCircle2 size={15} /></li>
                  <li><CircleDollarSign size={16} /><span><strong>Tipo de cambio</strong><small>ExchangeRate-API con respaldo Frankfurter</small></span><CheckCircle2 size={15} /></li>
                  <li><Salad size={16} /><span><strong>Open Food Facts</strong><small>Información nutricional</small></span><CheckCircle2 size={15} /></li>
                </ul>
              </section>
              <section className="card preview-card">
                <span className="section-kicker">RESUMEN RÁPIDO</span>
                <div className="preview-item"><Clock3 size={17} /><span>Enfoque estimado</span><strong>{Number(horas) || 0} h</strong></div>
                <div className="preview-item"><Dumbbell size={17} /><span>Ejercicio</span><strong className={ejercicioCumplido ? 'text-green' : 'text-amber'}>{ejercicioCumplido ? `${duracionEjercicio} min` : 'No registrado'}</strong></div>
                {ejercicioCumplido && <div className="preview-item"><Star size={17} /><span>Productividad percibida</span><strong>{productividadEjercicio}/5</strong></div>}
                <div className="preview-item"><ArrowDownRight size={17} /><span>Gasto conocido</span><strong>{currency(foodExpense)}</strong></div>
              </section>
            </aside>
          </form>
        )}

        {vista === 'analisis' && (
          <section className="analysis-view">
            {!dataApi ? (
              <div className="card empty-analysis"><BarChart3 size={30} /><h2>Aún no hay un registro sincronizado</h2><p>Guarda tu día para consultar las métricas calculadas por las APIs.</p><button className="btn-flow" onClick={() => setVista('registro')}>Ir al registro diario <ChevronRight size={17} /></button></div>
            ) : (
              <>
                <div className="metric-card-grid analysis-metrics">
                  <article className="metric-box"><span className="metric-label">Puntaje de hoy</span><div className="metric-val">{dataApi.diagnostico.score}<small>/ 100</small></div><span className="metric-foot">Rendimiento personal estimado</span></article>
                  <article className="metric-box"><span className="metric-label">Gasto convertido</span><div className="metric-val metric-money">{currency(dataApi.finanzas.gastoPEN)}</div><span className="metric-foot">{Number(gastoUSD) || 0} USD · {dataApi.finanzas.source || 'tipo de cambio no identificado'}{dataApi.finanzas.stale ? ' (dato de respaldo)' : ''}</span></article>
                  <article className="metric-box"><span className="metric-label">Clima en {dataApi.clima.ciudad}</span><div className="metric-val">{dataApi.clima.temp == null ? '—' : `${dataApi.clima.temp}°`}<small>{dataApi.clima.temp == null ? '' : 'C'}</small></div><span className="metric-foot">{dataApi.clima.source || 'Fuente no identificada'}{dataApi.clima.stale ? ' (dato de respaldo)' : ''}</span></article>
                </div>
                <div className="analysis-grid">
                  <article className="card analysis-chart-card"><div className="section-heading"><div><span className="section-kicker">HISTORIAL GUARDADO</span><h2><Activity size={19} /> Evolución del rendimiento</h2></div></div><BarChart records={history.slice(-7)} /></article>
                  <article className="card insight-card">
                    <div className="insight-head"><span className="insight-badge"><Sparkles size={18} /></span><span className="section-kicker">RESUMEN DE HOY</span></div>
                    <h2>{dataApi.diagnostico.resumen}</h2>
                    <div className="insight-details">
                      <div><span>Actividad</span><strong>{dataApi.actividadNombre} · {horas} h</strong></div>
                      <div><span>Alimentación</span><strong>{dataApi.nutricion.alimento} · {dataApi.nutricion.calorias} kcal aprox. · {dataApi.nutricion.source || 'estimación local'}{dataApi.nutricion.stale ? ' (estimación)' : ''}</strong></div>
                      <div><span>Ejercicio</span><strong>{ejercicioCumplido ? `${ejercicio} · ${duracionEjercicio} min · intensidad ${intensidadEjercicio}/5` : 'No realizó ejercicio hoy'}</strong></div>
                      {ejercicioCumplido && <div><span>Productividad del ejercicio</span><strong>{productividadEjercicio}/5 · Autoevaluación personal</strong></div>}
                      <div><span>Gasto del día</span><strong>{currency(expenseTotal)} PEN aprox.</strong></div>
                    </div>
                    <div className="data-disclaimer"><Circle size={13} /> Nutrición estimada por producto. La productividad del ejercicio es una autoevaluación y no forma parte del puntaje del backend.</div>
                  </article>
                </div>
                <button className="btn-pdf" onClick={descargarPDF}><Download size={17} /> Descargar informe PDF</button>
              </>
            )}
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

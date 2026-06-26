import React, { useState } from "react";

const STORAGE_KEY = "daogreen-client-guide-hidden";

function guideHiddenFor(projectId) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const ids = JSON.parse(raw);
    return Array.isArray(ids) && ids.includes(projectId);
  } catch {
    return false;
  }
}

function hideGuideFor(projectId) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    const next = Array.isArray(ids) ? [...new Set([...ids, projectId])] : [projectId];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export default function ClientPurchaseGuide({ projectId, itemCount, uniqueCount }) {
  const [hidden, setHidden] = useState(() => (projectId ? guideHiddenFor(projectId) : false));
  const [expanded, setExpanded] = useState(true);

  if (hidden) return null;

  const merged = uniqueCount != null && itemCount != null && uniqueCount < itemCount;

  const dismiss = () => {
    if (projectId) hideGuideFor(projectId);
    setHidden(true);
  };

  return (
    <div className="client-guide no-print">
      <div className="client-guide__head">
        <div className="client-guide__title">Как пользоваться списком закупки</div>
        <div className="client-guide__actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Свернуть" : "Развернуть"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={dismiss}>
            Понятно, скрыть
          </button>
        </div>
      </div>
      {expanded && (
        <>
          <p className="client-guide__lead">
            Это ваш рабочий список материалов по ферме. Отмечайте статусы по ходу закупки — прогресс сохраняется
            автоматически, можно вернуться к ссылке с телефона или компьютера.
          </p>
          <div className="client-guide__grid">
            <section className="client-guide__block">
              <div className="client-guide__block-title">1. Выберите вид списка</div>
              <ul className="client-guide__list">
                <li>
                  <strong>По разделам</strong> — полный список по блокам фермы (полив, электрика, стеллажи…). Удобно
                  закупать поэтапно.
                </li>
                <li>
                  <strong>Списком</strong> — те же позиции, сгруппированы по крупным категориям (сантехника, электрика,
                  климат…). Стеллажи здесь не дублируются — смотрите их в «По разделам».
                </li>
                <li>
                  <strong>По поставщикам</strong> — аккордеон по магазинам: все блоки свёрнуты, нажмите на поставщика,
                  чтобы развернуть его позиции.
                </li>
                <li>
                  <strong>Сантехник</strong> — срез для сантехника по разделам полива и дренажа.
                </li>
                <li>
                  <strong>С ссылкой / Без ссылки</strong> — быстро найти позиции, где уже есть ссылка на товар, или где
                  ссылку ещё нужно подобрать.
                </li>
                <li>
                  <strong>Заказано</strong> — всё, что вы уже отметили статусом «Заказано» (ожидает доставки).
                </li>
              </ul>
            </section>
            <section className="client-guide__block">
              <div className="client-guide__block-title">2. Купите и отметьте статус</div>
              <ul className="client-guide__list">
                <li>Нажмите <strong>«Купить»</strong> или ссылку на товар — откроется магазин.</li>
                <li>
                  После оплаты нажмите <strong>«Заказано»</strong> — позиция уйдёт из основного списка, её можно
                  посмотреть во вкладке «Заказано» или включив «Показать заказанные и купленные».
                </li>
                <li>
                  Когда товар получен — <strong>«Куплено»</strong> или <strong>«Доставлено»</strong>.
                </li>
                <li>Если нужна помощь с подбором — <strong>«Нужна помощь»</strong>.</li>
              </ul>
            </section>
            <section className="client-guide__block">
              <div className="client-guide__block-title">3. Поиск и фильтры</div>
              <ul className="client-guide__list">
                <li>
                  Строка <strong>поиска</strong> ищет по названию и поставщику.
                </li>
                <li>
                  Выпадающий список <strong>«Поставщик»</strong> оставляет только позиции одного магазина.
                </li>
                <li>
                  Переключатель <strong>«Таблица / Карточки»</strong> — компактный вид для больших списков.
                </li>
              </ul>
            </section>
            <section className="client-guide__block">
              <div className="client-guide__block-title">4. Документы</div>
              <ul className="client-guide__list">
                <li>
                  Вкладка <strong>«Документы»</strong> — Excel-книга и PDF для передачи специалистам или печати.
                </li>
                <li>
                  {merged
                    ? `Одинаковые позиции с разных стеллажей уже объединены (${itemCount} → ${uniqueCount} строк).`
                    : "Одинаковые позиции с разных стеллажей объединяются автоматически — без дублирования."}
                </li>
              </ul>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

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
            Это ваш рабочий список материалов по ферме. Отмечайте статусы по ходу закупки — прогресс сохраняется автоматически. К ссылке можно вернуться с телефона или компьютера.
          </p>
          <div className="client-guide__grid">
            <section className="client-guide__block">
              <div className="client-guide__block-title">1. Выберите вид списка</div>
              <ul className="client-guide__list">
                <li>
                  <strong>По разделам</strong> — полный список по блокам фермы: полив, электрика, стеллажи, климат.
                </li>
                <li>
                  <strong>Списком</strong> — общий объединённый список без дублей.
                </li>
                <li>
                  <strong>По поставщикам</strong> — позиции сгруппированы по магазинам.
                </li>
                <li>
                  <strong>Сантехник</strong> — отдельный список по поливу и дренажу.
                </li>
                <li>
                  <strong>С ссылкой / Без ссылки</strong> — быстрый поиск позиций со ссылками или без них.
                </li>
                <li>
                  <strong>Заказано/Куплено</strong> — всё, что уже в работе или получено.
                </li>
              </ul>
            </section>
            <section className="client-guide__block">
              <div className="client-guide__block-title">2. Купите и отметьте статус</div>
              <ul className="client-guide__list">
                <li>Нажмите <strong>«Купить»</strong> или ссылку на товар — откроется магазин.</li>
                <li>После оплаты отметьте <strong>«Заказано»</strong>.</li>
                <li>После получения отметьте <strong>«Куплено»</strong>.</li>
                <li>Если товар уже есть на объекте — отметьте <strong>«Уже есть»</strong>.</li>
                <li>Если нужна помощь с подбором — нажмите <strong>«Нужна помощь»</strong>.</li>
              </ul>
            </section>
            <section className="client-guide__block">
              <div className="client-guide__block-title">3. Поиск и фильтры</div>
              <ul className="client-guide__list">
                <li>Поиск работает по названию и поставщику.</li>
                <li>Фильтр <strong>«Поставщик»</strong> оставляет товары одного магазина.</li>
                <li>Переключатель <strong>«Таблица / Карточки»</strong> помогает выбрать удобный вид.</li>
              </ul>
            </section>
            <section className="client-guide__block">
              <div className="client-guide__block-title">4. Документы</div>
              <ul className="client-guide__list">
                <li>Во вкладке <strong>«Документы»</strong> доступны PDF и Excel. Их можно передать специалистам или использовать для закупки.</li>
                <li>Одинаковые позиции с разных стеллажей объединяются автоматически.</li>
              </ul>
            </section>
            <section className="client-guide__block">
              <div className="client-guide__block-title">5. Цена уточняется</div>
              <ul className="client-guide__list">
                <li><strong>Цена уточняется</strong> — это значит, что позиция рассчитана автоматически или требует ручного подбора. Итоговая стоимость будет согласована отдельно.</li>
              </ul>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

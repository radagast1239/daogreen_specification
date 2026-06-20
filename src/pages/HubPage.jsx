import React from "react";
import { Link } from "react-router-dom";
import AppModeNav from "../components/AppModeNav.jsx";

const CARDS = [
  {
    id: "spec",
    to: "/",
    tag: "BOM · закупка",
    title: "Спецификации",
    text: "Конструктор проекта, стеллажи, разделы фермы, клиентские ссылки и чек-лист закупки.",
    cta: "Открыть спецификации",
    accent: "spec",
  },
  {
    id: "economic",
    to: "/tools/economic",
    tag: "Салаты · экономика",
    title: "Калькулятор посадки",
    text: "Площадь, полезная площадь, посадка 110×55 и экономика вертикальной фермы.",
    cta: "Считать салаты",
    accent: "eco",
  },
  {
    id: "berry",
    to: "/tools/berry",
    tag: "Клубника · ягоды",
    title: "Калькулятор ягод",
    text: "Сорта, плотность, урожайность, волны, упаковка — прогноз производства клубники.",
    cta: "Считать ягоды",
    accent: "berry",
  },
];

export default function HubPage() {
  return (
    <div className="app-frame app-frame--hub">
      <AppModeNav active="hub" />
      <div className="hub-page">
        <section className="hub-hero">
          <p className="hub-hero__eyebrow">Daogreen · вертикальные фермы</p>
          <h1 className="hub-hero__title">
            Расчёт, спецификация и закупка — в одном месте
          </h1>
          <p className="hub-hero__sub">
            Три инструмента для проектирования фермы: от урожая и экономики до списка оборудования для клиента.
          </p>
        </section>

        <div className="hub-grid">
          {CARDS.map((c) => (
            <Link key={c.id} to={c.to} className={`hub-card hub-card--${c.accent}`}>
              <span className="hub-card__tag">{c.tag}</span>
              <h2>{c.title}</h2>
              <p>{c.text}</p>
              <span className="hub-card__cta">{c.cta} →</span>
            </Link>
          ))}
        </div>

        <p className="hub-foot muted">
          Спецификации требуют входа администратора. Калькуляторы доступны без регистрации.
        </p>
      </div>
    </div>
  );
}

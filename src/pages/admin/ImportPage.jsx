import React from "react";
import { PageHeader } from "../../components/Layout.jsx";
import ExcelImportPanel from "../../components/ExcelImportPanel.jsx";

export default function ImportPage() {
  return (
    <>
      <PageHeader
        title="Импорт Excel"
        sub="Загрузка справочника материалов и автоматическое извлечение фото из ячеек таблицы"
        back={{ to: "/", label: "Проекты" }}
      />
      <div className="content">
        <ExcelImportPanel />
      </div>
    </>
  );
}

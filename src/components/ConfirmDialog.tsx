"use client";

// Modal genérico de confirmação (ex: "tem certeza que deseja excluir?"),
// reutilizado em várias páginas para evitar ações destrutivas acidentais.

interface Props {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title = "Confirmar ação",
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  danger = true,
  onConfirm,
  onCancel,
}: Props) {
  // Quando "open" é falso, o diálogo simplesmente não é renderizado (nenhum overlay/modal na tela).
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5 shadow-lg"
      >
        <h2 id="confirm-dialog-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
          {title}
        </h2>
        {/* whitespace-pre-line: alguns chamadores montam a mensagem em vários
            parágrafos (ex: mover transação para a família, que precisa listar o
            que se perde). Para mensagem de uma linha só não muda nada. */}
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 whitespace-pre-line">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-3 py-1.5 text-sm font-medium rounded-md text-white ${
              danger ? "bg-red-600 hover:bg-red-700" : "bg-indigo-600 hover:bg-indigo-700"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

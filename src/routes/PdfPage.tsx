import { useToast } from "../context/ToastContext";

export default function PdfPage() {
  const showToast = useToast();
  return (
    <div className="card space-y-3">
      <h3 className="text-lg font-semibold">Program PDF</h3>
      <p className="text-sm">Link Your Privately-Owned PDF Here. We Don't Redistribute Content. In Production We'll Support A Coach-Only Setting To Store The URL Safely.</p>
      <a
        className="underline text-plred"
        href="#"
        onClick={(e) => { e.preventDefault(); showToast("Coach will configure the PDF link in settings.", "info"); }}
      >
        Open PDF
      </a>
    </div>
  );
}

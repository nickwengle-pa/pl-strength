
export default function Sheets() {
  return (
    <div className="card space-y-3">
      <h3 className="text-lg font-semibold">Sheets (Printable / Fillable)</h3>
      <p className="text-sm">In v1, this will generate Week 1–4 logs as PDFs with your calculated weights. For now, this is a placeholder page while we wire pdf-lib.</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <button className="btn-primary">Create Week 1 PDF</button>
        <button className="btn-primary">Create Week 2 PDF</button>
        <button className="btn-primary">Create Week 3 PDF</button>
        <button className="btn-primary">Create Week 4 PDF</button>
      </div>
    </div>
  );
}

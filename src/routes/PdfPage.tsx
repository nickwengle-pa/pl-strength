
export default function PdfPage() {
  return (
    <div className="card space-y-3">
      <h3 className="text-lg font-semibold">Program PDF</h3>
      <p className="text-sm">Link Your Privately-Owned PDF Here. We Don’t Redistribute Content. In Production We’ll Support A Coach-Only Setting To Store The URL Safely.</p>
      <a className="underline text-plred" href="#" onClick={(e)=>{e.preventDefault(); alert('Coach Will Configure The PDF Link In Settings.');}}>Open PDF</a>
    </div>
  );
}

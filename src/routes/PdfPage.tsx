
export default function PdfPage() {
  return (
    <div className="card space-y-3">
      <h3 className="text-lg font-semibold">Program PDF</h3>
      <p className="text-sm">Link your privately-owned PDF here. We don’t redistribute content. In production we’ll support a coach-only setting to store the URL safely.</p>
      <a className="underline text-plred" href="#" onClick={(e)=>{e.preventDefault(); alert('Coach will configure the PDF link in settings.');}}>Open PDF</a>
    </div>
  );
}

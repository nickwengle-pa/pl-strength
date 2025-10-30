
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadProfile, saveProfile } from '../lib/storage';

export default function Login() {
  const nav = useNavigate();
  const [firstName, setFirstName] = useState('');
  const [unit, setUnit] = useState<'lb'|'kg'>('lb');

  useEffect(() => {
    const p = loadProfile();
    if (p) nav('/home');
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim()) return;
    saveProfile({ firstName: firstName.trim(), unit, tm: {}, oneRm: {} });
    nav('/home');
  };

  return (
    <div className="max-w-md mx-auto mt-10 card">
      <div className="flex items-center gap-3 mb-3">
        <img src="/icons/icon-96.png" className="w-10 h-10" />
        <h1 className="text-xl font-bold">Welcome to PL Strength</h1>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">First name</label>
          <input className="w-full border rounded-xl px-3 py-2" value={firstName} onChange={e=>setFirstName(e.target.value)} placeholder="e.g., Alex" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Units</label>
          <div className="flex gap-3">
            <label className="flex items-center gap-1"><input type="radio" checked={unit==='lb'} onChange={()=>setUnit('lb')} /> lb</label>
            <label className="flex items-center gap-1"><input type="radio" checked={unit==='kg'} onChange={()=>setUnit('kg')} /> kg</label>
          </div>
        </div>
        <button className="btn-primary w-full" type="submit">Enter</button>
        <p className="text-xs text-gray-600">Coach-managed mode: No emails, just a local profile for now. We’ll enable PIN logins when Firebase keys are added.</p>
      </form>
    </div>
  );
}

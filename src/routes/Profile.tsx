
import { useEffect, useState } from 'react';
import { loadProfile, saveProfile } from '../lib/storage';
import { saveProfileRemote, loadProfileRemote } from '../lib/db';

export default function Profile() {
  const [firstName, setFirstName] = useState('');
  const [unit, setUnit] = useState<'lb'|'kg'>('lb');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const remote = await loadProfileRemote();
      const local = loadProfile();
      const p = remote || local;
      if (p) {
        setFirstName(p.firstName || '');
        setUnit(p.unit || 'lb');
      }
    })();
  }, []);

  async function save() {
    setSaving(true);
    const profile = { firstName: firstName.trim() || 'Athlete', unit, tm: (loadProfile()?.tm)||{} };
    saveProfile(profile as any);
    try { await saveProfileRemote(profile as any); } catch {}
    setSaving(false);
    alert('Profile saved.');
  }

  function clearLocal() {
    localStorage.removeItem('pl-strength/profile');
    alert('Local profile cleared. Reload and sign in again if needed.');
  }

  return (
    <div className="card space-y-4">
      <h3 className="text-lg font-semibold">Profile</h3>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm">First name</label>
        <input className="border rounded-xl px-2 py-1" value={firstName} onChange={e=>setFirstName(e.target.value)} placeholder="e.g., Alex" />

        <label className="text-sm">Units</label>
        <select className="border rounded-xl px-2 py-1" value={unit} onChange={e=>setUnit(e.target.value as any)}>
          <option value="lb">lb</option>
          <option value="kg">kg</option>
        </select>
      </div>

      <div className="flex gap-3">
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button>
        <button className="rounded-2xl px-4 py-3 border" onClick={clearLocal}>Clear local profile</button>
      </div>

      <p className="text-xs text-gray-600">
        Saving writes to your device and to Firestore. Coaches will see your first name in the roster after you save.
      </p>
    </div>
  );
}

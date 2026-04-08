'use client';

import { useState, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function LoginForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const next         = searchParams.get('next') || '/dashboard';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (res.ok) {
        router.push(next);
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error || 'Incorrect password');
        setPassword('');
      }
    } catch {
      setError('Connection error — try again');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center"
         style={{ background: '#f4f6f9' }}>
      <div className="w-full max-w-sm">

        {/* Logo / header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
               style={{ background: '#1e3a5f' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8"
                 className="w-7 h-7">
              <path d="M3 22V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/>
              <path d="M3 22h12"/>
              <path d="M15 8h2a2 2 0 0 1 2 2v6a1 1 0 0 0 2 0V9l-3-3"/>
              <rect x="6" y="9" width="6" height="5" rx="1"/>
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900">Redan Sales Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Sign in to access the dashboard</p>
        </div>

        {/* Card */}
        <div className="bg-white border border-[#e5e7eb] rounded-2xl p-8 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">

            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase
                                tracking-wide mb-1.5">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Enter your username"
                required
                autoFocus
                autoComplete="username"
                className="w-full h-10 px-3 text-sm border border-[#e5e7eb] rounded-lg
                           focus:outline-none focus:border-indigo-400 focus:ring-1
                           focus:ring-indigo-100 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase
                                tracking-wide mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                autoComplete="current-password"
                className="w-full h-10 px-3 text-sm border border-[#e5e7eb] rounded-lg
                           focus:outline-none focus:border-indigo-400 focus:ring-1
                           focus:ring-indigo-100 transition"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200
                              text-red-700 text-xs px-3 py-2 rounded-lg">
                <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 flex-shrink-0">
                  <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.75 4a.75.75 0 011.5 0v4a.75.75 0 01-1.5 0V5zm.75 7.5a1 1 0 110-2 1 1 0 010 2z"/>
                </svg>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !password}
              className="w-full h-10 text-sm font-semibold text-white rounded-lg
                         transition-all disabled:opacity-50 disabled:cursor-not-allowed
                         flex items-center justify-center gap-2"
              style={{ background: '#1e3a5f' }}
            >
              {loading
                ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white
                                    rounded-full animate-spin" /> Signing in…</>
                : 'Sign In'}
            </button>

          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Redan Sales Dashboard Platform — Internal Use Only
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

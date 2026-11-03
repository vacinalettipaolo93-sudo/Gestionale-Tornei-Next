import React, { useState } from 'react';
import { type Player, type User } from '../types';
import { findLoginUser } from '../utils/playerLogin';

interface LoginProps {
  users: User[];
  players: Player[];
  onLoginSuccess: (user: User) => void;
}

const NextTsLogo: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg viewBox="0 0 360 120" className={className} aria-label="NEXT TS logo" role="img">
    <text x="0" y="78" fill="#9B1C12" fontSize="76" fontWeight="700" fontFamily="Arial, Helvetica, sans-serif">
      NEXT
    </text>
    <polygon points="208,34 246,54 208,74" fill="#9B1C12" />
    <circle cx="286" cy="64" r="32" fill="none" stroke="#3E4148" strokeWidth="7" />
    <text x="263" y="75" fill="#3E4148" fontSize="28" fontWeight="700" fontFamily="Arial, Helvetica, sans-serif">
      TS
    </text>
  </svg>
);

const Login: React.FC<LoginProps> = ({ users, players, onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const user = findLoginUser(users, players, username, password);
    if (user) {
      onLoginSuccess(user);
    } else {
      setError('Username o password non validi.');
    }
  };

  return (
    <div className="min-h-screen bg-primary text-text-primary flex flex-col items-center justify-center p-4 animate-fadeIn">
      <div className="w-full max-w-4xl flex flex-col items-center">
        <div className="flex flex-col items-center mb-8 text-center w-full">
          <NextTsLogo className="w-52 sm:w-64 md:w-72 h-auto mb-3" />
          <p className="text-text-secondary text-lg">Accedi per continuare</p>
        </div>

        <div className="w-full max-w-sm sm:max-w-md md:max-w-lg bg-secondary p-8 rounded-xl shadow-2xl border border-tertiary/50">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-text-secondary">
                Username
              </label>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                required
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="mt-1 block w-full bg-primary border border-tertiary rounded-lg p-3 text-text-primary focus:ring-2 focus:ring-accent focus:border-accent"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-text-secondary">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="mt-1 block w-full bg-primary border border-tertiary rounded-lg p-3 text-text-primary focus:ring-2 focus:ring-accent focus:border-accent"
              />
            </div>

            {error && <p className="text-sm text-red-400 text-center">{error}</p>}

            <div>
              <button
                type="submit"
                className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-lg shadow-highlight/20 text-sm font-medium text-white bg-highlight hover:bg-highlight/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-secondary focus:ring-highlight transition-all"
              >
                Accedi
              </button>
            </div>
          </form>
        </div>

        <div className="text-center mt-4 text-xs text-text-secondary/50">
          <p>
            Partecipante: <strong>Nome Cognome</strong> / <strong>1234</strong>
            {' '}(oppure la password personale, se modificata)
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  FlaskConical,
  Layers3,
  LockKeyhole,
  Mail,
  User,
  WalletCards,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from './api';
import type { Profile } from './api';
import { symbols } from './api';
import { AssetIcon, Logo, Notice } from './components';
import './auth.css';

function AuthStory() {
  return (
    <section className="auth-story" aria-label="About ChainTrade">
      <header className="auth-story-top">
        <Logo />
        <span className="auth-mode">
          <FlaskConical size={14} aria-hidden="true" /> Virtual funds only
        </span>
      </header>
      <div className="auth-story-body">
        <div className="auth-intro">
          <h1>
            Practice crypto <span>trading.</span>
          </h1>
          <p>Build a portfolio across simulated crypto markets on a local Ethereum blockchain.</p>
        </div>
        <div className="auth-showcase">
          <div className="auth-credit">
            <WalletCards size={24} strokeWidth={1.55} aria-hidden="true" />
            <div className="auth-credit-amount">
              <span>Starting balance</span>
              <strong>
                10,000 <small>CST</small>
              </strong>
            </div>
            <div className="auth-token-scene" aria-hidden="true">
              <div className="auth-token auth-token-under" />
              <div className="auth-token auth-token-top">
                <div className="auth-token-face">
                  <Layers3 strokeWidth={1.15} />
                </div>
              </div>
            </div>
          </div>
          <div className="auth-assets">
            <span>Simulated assets</span>
            <ul>
              {symbols.map((symbol) => (
                <li key={symbol}>
                  <AssetIcon symbol={symbol} /> {symbol}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <footer className="auth-story-footer">the trading website you needed</footer>
    </section>
  );
}

export function AuthPage({ register }: { register: boolean }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [fields, setFields] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const mutation = useMutation({
    mutationFn: () =>
      api<Profile>(
        '/auth/' + (register ? 'register' : 'login'),
        register ? fields : { email: fields.email, password: fields.password },
      ),
    onSuccess: (user) => {
      if (register) sessionStorage.setItem('chaintrade.starterCredit', user.id);
      client.setQueryData(['/auth/me'], user);
      navigate('/', { replace: true });
    },
    onError: (error: ApiError) =>
      setErrors(
        error.fields && Object.keys(error.fields).length ? error.fields : { form: error.message },
      ),
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (mutation.isPending) return;
    const next: Record<string, string> = {};
    if (register && fields.name.trim().length < 2) next.name = 'Enter your full name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email.trim()))
      next.email = 'Enter a valid email address.';
    if (register && fields.password.length < 10) next.password = 'Use at least 10 characters.';
    else if (!fields.password) next.password = 'Enter your password.';
    else if (new TextEncoder().encode(fields.password).length > 72)
      next.password = 'Use at most 72 bytes.';
    if (register && fields.password !== fields.confirmPassword)
      next.confirmPassword = 'Passwords must match.';
    setErrors(next);
    if (!Object.keys(next).length) mutation.mutate();
  }
  function field(key: keyof typeof fields, label: string, type: string, autocomplete: string) {
    const Icon = key === 'name' ? User : key === 'email' ? Mail : LockKeyhole;
    return (
      <div className="field">
        <label htmlFor={key}>{label}</label>
        <div className="auth-input">
          <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
          <input
            id={key}
            name={key}
            type={type}
            autoComplete={autocomplete}
            maxLength={key === 'name' ? 80 : 254}
            value={fields[key]}
            aria-invalid={Boolean(errors[key])}
            aria-describedby={errors[key] ? key + '-error' : undefined}
            onChange={(event) => {
              setFields({ ...fields, [key]: event.target.value });
              setErrors({ ...errors, [key]: '', form: '' });
            }}
          />
        </div>
        {errors[key] && (
          <small id={key + '-error'} className="field-error">
            {errors[key]}
          </small>
        )}
      </div>
    );
  }
  return (
    <main className="auth-page">
      <AuthStory />
      <section className="auth-entry" aria-labelledby="auth-entry-title">
        <div className="auth-entry-card">
          <h2 id="auth-entry-title">{register ? 'Create an account' : 'Sign in'}</h2>
          <p>
            {register
              ? 'Your ChainTrade wallet starts with 10,000 virtual CST.'
              : 'Access your portfolio and simulated markets.'}
          </p>
          <form noValidate onSubmit={submit}>
            {errors.form && <Notice>{errors.form}</Notice>}
            {register && field('name', 'Full name', 'text', 'name')}
            {field('email', 'Email address', 'email', 'email')}
            {field(
              'password',
              'Password',
              'password',
              register ? 'new-password' : 'current-password',
            )}
            {register && field('confirmPassword', 'Confirm password', 'password', 'new-password')}
            <button className="btn primary auth-submit" disabled={mutation.isPending}>
              {mutation.isPending
                ? register
                  ? 'Setting up your wallet…'
                  : 'Signing in…'
                : register
                  ? 'Create account'
                  : 'Sign in'}
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          </form>
          <p className="auth-switch">
            {register ? 'Already registered?' : 'New to ChainTrade?'}{' '}
            <Link className="text-link" to={register ? '/login' : '/register'}>
              {register ? 'Sign in' : 'Create an account'}
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}

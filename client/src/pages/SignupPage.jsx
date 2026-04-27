import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { signup } from '../api/client';
import { SignInPage } from '../components/ui/sign-in';

export function SignupPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const redirect = searchParams.get('redirect') || '/';
  const [message, setMessage] = useState('');

  useEffect(() => {
    document.title = 'Sign up — Pornwrld';
  }, []);

  async function onSubmit({ username, email, password, password2 }) {
    setMessage('');
    if (password.length < 8) {
      setMessage('Password must be at least 8 characters');
      return;
    }
    if (password !== password2) {
      setMessage('Passwords do not match');
      return;
    }
    const res = await signup({
      username: username.trim(),
      password,
      ...(email.trim() ? { email: email.trim() } : {}),
    });
    if (res.ok) {
      navigate(redirect);
      return;
    }
    const err = res.data?.error || 'Sign up failed';
    setMessage(typeof err === 'string' ? err : 'Sign up failed');
  }

  const loginHref = '/login' + (searchParams.toString() ? '?' + searchParams.toString() : '');

  return (
    <SignInPage
      mode="signup"
      title="Sign up"
      description="Create your Pornwrld account and unlock referral tracking, profile tabs, and social linking."
      alertMessage={message}
      onBack={() => navigate('/')}
      onSubmit={onSubmit}
      onDiscordSignIn={() => { window.location.href = '/auth/discord'; }}
      onGoogleSignIn={() => { window.location.href = '/auth/google'; }}
      onAltAction={() => navigate(loginHref)}
    />
  );
}

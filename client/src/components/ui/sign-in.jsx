import { Eye, EyeOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

const FEATURE_PREVIEWS = [
  {
    title: 'Category rails like homepage',
    description: 'Quickly browse trending categories and jump straight into matching content.',
    image:
      'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1400&q=80',
  },
  {
    title: 'Account profile customization',
    description: 'Manage banner, avatar, socials, referral progress, and your personal media tabs.',
    image:
      'https://images.unsplash.com/photo-1551650975-87deedd944c3?auto=format&fit=crop&w=1400&q=80',
  },
  {
    title: 'Shorts + watch flow',
    description: 'Fast-loading preview playback with smooth transitions for mobile-first discovery.',
    image:
      'https://images.unsplash.com/photo-1542744173-8e7e53415bb0?auto=format&fit=crop&w=1400&q=80',
  },
];

function GoogleIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-2.641-.21-5.236-.611-7.743z" />
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C42.022 35.026 44 30.038 44 24c0-2.641-.21-5.236-.611-7.743z" />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"
      />
    </svg>
  );
}

export function SignInPage({
  mode = 'signup',
  title = 'Sign up',
  description = 'Create your account and continue.',
  alertMessage = '',
  onBack,
  onSubmit,
  onGoogleSignIn,
  onDiscordSignIn,
  onAltAction,
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [showPassword2, setShowPassword2] = useState(false);
  const [featureIndex, setFeatureIndex] = useState(0);
  const [form, setForm] = useState({
    username: '',
    email: '',
    password: '',
    password2: '',
  });

  useEffect(() => {
    const interval = window.setInterval(() => {
      setFeatureIndex((current) => (current + 1) % FEATURE_PREVIEWS.length);
    }, 4300);
    return () => window.clearInterval(interval);
  }, []);

  const isSignup = mode === 'signup';
  const activeFeature = useMemo(() => FEATURE_PREVIEWS[featureIndex] ?? FEATURE_PREVIEWS[0], [featureIndex]);

  function onFieldChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit?.(form);
  }

  return (
    <section className="signup-page" aria-label="Authentication">
      <div className="signup-page__shell signup-page__shell--full">
        <div className="auth-showcase">
          <div className="auth-showcase__form-col">
            <button type="button" className="pw-btn pw-btn--compact pw-btn--inline" onClick={onBack}>
              ← Back
            </button>

            <h1 className="auth-showcase__title">{title}</h1>
            <p className="auth-showcase__subtitle">{description}</p>

            {alertMessage ? (
              <div className="signup-page__alert" role="alert">
                {alertMessage}
              </div>
            ) : null}

            <form className="auth-showcase__form" onSubmit={handleSubmit}>
              {isSignup ? (
                <label className="signup-page__field">
                  <span className="signup-page__label">Username</span>
                  <input
                    className="signup-page__input"
                    name="username"
                    value={form.username}
                    minLength={3}
                    autoComplete="username"
                    onChange={onFieldChange}
                    required
                  />
                </label>
              ) : null}

              <label className="signup-page__field">
                <span className="signup-page__label">
                  Email {isSignup ? <small className="signup-page__label-optional">(optional)</small> : null}
                </span>
                <input
                  className="signup-page__input"
                  name="email"
                  type="email"
                  value={form.email}
                  autoComplete="email"
                  placeholder="you@example.com"
                  onChange={onFieldChange}
                  required={!isSignup}
                />
              </label>

              <label className="signup-page__field">
                <span className="signup-page__label">Password</span>
                <div className="auth-showcase__input-wrap">
                  <input
                    className="signup-page__input"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                    autoComplete={isSignup ? 'new-password' : 'current-password'}
                    minLength={isSignup ? 8 : 6}
                    onChange={onFieldChange}
                    required
                  />
                  <button
                    className="auth-showcase__eye-btn"
                    type="button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword((current) => !current)}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>

              {isSignup ? (
                <label className="signup-page__field">
                  <span className="signup-page__label">Confirm Password</span>
                  <div className="auth-showcase__input-wrap">
                    <input
                      className="signup-page__input"
                      name="password2"
                      type={showPassword2 ? 'text' : 'password'}
                      value={form.password2}
                      autoComplete="new-password"
                      minLength={8}
                      onChange={onFieldChange}
                      required
                    />
                    <button
                      className="auth-showcase__eye-btn"
                      type="button"
                      aria-label={showPassword2 ? 'Hide confirm password' : 'Show confirm password'}
                      onClick={() => setShowPassword2((current) => !current)}
                    >
                      {showPassword2 ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </label>
              ) : null}

              <button className="pw-btn pw-btn--block" type="submit">
                {isSignup ? 'Create Account' : 'Sign In'}
              </button>
            </form>

            <div className="signup-page__divider">
              <span>Or Sign Up / In With...</span>
            </div>
            <div className="signup-page__socials">
              <button className="pw-btn pw-btn--block pw-btn--social" type="button" onClick={onDiscordSignIn}>
                <DiscordIcon />
                <span>Discord</span>
              </button>
              <button className="pw-btn pw-btn--block pw-btn--social" type="button" onClick={onGoogleSignIn}>
                <GoogleIcon />
                <span>Google</span>
              </button>
            </div>

            <div className="signup-page__login-link">
              <span>{isSignup ? 'Already have an account?' : "Don't have an account?"}</span>
              <button type="button" className="pw-btn pw-btn--compact pw-btn--inline" onClick={onAltAction}>
                {isSignup ? 'Log in' : 'Create account'}
              </button>
            </div>
          </div>

          <div className="auth-showcase__feature-col" aria-live="polite">
            <div
              className="auth-showcase__feature-image"
              style={{ backgroundImage: `linear-gradient(180deg, rgba(7,8,14,0.2), rgba(6,6,10,0.7)), url("${activeFeature.image}")` }}
            />
            <div className="auth-showcase__feature-meta">
              <h2>{activeFeature.title}</h2>
              <p>{activeFeature.description}</p>
              <div className="auth-showcase__dots">
                {FEATURE_PREVIEWS.map((slide, index) => (
                  <button
                    key={slide.title}
                    type="button"
                    className={`auth-showcase__dot${featureIndex === index ? ' is-active' : ''}`}
                    aria-label={`Show preview ${index + 1}`}
                    onClick={() => setFeatureIndex(index)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

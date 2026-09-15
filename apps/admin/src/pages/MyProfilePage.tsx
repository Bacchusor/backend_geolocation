import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { passwordChangeSchema, profileUpdateSchema, type ProfileUpdate } from '@georeminder/shared';
import type { z } from 'zod';
import { api } from '../api';
import { Alert, Badge, Field, errorMessage, fmtDate } from '../components/ui';

export function MyProfilePage() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me-profile'], queryFn: api.me.get, retry: false });
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const form = useForm<z.input<typeof profileUpdateSchema>, unknown, ProfileUpdate>({
    resolver: zodResolver(profileUpdateSchema),
  });
  const pw = useForm<
    z.input<typeof passwordChangeSchema>,
    unknown,
    z.output<typeof passwordChangeSchema>
  >({
    resolver: zodResolver(passwordChangeSchema),
    defaultValues: { current_password: '', new_password: '' },
  });

  useEffect(() => {
    if (me.data)
      form.reset({ display_name: me.data.display_name, preferences: me.data.preferences });
  }, [me.data, form]);

  const save = useMutation({
    mutationFn: api.me.update,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me-profile'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
      setMsg({ kind: 'ok', text: 'Profile saved' });
    },
    onError: (err) => setMsg({ kind: 'err', text: errorMessage(err) }),
  });
  const changePw = useMutation({
    mutationFn: (v: { current_password: string; new_password: string }) =>
      api.me.changePassword(v.current_password, v.new_password),
    onSuccess: () => {
      pw.reset();
      setMsg({ kind: 'ok', text: 'Password changed' });
    },
    onError: (err) => setMsg({ kind: 'err', text: errorMessage(err) }),
  });

  if (me.isError)
    return (
      <Alert kind="err">This page needs a user session (API-key access has no profile).</Alert>
    );
  if (!me.data) return <div className="muted">Loading…</div>;
  const u = me.data;

  return (
    <div className="page">
      <div className="row">
        <h2 className="page-title">My profile</h2>
        <Badge kind={u.role === 'admin' ? 'info' : undefined}>{u.role}</Badge>
        <span className="small muted">
          @{u.username} · person <span className="mono">{u.person ?? '—'}</span> · last login{' '}
          {fmtDate(u.last_login_at)}
        </span>
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <div className="split" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="panel">
          <h3>Details & preferences</h3>
          <form className="stack" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
            <Field label="Display name" error={form.formState.errors.display_name}>
              <input {...form.register('display_name')} />
            </Field>
            <div className="grid2">
              <Field label="Theme (applied at login)">
                <select {...form.register('preferences.theme')}>
                  <option value="system">system</option>
                  <option value="light">light</option>
                  <option value="dark">dark</option>
                </select>
              </Field>
              <Field label="Language">
                <select {...form.register('preferences.language')}>
                  <option value="en">English</option>
                  <option value="fr">Français</option>
                  <option value="ro">Română</option>
                </select>
              </Field>
            </div>
            <label className="check">
              <input type="checkbox" {...form.register('preferences.notifications_enabled')} />{' '}
              Receive reminder notifications
            </label>
            {!u.person && (
              <span className="small muted">
                No person is linked to this profile yet; ask an administrator to link one so the
                notification switch applies.
              </span>
            )}
            <div className="row">
              <button className="btn primary" disabled={save.isPending}>
                Save
              </button>
            </div>
          </form>
        </div>
        <div className="panel">
          <h3>Change password</h3>
          <form className="stack" onSubmit={pw.handleSubmit((v) => changePw.mutate(v))}>
            <Field label="Current password" error={pw.formState.errors.current_password}>
              <input
                type="password"
                autoComplete="current-password"
                {...pw.register('current_password')}
              />
            </Field>
            <Field label="New password (min 8 characters)" error={pw.formState.errors.new_password}>
              <input type="password" autoComplete="new-password" {...pw.register('new_password')} />
            </Field>
            <div className="row">
              <button className="btn" disabled={changePw.isPending}>
                Change password
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_USER_PREFERENCES,
  userInputSchema,
  type User,
  type UserInput,
} from '@georeminder/shared';
import type { z } from 'zod';
import { api } from '../api';
import { Alert, Badge, Field, errorMessage, fmtDate } from '../components/ui';

const EMPTY: UserInput = {
  username: '',
  display_name: '',
  role: 'member',
  person: null,
  preferences: DEFAULT_USER_PREFERENCES,
  active: true,
  password: undefined,
};

export function ProfilesPage() {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: api.users.list });
  const persons = useQuery({ queryKey: ['persons'], queryFn: api.persons.list });
  const recipients = useQuery({ queryKey: ['recipients'], queryFn: api.recipients.list });
  const me = useQuery({ queryKey: ['me'], queryFn: api.auth.me });
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const form = useForm<z.input<typeof userInputSchema>, unknown, UserInput>({
    resolver: zodResolver(userInputSchema),
    defaultValues: EMPTY,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['users'] });

  const open = (u: User | 'new') => {
    setEditing(u);
    if (u === 'new') form.reset(EMPTY);
    else
      form.reset({
        username: u.username,
        display_name: u.display_name,
        role: u.role,
        person: u.person,
        preferences: u.preferences,
        active: u.active,
        password: undefined,
      });
  };
  const save = useMutation({
    mutationFn: (input: UserInput) =>
      editing && editing !== 'new' ? api.users.update(editing.id, input) : api.users.create(input),
    onSuccess: (u) => {
      refresh();
      setEditing(null);
      setMsg({ kind: 'ok', text: `Profile "${u.username}" saved` });
    },
    onError: (err) => setMsg({ kind: 'err', text: errorMessage(err) }),
  });
  const remove = useMutation({
    mutationFn: api.users.remove,
    onSuccess: () => {
      refresh();
      setMsg({ kind: 'ok', text: 'Profile deleted' });
    },
    onError: (err) => setMsg({ kind: 'err', text: errorMessage(err) }),
  });

  // Known person ids: current positions + recipients, so a profile can be linked without typing.
  const knownPersons = [
    ...new Set([
      ...(persons.data?.items.map((p) => p.person) ?? []),
      ...(recipients.data?.items.map((r) => r.person) ?? []),
    ]),
  ].sort();
  const myId = me.data?.user?.id;

  return (
    <div className="page">
      <div className="row">
        <h2 className="page-title">Profiles</h2>
        <span className="small muted">
          Administrators manage everything; members see the map, rules and events and edit their own
          profile.
        </span>
        <div className="spacer" />
        <button className="btn primary" onClick={() => open('new')}>
          + New profile
        </button>
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <div className="split">
        <div className="panel">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Person</th>
                <th>Notifications</th>
                <th>Last login</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.data?.items.map((u) => (
                <tr key={u.id} className="clickable" onClick={() => open(u)}>
                  <td>
                    {u.display_name} <span className="muted mono">@{u.username}</span>{' '}
                    {!u.active && <Badge>inactive</Badge>}{' '}
                    {u.id === myId && <Badge kind="ok">you</Badge>}
                  </td>
                  <td>
                    <Badge kind={u.role === 'admin' ? 'info' : undefined}>{u.role}</Badge>
                  </td>
                  <td className="mono">{u.person ?? <span className="muted">—</span>}</td>
                  <td>
                    {u.preferences.notifications_enabled ? (
                      <Badge kind="ok">on</Badge>
                    ) : (
                      <Badge kind="warn">off</Badge>
                    )}
                  </td>
                  <td className="small muted">{fmtDate(u.last_login_at)}</td>
                  <td>
                    <button
                      className="btn sm danger"
                      disabled={u.id === myId}
                      onClick={(e) => (
                        e.stopPropagation(),
                        confirm(`Delete profile "${u.username}"?`) && remove.mutate(u.id)
                      )}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel">
          {!editing && <p className="muted">Select a profile or create one.</p>}
          {editing && (
            <form className="stack" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
              <h3>{editing === 'new' ? 'New profile' : `Edit ${editing.username}`}</h3>
              <div className="grid2">
                <Field label="Username" error={form.formState.errors.username}>
                  <input {...form.register('username')} autoComplete="off" autoFocus />
                </Field>
                <Field label="Display name" error={form.formState.errors.display_name}>
                  <input {...form.register('display_name')} />
                </Field>
                <Field label="Role" error={form.formState.errors.role}>
                  <select {...form.register('role')}>
                    <option value="member">member</option>
                    <option value="admin">administrator</option>
                  </select>
                </Field>
                <Field
                  label="Person id (links location fixes and recipients)"
                  error={form.formState.errors.person}
                >
                  <input
                    list="known-persons"
                    placeholder="alex"
                    {...form.register('person', { setValueAs: (v: string) => v || null })}
                  />
                  <datalist id="known-persons">
                    {knownPersons.map((p) => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                </Field>
                <Field
                  label={editing === 'new' ? 'Password' : 'New password (leave empty to keep)'}
                  error={form.formState.errors.password}
                >
                  <input
                    type="password"
                    autoComplete="new-password"
                    {...form.register('password', { setValueAs: (v: string) => v || undefined })}
                  />
                </Field>
                <label className="check" style={{ alignSelf: 'end' }}>
                  <input type="checkbox" {...form.register('active')} /> Active
                </label>
              </div>
              <h3>Preferences</h3>
              <div className="grid2">
                <Field label="Theme">
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
                Notifications enabled (master switch for this person)
              </label>
              <div className="row">
                <button className="btn primary" disabled={save.isPending}>
                  Save
                </button>
                <button type="button" className="btn" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

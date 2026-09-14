import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  channelInputSchema,
  recipientInputSchema,
  type Channel,
  type ChannelInput,
  type Recipient,
  type RecipientInput,
} from '@georeminder/shared';
import type { z } from 'zod';
import { api } from '../api';
import { Alert, Badge, Field, errorMessage, fmtDate } from '../components/ui';

export function RecipientsPage() {
  return (
    <div className="page">
      <h2 className="page-title">Recipients & Channels</h2>
      <div className="split" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <ChannelsPanel />
        <RecipientsPanel />
      </div>
    </div>
  );
}

function ChannelsPanel() {
  const qc = useQueryClient();
  const channels = useQuery({ queryKey: ['channels'], queryFn: api.channels.list });
  const [editing, setEditing] = useState<Channel | 'new' | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const form = useForm<ChannelInput>({
    resolver: zodResolver(channelInputSchema),
    defaultValues: {
      name: 'Home Assistant',
      type: 'home_assistant',
      config: { base_url: 'http://192.168.1.119:8123' },
    },
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['channels'] });
  const save = useMutation({
    mutationFn: (input: ChannelInput) =>
      editing && editing !== 'new'
        ? api.channels.update(editing.id, input)
        : api.channels.create(input),
    onSuccess: () => {
      refresh();
      setEditing(null);
      setMsg({ kind: 'ok', text: 'Channel saved' });
    },
    onError: (err) => setMsg({ kind: 'err', text: errorMessage(err) }),
  });
  const test = useMutation({
    mutationFn: api.channels.test,
    onSuccess: (r) => {
      refresh();
      setMsg(
        r.ok
          ? { kind: 'ok', text: `Connection OK: ${r.message ?? ''}` }
          : { kind: 'err', text: `Connection failed: ${r.error}` },
      );
    },
  });
  const remove = useMutation({
    mutationFn: api.channels.remove,
    onSuccess: refresh,
    onError: (err) => setMsg({ kind: 'err', text: errorMessage(err) }),
  });
  const open = (c: Channel | 'new') => {
    setEditing(c);
    if (c === 'new')
      form.reset({
        name: 'Home Assistant',
        type: 'home_assistant',
        config: { base_url: 'http://192.168.1.119:8123' },
      });
    else
      form.reset({
        name: c.name,
        type: c.type,
        config: { base_url: String(c.config.base_url ?? '') },
      });
  };
  const type = form.watch('type');
  return (
    <div className="panel">
      <div className="row">
        <h3 style={{ margin: 0 }}>Channels</h3>
        <div className="spacer" />
        <button className="btn sm" onClick={() => open('new')}>
          + Channel
        </button>
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {channels.data?.items.map((c) => (
            <tr key={c.id}>
              <td>
                {c.name}
                <div className="small muted">{String(c.config.base_url ?? '')}</div>
              </td>
              <td>
                {c.type} {!c.secret_set && <Badge kind="warn">no token</Badge>}
              </td>
              <td className="small">
                {c.last_test_ok === null ? (
                  <span className="muted">untested</span>
                ) : c.last_test_ok ? (
                  <Badge kind="ok">ok</Badge>
                ) : (
                  <Badge kind="err">failed</Badge>
                )}
                <div className="muted">{fmtDate(c.last_test_at)}</div>
                {c.last_test_error && <div className="field-error">{c.last_test_error}</div>}
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn sm" onClick={() => test.mutate(c.id)}>
                  Test
                </button>{' '}
                <button className="btn sm" onClick={() => open(c)}>
                  Edit
                </button>{' '}
                <button
                  className="btn sm danger"
                  onClick={() => confirm('Delete channel?') && remove.mutate(c.id)}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && (
        <form
          className="stack"
          style={{ marginTop: 12 }}
          onSubmit={form.handleSubmit((v) => save.mutate(v))}
        >
          <h3>{editing === 'new' ? 'New channel' : `Edit ${editing.name}`}</h3>
          <Field label="Name" error={form.formState.errors.name}>
            <input {...form.register('name')} />
          </Field>
          <Field label="Type">
            <select {...form.register('type')}>
              <option value="home_assistant">Home Assistant</option>
              <option value="fcm">FCM (not implemented yet)</option>
            </select>
          </Field>
          {type === 'home_assistant' && (
            <>
              <Field label="Base URL (reachable from the API container)">
                <input
                  placeholder="http://192.168.1.119:8123"
                  {...form.register('config.base_url' as never)}
                />
              </Field>
              <Field
                label={
                  editing === 'new'
                    ? 'Long-lived access token'
                    : 'Long-lived access token (leave empty to keep)'
                }
              >
                <input
                  type="password"
                  autoComplete="off"
                  {...form.register('config.token' as never, {
                    setValueAs: (v: string) => v || undefined,
                  })}
                />
              </Field>
            </>
          )}
          <div className="row">
            <button className="btn primary sm" disabled={save.isPending}>
              Save
            </button>
            <button type="button" className="btn sm" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function RecipientsPanel() {
  const qc = useQueryClient();
  const recipients = useQuery({ queryKey: ['recipients'], queryFn: api.recipients.list });
  const channels = useQuery({ queryKey: ['channels'], queryFn: api.channels.list });
  const [editing, setEditing] = useState<Recipient | 'new' | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const form = useForm<z.input<typeof recipientInputSchema>, unknown, RecipientInput>({
    resolver: zodResolver(recipientInputSchema),
    defaultValues: { name: '', person: '', channel_id: '', target: '', active: true },
  });
  const channelId = form.watch('channel_id');
  const targets = useQuery({
    queryKey: ['targets', channelId],
    queryFn: () => api.channels.targets(channelId),
    enabled: !!channelId,
    retry: false,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['recipients'] });
  const save = useMutation({
    mutationFn: (input: RecipientInput) =>
      editing && editing !== 'new'
        ? api.recipients.update(editing.id, input)
        : api.recipients.create(input),
    onSuccess: () => {
      refresh();
      setEditing(null);
      setMsg({ kind: 'ok', text: 'Recipient saved' });
    },
    onError: (err) => setMsg({ kind: 'err', text: errorMessage(err) }),
  });
  const remove = useMutation({ mutationFn: api.recipients.remove, onSuccess: refresh });
  const sendTest = useMutation({
    mutationFn: (r: Recipient) => api.channels.sendTest(r.channel_id, r.target),
    onSuccess: (r) =>
      setMsg(
        r.ok
          ? { kind: 'ok', text: 'Test notification sent' }
          : { kind: 'err', text: `Send failed: ${r.error}` },
      ),
  });
  const open = (r: Recipient | 'new') => {
    setEditing(r);
    if (r === 'new')
      form.reset({
        name: '',
        person: '',
        channel_id: channels.data?.items[0]?.id ?? '',
        target: '',
        active: true,
      });
    else
      form.reset({
        name: r.name,
        person: r.person,
        channel_id: r.channel_id,
        target: r.target,
        active: r.active,
      });
  };
  return (
    <div className="panel">
      <div className="row">
        <h3 style={{ margin: 0 }}>Recipients</h3>
        <div className="spacer" />
        <button
          className="btn sm"
          onClick={() => open('new')}
          disabled={!channels.data?.items.length}
        >
          + Recipient
        </button>
      </div>
      <p className="small muted">
        A recipient is a phone. <code>person</code> must match the <code>person</code> Home
        Assistant sends to <code>/v1/location</code>; the target is the HA{' '}
        <code>notify.mobile_app_*</code> service.
      </p>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Person</th>
            <th>Target</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {recipients.data?.items.map((r) => (
            <tr key={r.id}>
              <td>
                {r.name} {!r.active && <Badge>inactive</Badge>}
              </td>
              <td className="mono">{r.person}</td>
              <td className="mono small">{r.target}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn sm" onClick={() => sendTest.mutate(r)}>
                  Send test
                </button>{' '}
                <button className="btn sm" onClick={() => open(r)}>
                  Edit
                </button>{' '}
                <button
                  className="btn sm danger"
                  onClick={() => confirm('Delete recipient?') && remove.mutate(r.id)}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing && (
        <form
          className="stack"
          style={{ marginTop: 12 }}
          onSubmit={form.handleSubmit((v) => save.mutate(v))}
        >
          <h3>{editing === 'new' ? 'New recipient' : `Edit ${editing.name}`}</h3>
          <Field label="Name" error={form.formState.errors.name}>
            <input placeholder="Alex's phone" {...form.register('name')} />
          </Field>
          <Field label="Person id (as sent by Home Assistant)" error={form.formState.errors.person}>
            <input placeholder="alex" {...form.register('person')} />
          </Field>
          <Field label="Channel" error={form.formState.errors.channel_id}>
            <select {...form.register('channel_id')}>
              {channels.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Target (notify service)" error={form.formState.errors.target}>
            {targets.data?.items.length ? (
              <select {...form.register('target')}>
                <option value="">— select —</option>
                {targets.data.items.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            ) : (
              <input placeholder="mobile_app_pixel_8" {...form.register('target')} />
            )}
            {targets.isError && (
              <span className="small muted">
                Could not fetch notify services from Home Assistant — type the service name.
              </span>
            )}
          </Field>
          <label className="check">
            <input type="checkbox" {...form.register('active')} /> Active
          </label>
          <div className="row">
            <button className="btn primary sm" disabled={save.isPending}>
              Save
            </button>
            <button type="button" className="btn sm" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

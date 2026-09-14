import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ruleInputSchema,
  TRIGGERS,
  type PlaceGroupInput,
  type Rule,
  type RuleInput,
} from '@georeminder/shared';
import type { z } from 'zod';
import { api } from '../api';
import { Alert, Badge, DaysPicker, Field, errorMessage } from '../components/ui';

const DEFAULTS: RuleInput = {
  name: '',
  place_id: null,
  place_group_id: null,
  trigger: 'approach',
  recipient_ids: [],
  window_start: null,
  window_end: null,
  days_of_week: [0, 1, 2, 3, 4, 5, 6],
  cooldown_seconds: 3600,
  max_per_day: 5,
  enabled: true,
};

const TRIGGER_HELP: Record<string, string> = {
  approach: 'fires when the person comes within the approach radius',
  enter: 'fires when the person comes within the enter radius (also from HA zone events)',
  exit: 'fires when the person leaves the enter radius (+25 % hysteresis)',
  dwell: 'fires after staying inside the enter radius for the place’s dwell seconds',
};

export function RulesPage() {
  const qc = useQueryClient();
  const rules = useQuery({ queryKey: ['rules'], queryFn: api.rules.list });
  const places = useQuery({ queryKey: ['places'], queryFn: api.places.list });
  const groups = useQuery({ queryKey: ['groups'], queryFn: api.groups.list });
  const recipients = useQuery({ queryKey: ['recipients'], queryFn: api.recipients.list });
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const form = useForm<z.input<typeof ruleInputSchema>, unknown, RuleInput>({
    resolver: zodResolver(ruleInputSchema),
    defaultValues: DEFAULTS,
  });
  const [target, setTarget] = useState<'place' | 'group'>('place');

  const open = (r: Rule | 'new') => {
    setEditing(r);
    if (r === 'new') {
      form.reset(DEFAULTS);
      setTarget('place');
    } else {
      const { id: _i, created_at: _c, updated_at: _u, ...input } = r;
      form.reset(input);
      setTarget(r.place_group_id ? 'group' : 'place');
    }
  };
  const save = useMutation({
    mutationFn: (input: RuleInput) =>
      editing && editing !== 'new' ? api.rules.update(editing.id, input) : api.rules.create(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['rules'] });
      setEditing(null);
      setMessage({ kind: 'ok', text: 'Rule saved' });
    },
    onError: (err) => setMessage({ kind: 'err', text: errorMessage(err) }),
  });
  const remove = useMutation({
    mutationFn: api.rules.remove,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['rules'] }),
    onError: (err) => setMessage({ kind: 'err', text: errorMessage(err) }),
  });

  const placeName = (id: string | null) => places.data?.items.find((p) => p.id === id)?.name ?? '?';
  const groupName = (id: string | null) => groups.data?.items.find((g) => g.id === id)?.name ?? '?';
  const recipientName = (id: string) => recipients.data?.items.find((r) => r.id === id);

  return (
    <div className="page">
      <div className="row">
        <h2 className="page-title">Rules</h2>
        <div className="spacer" />
        <button className="btn primary" onClick={() => open('new')}>
          + New rule
        </button>
      </div>
      {message && <Alert kind={message.kind}>{message.text}</Alert>}
      <div className="split">
        <div className="panel">
          <table>
            <thead>
              <tr>
                <th>Rule</th>
                <th>Target</th>
                <th>Trigger</th>
                <th>Recipients</th>
                <th>Window</th>
                <th>Limits</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rules.data?.items.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => open(r)}>
                  <td>
                    {r.name} {!r.enabled && <Badge>disabled</Badge>}
                  </td>
                  <td>
                    {r.place_id ? (
                      placeName(r.place_id)
                    ) : (
                      <Badge kind="info">group: {groupName(r.place_group_id)}</Badge>
                    )}
                  </td>
                  <td>{r.trigger}</td>
                  <td className="small">
                    {r.recipient_ids.map((id) => recipientName(id)?.name ?? '?').join(', ') || (
                      <span className="muted">none</span>
                    )}
                  </td>
                  <td className="small">
                    {r.window_start ? `${r.window_start}–${r.window_end}` : 'all day'}
                    <div className="muted">
                      {r.days_of_week.length === 7
                        ? 'every day'
                        : r.days_of_week
                            .map((d) => ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][d])
                            .join(' ')}
                    </div>
                  </td>
                  <td className="small">
                    cooldown {r.cooldown_seconds}s
                    <div className="muted">max {r.max_per_day || '∞'}/day</div>
                  </td>
                  <td>
                    <button
                      className="btn sm danger"
                      onClick={(e) => (
                        e.stopPropagation(),
                        confirm('Delete rule?') && remove.mutate(r.id)
                      )}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {rules.data?.items.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    No rules. A place without a rule never notifies.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <GroupsEditor />
        </div>
        <div className="panel">
          {!editing && <p className="muted">Select a rule or create one.</p>}
          {editing && (
            <form className="stack" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
              <h3>{editing === 'new' ? 'New rule' : `Edit ${editing.name}`}</h3>
              <Field label="Name" error={form.formState.errors.name}>
                <input {...form.register('name')} autoFocus />
              </Field>
              <div className="row">
                <label className="check">
                  <input
                    type="radio"
                    checked={target === 'place'}
                    onChange={() => (setTarget('place'), form.setValue('place_group_id', null))}
                  />{' '}
                  Place
                </label>
                <label className="check">
                  <input
                    type="radio"
                    checked={target === 'group'}
                    onChange={() => (setTarget('group'), form.setValue('place_id', null))}
                  />{' '}
                  Place group
                </label>
              </div>
              {target === 'place' ? (
                <Field label="Place" error={form.formState.errors.place_id}>
                  <select {...form.register('place_id', { setValueAs: (v: string) => v || null })}>
                    <option value="">— select —</option>
                    {places.data?.items.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <Field label="Place group" error={form.formState.errors.place_group_id}>
                  <select
                    {...form.register('place_group_id', { setValueAs: (v: string) => v || null })}
                  >
                    <option value="">— select —</option>
                    {groups.data?.items.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Trigger" error={form.formState.errors.trigger}>
                <select {...form.register('trigger')}>
                  {TRIGGERS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <span className="small muted">{TRIGGER_HELP[form.watch('trigger')]}</span>
              </Field>
              <Field label="Recipients (the rule fires for the person of each recipient)">
                <Controller
                  control={form.control}
                  name="recipient_ids"
                  render={({ field }) => (
                    <div className="row">
                      {recipients.data?.items.map((r) => (
                        <label key={r.id} className="check">
                          <input
                            type="checkbox"
                            checked={(field.value ?? []).includes(r.id)}
                            onChange={(e) =>
                              field.onChange(
                                e.target.checked
                                  ? [...(field.value ?? []), r.id]
                                  : (field.value ?? []).filter((x) => x !== r.id),
                              )
                            }
                          />
                          {r.name} <span className="muted">({r.person})</span>
                        </label>
                      ))}
                      {recipients.data?.items.length === 0 && (
                        <span className="muted small">
                          No recipients yet — add them under Recipients & Channels.
                        </span>
                      )}
                    </div>
                  )}
                />
              </Field>
              <div className="grid2">
                <Field
                  label="Window start (HH:MM, empty = all day)"
                  error={form.formState.errors.window_start}
                >
                  <input
                    placeholder="09:00"
                    {...form.register('window_start', { setValueAs: (v: string) => v || null })}
                  />
                </Field>
                <Field label="Window end" error={form.formState.errors.window_end}>
                  <input
                    placeholder="21:00"
                    {...form.register('window_end', { setValueAs: (v: string) => v || null })}
                  />
                </Field>
              </div>
              <Field label="Days of week">
                <Controller
                  control={form.control}
                  name="days_of_week"
                  render={({ field }) => (
                    <DaysPicker value={field.value ?? []} onChange={field.onChange} />
                  )}
                />
              </Field>
              <div className="grid2">
                <Field label="Cooldown (seconds)" error={form.formState.errors.cooldown_seconds}>
                  <input
                    type="number"
                    {...form.register('cooldown_seconds', { valueAsNumber: true })}
                  />
                </Field>
                <Field
                  label="Max notifications per day (0 = unlimited)"
                  error={form.formState.errors.max_per_day}
                >
                  <input type="number" {...form.register('max_per_day', { valueAsNumber: true })} />
                </Field>
              </div>
              <label className="check">
                <input type="checkbox" {...form.register('enabled')} /> Enabled
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

function GroupsEditor() {
  const qc = useQueryClient();
  const groups = useQuery({ queryKey: ['groups'], queryFn: api.groups.list });
  const places = useQuery({ queryKey: ['places'], queryFn: api.places.list });
  const [draft, setDraft] = useState<{ id: string | null; input: PlaceGroupInput } | null>(null);
  const save = useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: PlaceGroupInput }) =>
      id ? api.groups.update(id, input) : api.groups.create(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['groups'] });
      setDraft(null);
    },
  });
  const remove = useMutation({
    mutationFn: api.groups.remove,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['groups'] }),
  });
  return (
    <div style={{ marginTop: 16 }}>
      <div className="row">
        <h3 style={{ margin: 0 }}>Place groups</h3>
        <div className="spacer" />
        <button
          className="btn sm"
          onClick={() => setDraft({ id: null, input: { name: '', place_ids: [] } })}
        >
          + Group
        </button>
      </div>
      <table>
        <tbody>
          {groups.data?.items.map((g) => (
            <tr key={g.id}>
              <td>{g.name}</td>
              <td className="small muted">
                {g.place_ids
                  .map((id) => places.data?.items.find((p) => p.id === id)?.name ?? '?')
                  .join(', ') || 'empty'}
              </td>
              <td style={{ textAlign: 'right' }}>
                <button
                  className="btn sm"
                  onClick={() =>
                    setDraft({ id: g.id, input: { name: g.name, place_ids: g.place_ids } })
                  }
                >
                  Edit
                </button>{' '}
                <button
                  className="btn sm danger"
                  onClick={() => confirm('Delete group and its rules?') && remove.mutate(g.id)}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {draft && (
        <form
          className="stack"
          style={{ marginTop: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(draft);
          }}
        >
          <Field label="Group name">
            <input
              value={draft.input.name}
              onChange={(e) =>
                setDraft({ ...draft, input: { ...draft.input, name: e.target.value } })
              }
            />
          </Field>
          <div className="row">
            {places.data?.items.map((p) => (
              <label key={p.id} className="check">
                <input
                  type="checkbox"
                  checked={draft.input.place_ids.includes(p.id)}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      input: {
                        ...draft.input,
                        place_ids: e.target.checked
                          ? [...draft.input.place_ids, p.id]
                          : draft.input.place_ids.filter((x) => x !== p.id),
                      },
                    })
                  }
                />
                {p.name}
              </label>
            ))}
          </div>
          {save.isError && <Alert kind="err">{errorMessage(save.error)}</Alert>}
          <div className="row">
            <button className="btn primary sm">Save group</button>
            <button type="button" className="btn sm" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

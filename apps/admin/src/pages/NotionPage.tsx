import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notionConfigInputSchema, type NotionConfigInput } from '@georeminder/shared';
import type { z } from 'zod';
import { api } from '../api';
import { Alert, Badge, Field, errorMessage, fmtDate } from '../components/ui';

export function NotionPage() {
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ['notion-config'], queryFn: api.notion.config });
  const items = useQuery({ queryKey: ['notion-items'], queryFn: api.notion.items });
  const schema = useQuery({
    queryKey: ['notion-schema'],
    queryFn: api.notion.schema,
    retry: false,
    enabled: !!config.data?.token_set && !!config.data?.database_id,
  });
  const consistency = useQuery({
    queryKey: ['notion-consistency'],
    queryFn: api.notion.consistency,
    retry: false,
    enabled: !!config.data?.token_set,
  });
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'warn'; text: string } | null>(null);
  const form = useForm<z.input<typeof notionConfigInputSchema>, unknown, NotionConfigInput>({
    resolver: zodResolver(notionConfigInputSchema),
  });

  useEffect(() => {
    if (config.data) {
      form.reset({
        token: undefined,
        database_id: config.data.database_id,
        mapping: config.data.mapping,
        sync_interval_seconds: config.data.sync_interval_seconds,
        enabled: config.data.enabled,
      });
    }
  }, [config.data, form]);

  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: ['notion-config'] });
    void qc.invalidateQueries({ queryKey: ['notion-items'] });
    void qc.invalidateQueries({ queryKey: ['notion-schema'] });
    void qc.invalidateQueries({ queryKey: ['notion-consistency'] });
  };
  const save = useMutation({
    mutationFn: api.notion.save,
    onSuccess: () => {
      refreshAll();
      setMsg({ kind: 'ok', text: 'Notion settings saved' });
    },
    onError: (err) => setMsg({ kind: 'err', text: errorMessage(err) }),
  });
  const test = useMutation({
    mutationFn: api.notion.test,
    onSuccess: (r) =>
      setMsg(
        r.ok
          ? {
              kind: 'ok',
              text: `Connected as "${r.user}"${r.database_title ? ` · database "${r.database_title}"` : ''}`,
            }
          : { kind: 'err', text: `Connection failed: ${r.error}` },
      ),
  });
  const sync = useMutation({
    mutationFn: api.notion.sync,
    onSuccess: (r) => {
      refreshAll();
      setMsg(
        r.ok
          ? { kind: 'ok', text: `Synced ${r.items} needed item(s)` }
          : { kind: 'err', text: `Sync failed: ${r.error}` },
      );
    },
  });

  const c = config.data;
  const propOptions = (type?: string) =>
    schema.data?.properties.filter((p) => !type || p.type === type).map((p) => p.name) ?? [];
  const selectOrInput = (
    name: 'mapping.title' | 'mapping.needed' | 'mapping.shop' | 'mapping.category',
    type: string,
  ) => {
    const opts = propOptions(type);
    return opts.length ? (
      <select {...form.register(name)}>
        {opts.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        {!opts.includes(form.watch(name) ?? '') && (
          <option value={form.watch(name) ?? ''}>{form.watch(name)} (missing)</option>
        )}
      </select>
    ) : (
      <input {...form.register(name)} />
    );
  };

  return (
    <div className="page">
      <div className="row">
        <h2 className="page-title">Notion</h2>
        {c && (
          <>
            <Badge kind={c.token_set ? 'ok' : 'warn'}>
              {c.token_set ? 'token stored (encrypted)' : 'no token'}
            </Badge>
            <Badge kind={c.last_sync_ok === null ? undefined : c.last_sync_ok ? 'ok' : 'err'}>
              last sync: {c.last_sync_at ? fmtDate(c.last_sync_at) : 'never'}{' '}
              {c.last_sync_ok === false && '(failed)'}
            </Badge>
            <Badge kind="info">{c.item_count} cached items</Badge>
          </>
        )}
        <div className="spacer" />
        <button className="btn" onClick={() => test.mutate()} disabled={test.isPending}>
          Test connection
        </button>
        <button className="btn primary" onClick={() => sync.mutate()} disabled={sync.isPending}>
          Sync now
        </button>
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {c?.last_sync_error && (
        <Alert kind="warn">
          Last sync error: {c.last_sync_error} — rules keep using the cached items.
        </Alert>
      )}
      <div className="split" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="panel">
          <h3>Settings</h3>
          <form className="stack" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
            <Field
              label={
                c?.token_set
                  ? 'Integration token (leave empty to keep the stored one)'
                  : 'Integration token (ntn_… / secret_…)'
              }
              error={form.formState.errors.token}
            >
              <input
                type="password"
                autoComplete="off"
                {...form.register('token', { setValueAs: (v: string) => v || undefined })}
              />
            </Field>
            <Field label="Database ID or URL" error={form.formState.errors.database_id}>
              <input
                placeholder="https://www.notion.so/…/<32 hex chars>?v=…"
                {...form.register('database_id', { setValueAs: (v: string) => v || null })}
              />
            </Field>
            <h3>Property mapping</h3>
            <div className="grid2">
              <Field label="Title property">{selectOrInput('mapping.title', 'title')}</Field>
              <Field label="Needed checkbox">{selectOrInput('mapping.needed', 'checkbox')}</Field>
              <Field label="Shop select">{selectOrInput('mapping.shop', 'select')}</Field>
              <Field label="Category select">{selectOrInput('mapping.category', 'select')}</Field>
            </div>
            <label className="check">
              <input type="checkbox" {...form.register('mapping.needed_means_true')} /> Checked box
              means &quot;needed&quot; (untick if a checked box means &quot;bought&quot;)
            </label>
            <div className="grid2">
              <Field
                label="Sync interval (seconds)"
                error={form.formState.errors.sync_interval_seconds}
              >
                <input
                  type="number"
                  {...form.register('sync_interval_seconds', { valueAsNumber: true })}
                />
              </Field>
              <label className="check" style={{ alignSelf: 'end' }}>
                <input type="checkbox" {...form.register('enabled')} /> Automatic sync enabled
              </label>
            </div>
            <div className="row">
              <button className="btn primary" disabled={save.isPending}>
                Save
              </button>
            </div>
          </form>
          <details style={{ marginTop: 12 }}>
            <summary>How to set up the Notion side</summary>
            <ol className="small">
              <li>
                Create an internal integration at notion.so/profile/integrations and copy its token.
              </li>
              <li>Open the shopping database → ⋯ → Connections → add the integration.</li>
              <li>
                Paste the database URL above; properties: Name (title), Needed (checkbox), Shop
                (select), Category (select).
              </li>
              <li>
                Each Shop option should match one place on the map (see the consistency check).
              </li>
            </ol>
          </details>
        </div>
        <div className="panel">
          <h3>Live schema</h3>
          {schema.isError && <Alert kind="warn">{errorMessage(schema.error)}</Alert>}
          {schema.data && (
            <div className="small">
              <div>
                Database: <strong>{schema.data.database_title || '(untitled)'}</strong>
              </div>
              <div>Shop options: {schema.data.shop_options.join(', ') || '—'}</div>
              <div>Category options: {schema.data.category_options.join(', ') || '—'}</div>
            </div>
          )}
          {consistency.data && (
            <div className="small" style={{ marginTop: 8 }}>
              <div>
                Shops without a place:{' '}
                {consistency.data.shops_without_place.length ? (
                  <span className="field-error">
                    {consistency.data.shops_without_place.join(', ')}
                  </span>
                ) : (
                  <Badge kind="ok">none</Badge>
                )}
              </div>
              <div>
                Places bound to a missing shop:{' '}
                {consistency.data.places_with_missing_shop.length ? (
                  <span className="field-error">
                    {consistency.data.places_with_missing_shop
                      .map((p) => `${p.name} → ${p.shop}`)
                      .join(', ')}
                  </span>
                ) : (
                  <Badge kind="ok">none</Badge>
                )}
              </div>
            </div>
          )}
          <h3 style={{ marginTop: 16 }}>Cached needed items ({items.data?.items.length ?? 0})</h3>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Shop</th>
                <th>Category</th>
              </tr>
            </thead>
            <tbody>
              {items.data?.items.map((i) => (
                <tr key={i.page_id}>
                  <td>
                    {i.url ? (
                      <a href={i.url} target="_blank" rel="noreferrer">
                        {i.name}
                      </a>
                    ) : (
                      i.name
                    )}
                  </td>
                  <td>{i.shop ?? <span className="muted">—</span>}</td>
                  <td>{i.category ?? <span className="muted">—</span>}</td>
                </tr>
              ))}
              {items.data?.items.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    Nothing cached yet — save the settings and press &quot;Sync now&quot;.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

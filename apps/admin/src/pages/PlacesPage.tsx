import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { placeInputSchema, type Place, type PlaceInput } from '@georeminder/shared';
import type { z } from 'zod';
import { api } from '../api';
import { MapView } from '../components/MapView';
import { Alert, Badge, Field, errorMessage, fmtDate } from '../components/ui';

const DEFAULTS: PlaceInput = {
  name: '',
  lat: 44.4268,
  lng: 26.1025,
  enter_radius_m: 100,
  approach_radius_m: 500,
  dwell_seconds: 120,
  icon: 'mdi:cart',
  color: '#2563eb',
  active: true,
  notion_shop: null,
  notion_categories: [],
  notion_min_items: 1,
  message_template: '{count} items for {shop}: {items}',
  group_by_category: false,
  notion_url: null,
};

export function PlacesPage() {
  const qc = useQueryClient();
  const places = useQuery({ queryKey: ['places'], queryFn: api.places.list });
  const persons = useQuery({
    queryKey: ['persons'],
    queryFn: api.persons.list,
    refetchInterval: 30_000,
  });
  const schema = useQuery({
    queryKey: ['notion-schema'],
    queryFn: api.notion.schema,
    retry: false,
  });
  const consistency = useQuery({
    queryKey: ['notion-consistency'],
    queryFn: api.notion.consistency,
    retry: false,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<'idle' | 'create' | 'edit'>('idle');
  const [message, setMessage] = useState<{ kind: 'ok' | 'err' | 'warn'; text: string } | null>(
    null,
  );

  const form = useForm<z.input<typeof placeInputSchema>, unknown, PlaceInput>({
    resolver: zodResolver(placeInputSchema),
    defaultValues: DEFAULTS,
  });
  const watched = form.watch();
  const draft =
    mode !== 'idle'
      ? {
          lat: watched.lat,
          lng: watched.lng,
          enter_radius_m: watched.enter_radius_m ?? DEFAULTS.enter_radius_m,
          approach_radius_m: watched.approach_radius_m ?? DEFAULTS.approach_radius_m,
          color: watched.color ?? DEFAULTS.color,
        }
      : null;

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['places'] });
    void qc.invalidateQueries({ queryKey: ['notion-consistency'] });
  };
  const save = useMutation({
    mutationFn: (input: PlaceInput) =>
      mode === 'edit' && selectedId
        ? api.places.update(selectedId, input)
        : api.places.create(input),
    onSuccess: (place) => {
      invalidate();
      setSelectedId(place.id);
      setMode('idle');
      setMessage(
        place.ha_zone_error
          ? {
              kind: 'warn',
              text: `Saved, but Home Assistant zone sync failed: ${place.ha_zone_error}`,
            }
          : {
              kind: 'ok',
              text: `Saved "${place.name}"${place.ha_zone_entity_id ? ` (HA zone ${place.ha_zone_entity_id})` : ''}`,
            },
      );
    },
    onError: (err) => setMessage({ kind: 'err', text: errorMessage(err) }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.places.remove(id),
    onSuccess: () => {
      invalidate();
      setSelectedId(null);
      setMode('idle');
      setMessage({ kind: 'ok', text: 'Place deleted' });
    },
    onError: (err) => setMessage({ kind: 'err', text: errorMessage(err) }),
  });
  const zoneSyncAll = useMutation({
    mutationFn: api.ha.syncZones,
    onSuccess: (r) => {
      invalidate();
      setMessage({
        kind: r.errors.length ? 'warn' : 'ok',
        text: `Zones: ${r.synced} synced, ${r.removed} removed${r.errors.length ? `, ${r.errors.length} error(s): ${r.errors.map((e) => e.error).join('; ')}` : ''}${r.warning ? ` — ${r.warning}` : ''}`,
      });
    },
    onError: (err) => setMessage({ kind: 'err', text: errorMessage(err) }),
  });

  const selected = useMemo(
    () => places.data?.items.find((p) => p.id === selectedId) ?? null,
    [places.data, selectedId],
  );
  const items = useQuery({
    queryKey: ['place-items', selectedId],
    queryFn: () => api.places.items(selectedId!),
    enabled: !!selectedId && mode !== 'create',
  });

  const startEdit = useCallback(
    (p: Place) => {
      const {
        id: _id,
        created_at: _c,
        updated_at: _u,
        ha_zone_id: _z,
        ha_zone_entity_id: _e,
        ha_zone_synced_at: _s,
        ha_zone_error: _err,
        ...input
      } = p;
      form.reset(input);
      setSelectedId(p.id);
      setMode('edit');
    },
    [form],
  );
  const startCreate = (lat?: number, lng?: number) => {
    form.reset({ ...DEFAULTS, lat: lat ?? DEFAULTS.lat, lng: lng ?? DEFAULTS.lng });
    setSelectedId(null);
    setMode('create');
  };
  const onMapClick = useCallback(
    (lat: number, lng: number) => {
      if (mode === 'idle') startCreate(lat, lng);
      else {
        form.setValue('lat', Number(lat.toFixed(6)), { shouldDirty: true });
        form.setValue('lng', Number(lng.toFixed(6)), { shouldDirty: true });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, form],
  );
  const onSelect = useCallback((p: Place) => {
    setSelectedId(p.id);
    setMode('idle');
  }, []);
  useEffect(() => {
    if (message?.kind === 'ok') {
      const t = setTimeout(() => setMessage(null), 5000);
      return () => clearTimeout(t);
    }
  }, [message]);

  const shopOptions = schema.data?.shop_options ?? [];
  const categoryOptions = schema.data?.category_options ?? [];
  const activeCount = places.data?.items.filter((p) => p.active).length ?? 0;

  return (
    <div className="page">
      <div className="row">
        <h2 className="page-title">Map & Places</h2>
        <Badge kind={activeCount > 20 ? 'warn' : 'info'}>
          {activeCount} active / {places.data?.items.length ?? 0} places
        </Badge>
        {activeCount > 20 && (
          <span className="small muted">
            iOS allows ~20 geofences per app — deactivate some places.
          </span>
        )}
        <div className="spacer" />
        <button
          className="btn"
          onClick={() => zoneSyncAll.mutate()}
          disabled={zoneSyncAll.isPending}
        >
          Sync HA zones
        </button>
        <button className="btn primary" onClick={() => startCreate()}>
          + New place
        </button>
      </div>
      {message && <Alert kind={message.kind}>{message.text}</Alert>}
      {consistency.data &&
        (consistency.data.shops_without_place.length > 0 ||
          consistency.data.places_with_missing_shop.length > 0) && (
          <Alert kind="warn">
            {consistency.data.shops_without_place.length > 0 && (
              <div>
                Notion shops without a place: {consistency.data.shops_without_place.join(', ')}
              </div>
            )}
            {consistency.data.places_with_missing_shop.length > 0 && (
              <div>
                Places bound to a missing Notion shop option:{' '}
                {consistency.data.places_with_missing_shop
                  .map((p) => `${p.name} → "${p.shop}"`)
                  .join(', ')}
              </div>
            )}
            {consistency.data.error && <div className="small">{consistency.data.error}</div>}
          </Alert>
        )}
      <div className="split">
        <div>
          <MapView
            places={places.data?.items ?? []}
            persons={persons.data?.items ?? []}
            selectedId={selectedId}
            draft={draft}
            onSelect={onSelect}
            onMapClick={onMapClick}
          />
          <p className="small muted">
            Click the map to create a place; while editing, a click moves the pin. Solid circle =
            enter radius, dashed = approach radius.
          </p>
          <div className="panel">
            <table>
              <thead>
                <tr>
                  <th>Place</th>
                  <th>Radii (m)</th>
                  <th>Notion shop</th>
                  <th>HA zone</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {places.data?.items.map((p) => (
                  <tr
                    key={p.id}
                    className={`clickable ${p.id === selectedId ? 'selected' : ''}`}
                    onClick={() => onSelect(p)}
                  >
                    <td>
                      <span className="swatch" style={{ background: p.color }} />
                      {p.name} {!p.active && <Badge>inactive</Badge>}
                    </td>
                    <td>
                      {p.enter_radius_m} / {p.approach_radius_m}
                    </td>
                    <td>
                      {p.notion_shop ?? <span className="muted">—</span>}
                      {p.notion_categories.length > 0 && (
                        <div className="small muted">{p.notion_categories.join(', ')}</div>
                      )}
                    </td>
                    <td>
                      {p.ha_zone_error ? (
                        <Badge kind="err">error</Badge>
                      ) : p.ha_zone_entity_id ? (
                        <Badge kind="ok">{p.ha_zone_entity_id}</Badge>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <button
                        className="btn sm"
                        onClick={(e) => (e.stopPropagation(), startEdit(p))}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
                {places.data?.items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      No places yet. Click on the map to add one.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          {mode === 'idle' && !selected && (
            <p className="muted">Select a place or click on the map.</p>
          )}
          {mode === 'idle' && selected && (
            <div className="stack" style={{ display: 'grid', gap: 8 }}>
              <h3>
                <span className="swatch" style={{ background: selected.color }} />
                {selected.name}
              </h3>
              <div className="small muted">
                {selected.lat.toFixed(5)}, {selected.lng.toFixed(5)} · enter{' '}
                {selected.enter_radius_m} m · approach {selected.approach_radius_m} m · dwell{' '}
                {selected.dwell_seconds} s
              </div>
              <div className="small">
                HA zone: {selected.ha_zone_entity_id ?? '—'}{' '}
                {selected.ha_zone_synced_at && (
                  <span className="muted">(synced {fmtDate(selected.ha_zone_synced_at)})</span>
                )}
                {selected.ha_zone_error && (
                  <div className="field-error">{selected.ha_zone_error}</div>
                )}
              </div>
              <div>
                <strong className="small">
                  Items that would be sent now ({items.data?.items.length ?? 0})
                </strong>
                <ul className="small" style={{ margin: '4px 0', paddingLeft: 18 }}>
                  {items.data?.items.map((i) => (
                    <li key={i.page_id}>
                      {i.name} {i.category && <span className="muted">· {i.category}</span>}
                    </li>
                  ))}
                  {items.data?.items.length === 0 && (
                    <li className="muted">none (no Notion binding or no needed items)</li>
                  )}
                </ul>
              </div>
              <div className="row">
                <button className="btn primary" onClick={() => startEdit(selected)}>
                  Edit
                </button>
                <button
                  className="btn"
                  onClick={() => api.places.zoneSync(selected.id).then(invalidate)}
                >
                  Re-sync HA zone
                </button>
                <button
                  className="btn danger"
                  onClick={() =>
                    confirm(`Delete "${selected.name}" and its rules?`) &&
                    remove.mutate(selected.id)
                  }
                >
                  Delete
                </button>
              </div>
            </div>
          )}
          {mode !== 'idle' && (
            <form className="stack" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
              <h3>{mode === 'create' ? 'New place' : `Edit ${selected?.name ?? ''}`}</h3>
              <Field label="Name" error={form.formState.errors.name}>
                <input {...form.register('name')} autoFocus />
              </Field>
              <div className="grid2">
                <Field label="Latitude" error={form.formState.errors.lat}>
                  <input
                    type="number"
                    step="any"
                    {...form.register('lat', { valueAsNumber: true })}
                  />
                </Field>
                <Field label="Longitude" error={form.formState.errors.lng}>
                  <input
                    type="number"
                    step="any"
                    {...form.register('lng', { valueAsNumber: true })}
                  />
                </Field>
                <Field label="Enter radius (m)" error={form.formState.errors.enter_radius_m}>
                  <input
                    type="number"
                    {...form.register('enter_radius_m', { valueAsNumber: true })}
                  />
                </Field>
                <Field label="Approach radius (m)" error={form.formState.errors.approach_radius_m}>
                  <input
                    type="number"
                    {...form.register('approach_radius_m', { valueAsNumber: true })}
                  />
                </Field>
                <Field label="Dwell seconds" error={form.formState.errors.dwell_seconds}>
                  <input
                    type="number"
                    {...form.register('dwell_seconds', { valueAsNumber: true })}
                  />
                </Field>
                <Field label="Colour" error={form.formState.errors.color}>
                  <input type="color" {...form.register('color')} />
                </Field>
                <Field label="Icon (mdi:…)" error={form.formState.errors.icon}>
                  <input {...form.register('icon')} />
                </Field>
                <label className="check" style={{ alignSelf: 'end' }}>
                  <input type="checkbox" {...form.register('active')} /> Active (synced as HA zone)
                </label>
              </div>
              <h3>Notion binding</h3>
              <Field label="Shop (Notion select option)" error={form.formState.errors.notion_shop}>
                <Controller
                  control={form.control}
                  name="notion_shop"
                  render={({ field }) =>
                    shopOptions.length ? (
                      <select
                        value={field.value ?? ''}
                        onChange={(e) => field.onChange(e.target.value || null)}
                      >
                        <option value="">— none —</option>
                        {shopOptions.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                        {field.value && !shopOptions.includes(field.value) && (
                          <option value={field.value}>{field.value} (missing in Notion)</option>
                        )}
                      </select>
                    ) : (
                      <input
                        placeholder={
                          schema.isError ? 'Notion not configured — type the shop name' : 'Loading…'
                        }
                        value={field.value ?? ''}
                        onChange={(e) => field.onChange(e.target.value || null)}
                      />
                    )
                  }
                />
              </Field>
              <Field label="Categories (empty = all)">
                <Controller
                  control={form.control}
                  name="notion_categories"
                  render={({ field }) =>
                    categoryOptions.length ? (
                      <div className="row">
                        {categoryOptions.map((c) => (
                          <label key={c} className="check">
                            <input
                              type="checkbox"
                              checked={(field.value ?? []).includes(c)}
                              onChange={(e) =>
                                field.onChange(
                                  e.target.checked
                                    ? [...(field.value ?? []), c]
                                    : (field.value ?? []).filter((x) => x !== c),
                                )
                              }
                            />
                            {c}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <input
                        placeholder="Kitchen, Bathroom"
                        value={(field.value ?? []).join(', ')}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value
                              .split(',')
                              .map((s) => s.trim())
                              .filter(Boolean),
                          )
                        }
                      />
                    )
                  }
                />
              </Field>
              <div className="grid2">
                <Field
                  label="Minimum items to trigger"
                  error={form.formState.errors.notion_min_items}
                >
                  <input
                    type="number"
                    {...form.register('notion_min_items', { valueAsNumber: true })}
                  />
                </Field>
                <label className="check" style={{ alignSelf: 'end' }}>
                  <input type="checkbox" {...form.register('group_by_category')} /> Group items by
                  category
                </label>
              </div>
              <Field
                label="Message template ({count} {shop} {items} {place} {person} {categories})"
                error={form.formState.errors.message_template}
              >
                <textarea rows={2} {...form.register('message_template')} />
              </Field>
              <Field label="Deep link (Notion view URL)" error={form.formState.errors.notion_url}>
                <input
                  placeholder="https://www.notion.so/…"
                  {...form.register('notion_url', { setValueAs: (v: string) => (v ? v : null) })}
                />
              </Field>
              <div className="row">
                <button className="btn primary" disabled={save.isPending}>
                  Save
                </button>
                <button type="button" className="btn" onClick={() => setMode('idle')}>
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

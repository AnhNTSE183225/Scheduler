import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { addMinutes, addMonths, format, isSameDay, parseISO, startOfDay } from 'date-fns';
import { CalendarDays, Check, Image as ImageIcon, Loader2, Plus, Search, X } from 'lucide-solid';
import { Dialog } from '@/components/ui/Dialog';
import { CustomSelect, type SelectOption } from '@/components/ui/CustomSelect';
import { SlidingSegmentedControl } from '@/components/ui/SlidingSegmentedControl';
import { EVENT_CATEGORIES, inferCategory } from '@/components/pickers/CategoryMeta';
import { CustomDatePicker } from '@/components/pickers/CustomDatePicker';
import { CustomTimePicker } from '@/components/pickers/CustomTimePicker';
import { LocationMapPreview } from '@/components/pickers/LocationMapPreview';
import { AvatarBadge } from './AvatarBadge';
import { WEEKDAY_SHORT } from '@/lib/recurrence';
import type {
  CalendarSpace,
  EventCategory,
  ScheduleEvent,
  ScheduleEventLink,
  ScheduleEventLocation,
  ScheduleEventRecurrence,
  ServerMember,
} from '@/models/schedule';

type LocKind = 'address' | 'link' | 'none';
type FreqKind = 'none' | 'daily' | 'weekly' | 'monthly';
type EndsKind = 'never' | 'until' | 'count';

export function EventEditorDialog(props: {
  open: boolean;
  userId: string;
  calendars: CalendarSpace[];
  membersByCalendar: Record<string, ServerMember[]>;
  defaultCalendarId?: string;
  initial?: ScheduleEvent;
  date?: Date;
  onClose: () => void;
  onSave: (calendarId: string, data: Partial<ScheduleEvent>) => Promise<void>;
}) {
  const defaultStart = () => {
    if (props.initial) return parseISO(props.initial.start);
    const now = new Date();
    const target = props.date ? new Date(props.date) : now;
    if (isSameDay(target, now)) {
      const nextHour = new Date(now);
      nextHour.setHours(now.getHours() + 1, 0, 0, 0);
      return nextHour;
    }
    const d = startOfDay(target);
    d.setHours(19, 0, 0, 0);
    return d;
  };

  const [selectedCalendarId, setSelectedCalendarId] = createSignal('');
  const [title, setTitle] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [category, setCategory] = createSignal<EventCategory>('other');
  const [manualCategory, setManualCategory] = createSignal(false);
  const [day, setDay] = createSignal(format(new Date(), 'yyyy-MM-dd'));
  const [time, setTime] = createSignal('19:00');
  const [endTime, setEndTime] = createSignal('20:00');
  const [freq, setFreq] = createSignal<FreqKind>('none');
  const [interval, setIntervalN] = createSignal(1);
  const [weekdays, setWeekdays] = createSignal<number[]>([new Date().getDay()]);
  const [ends, setEnds] = createSignal<EndsKind>('never');
  const [until, setUntil] = createSignal(format(addMonths(new Date(), 3), 'yyyy-MM-dd'));
  const [count, setCount] = createSignal(10);
  const [locKind, setLocKind] = createSignal<LocKind>('address');
  const [address, setAddress] = createSignal('');
  const [url, setUrl] = createSignal('');
  const [imageUrl, setImageUrl] = createSignal('');
  const [links, setLinks] = createSignal<ScheduleEventLink[]>([]);
  const [everyone, setEveryone] = createSignal(true);
  const [invitees, setInvitees] = createSignal<string[]>([]);
  const [memberSearch, setMemberSearch] = createSignal('');
  const [error, setError] = createSignal('');
  const [saving, setSaving] = createSignal(false);

  createEffect(() => {
    if (!props.open) return;
    const init = props.initial;
    const s0 = defaultStart();
    setSelectedCalendarId(
      init?.calendarId || props.defaultCalendarId || props.calendars[0]?.id || '',
    );
    setTitle(init?.title ?? '');
    setDescription(init?.description ?? '');
    setCategory(init?.category ?? 'other');
    setManualCategory(Boolean(init?.category && init.category !== 'other'));
    setDay(format(s0, 'yyyy-MM-dd'));
    setTime(format(s0, 'HH:mm'));
    setEndTime(format(addMinutes(s0, init?.durationMinutes ?? 60), 'HH:mm'));
    setFreq(init?.recurrence?.freq ?? 'none');
    setIntervalN(init?.recurrence?.interval ?? 1);
    setWeekdays(init?.recurrence?.weekdays ?? [s0.getDay()]);
    setEnds(init?.recurrence?.until ? 'until' : init?.recurrence?.count ? 'count' : 'never');
    setUntil(init?.recurrence?.until ?? format(addMonths(s0, 3), 'yyyy-MM-dd'));
    setCount(init?.recurrence?.count ?? 10);
    setLocKind(init?.location?.kind ?? 'address');
    setAddress(init?.location?.kind === 'address' ? init.location.address || '' : '');
    setUrl(init?.location?.kind === 'link' ? init.location.url || '' : '');
    setImageUrl(init?.imageUrl ?? '');
    setLinks(init?.links ?? []);
    setEveryone(init?.inviteEveryone ?? true);
    setInvitees(init?.inviteeIds ?? []);
    setMemberSearch('');
    setError('');
  });

  const filteredOthers = createMemo(() => {
    const q = memberSearch().trim().toLowerCase();
    const calMembers = props.membersByCalendar[selectedCalendarId()] || [];
    return calMembers
      .filter((m) => m.id !== props.userId)
      .filter((m) => !q || m.name.toLowerCase().includes(q));
  });

  const FREQ_OPTIONS: SelectOption<FreqKind>[] = [
    { value: 'none', label: 'Does not repeat (one-off)' },
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
  ];

  const ENDS_OPTIONS: SelectOption<EndsKind>[] = [
    { value: 'never', label: 'Never' },
    { value: 'until', label: 'On specific date' },
    { value: 'count', label: 'After number of events' },
  ];

  const handleSave = async () => {
    if (!title().trim()) return setError('Give your event a title.');
    if (locKind() === 'address' && !address().trim()) {
      return setError('Add an address / Google Maps link, or switch Location to None.');
    }
    if (locKind() === 'link' && !/^https?:\/\//.test(url().trim())) {
      return setError('Online link must start with http:// or https://');
    }

    const location: ScheduleEventLocation | null =
      locKind() === 'address'
        ? { kind: 'address', address: address().trim() }
        : locKind() === 'link'
        ? { kind: 'link', url: url().trim() }
        : null;

    const recurrence: ScheduleEventRecurrence | null =
      freq() === 'none'
        ? null
        : {
            freq: freq() as 'daily' | 'weekly' | 'monthly',
            interval: Math.max(1, interval()),
            weekdays:
              freq() === 'weekly'
                ? weekdays().length
                  ? weekdays()
                  : [parseISO(day()).getDay()]
                : undefined,
            until: ends() === 'until' ? until() : null,
            count: ends() === 'count' ? Math.max(1, count()) : null,
          };

    const parseMins = (hhmm: string) => {
      const [h, m] = hhmm.split(':').map((n) => Number.parseInt(n, 10));
      return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
    };
    let durationMinutes = parseMins(endTime()) - parseMins(time());
    if (durationMinutes === 0) {
      return setError('End time must be different from start time.');
    }
    if (durationMinutes < 0) {
      durationMinutes += 24 * 60;
    }
    if (durationMinutes < 15) {
      return setError('Event must be at least 15 minutes long.');
    }

    const localDate = new Date(`${day()}T${time()}`);
    if (!isNaN(localDate.getTime())) {
      const isPast = localDate.getTime() < Date.now() - 60000;
      if (isPast && (!props.initial || parseISO(props.initial.start).getTime() !== localDate.getTime())) {
        return setError('Cannot schedule an event in the past. Please choose a future date and time.');
      }
    }
    const startIso = isNaN(localDate.getTime()) ? `${day()}T${time()}` : localDate.toISOString();

    const data: Partial<ScheduleEvent> = {
      title: title().trim(),
      description: description(),
      category: category(),
      start: startIso,
      durationMinutes: Math.min(1440, durationMinutes),
      recurrence,
      location,
      imageUrl: imageUrl().trim() || null,
      links: links().filter((l) => l.url.trim()),
      inviteEveryone: everyone(),
      inviteeIds: everyone() ? [] : invitees(),
    };

    setSaving(true);
    setError('');
    try {
      await props.onSave(selectedCalendarId(), data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save event');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={props.open} onClose={props.onClose}>
      <div class="px-6 py-4 border-b border-border shrink-0 bg-card/90 flex items-center justify-between gap-2">
        <div>
          <h3 class="text-lg font-bold flex items-center gap-2">
            <CalendarDays size={18} class="text-primary" />
            {props.initial ? 'Edit event' : 'New event'}
          </h3>
          <p class="text-xs text-muted-foreground mt-0.5">
            {props.initial?.recurrence
              ? 'Changes apply to every event in this series.'
              : 'Share the generated invite link anywhere—friends can RSVP and enable push reminders.'}
          </p>
        </div>
        <button type="button" onClick={props.onClose} class="p-1.5 rounded-lg text-muted-foreground hover:text-foreground">
          <X size={16} />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        <Show when={props.calendars.length > 0}>
          <div class="flex flex-col gap-1.5">
            <span class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Calendar</span>
            <Show
              when={!props.initial}
              fallback={
                <div class="h-9 px-3 rounded-lg border border-border bg-card/40 text-xs font-medium text-muted-foreground flex items-center">
                  {(() => {
                    const c = props.calendars.find((x) => x.id === selectedCalendarId());
                    return c ? (c.isPersonal ? 'Personal' : c.name) : 'Calendar';
                  })()}
                </div>
              }
            >
              <CustomSelect
                value={selectedCalendarId()}
                onChange={(id) => {
                  setSelectedCalendarId(id);
                  setInvitees([]);
                }}
                options={props.calendars.map((c) => ({
                  value: c.id,
                  label: c.isPersonal ? 'Personal' : c.name,
                  badge: c.isPersonal ? 'Personal' : 'Group',
                }))}
                ariaLabel="Select calendar"
              />
            </Show>
          </div>
        </Show>

        <div class="flex flex-col gap-1.5">
          <span class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Title</span>
          <input
            type="text"
            value={title()}
            onInput={(e) => {
              const val = e.currentTarget.value;
              setTitle(val);
              if (!manualCategory()) {
                const inferred = inferCategory(val, description());
                if (inferred !== 'other') setCategory(inferred);
              }
            }}
            placeholder="Friday BBQ / Game Night / Coffee Catch-up"
            class="w-full h-9 px-3 rounded-lg border border-border bg-card/70 text-sm text-foreground outline-none focus:border-primary"
          />
        </div>

        <div class="flex flex-col gap-1.5">
          <span class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Description</span>
          <textarea
            class="schedule-textarea"
            rows={3}
            value={description()}
            onInput={(e) => setDescription(e.currentTarget.value)}
            placeholder="What's happening?"
          />
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div class="flex flex-col gap-1.5">
            <span class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Date</span>
            <CustomDatePicker value={day()} onChange={setDay} />
          </div>
          <div class="flex flex-col gap-1.5">
            <span class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Start Time</span>
            <CustomTimePicker value={time()} onChange={setTime} />
          </div>
          <div class="flex flex-col gap-1.5">
            <span class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">End Time</span>
            <CustomTimePicker value={endTime()} onChange={setEndTime} />
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          <span class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Repeat</span>
          <div class="flex gap-3 flex-wrap items-center">
            <CustomSelect value={freq()} onChange={setFreq} options={FREQ_OPTIONS} className="w-56" />
            <Show when={freq() !== 'none'}>
              <span class="flex items-center gap-2 text-xs font-medium">
                every
                <input
                  type="number"
                  min={1}
                  class="w-16 h-9 px-2 rounded-lg border border-border bg-card/70 text-center text-xs"
                  value={interval()}
                  onInput={(e) => setIntervalN(Math.max(1, Number(e.currentTarget.value)))}
                />
                {freq() === 'daily' ? 'day(s)' : freq() === 'weekly' ? 'week(s)' : 'month(s)'}
              </span>
            </Show>
          </div>
        </div>

        <Show when={freq() === 'weekly'}>
          <div class="flex gap-2 flex-wrap">
            <For each={WEEKDAY_SHORT}>
              {(d, i) => {
                const active = () => weekdays().includes(i());
                return (
                  <button
                    type="button"
                    aria-pressed={active()}
                    class={`day-toggle ${active() ? 'is-active' : ''}`}
                    onClick={() =>
                      setWeekdays((w) => (w.includes(i()) ? w.filter((x) => x !== i()) : [...w, i()]))
                    }
                  >
                    {d}
                  </button>
                );
              }}
            </For>
          </div>
        </Show>

        <Show when={freq() !== 'none'}>
          <div class="flex flex-col gap-1.5">
            <span class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Ends</span>
            <div class="flex gap-3 flex-wrap items-center">
              <CustomSelect value={ends()} onChange={setEnds} options={ENDS_OPTIONS} className="w-56" />
              <Show when={ends() === 'until'}>
                <CustomDatePicker value={until()} onChange={setUntil} className="w-48" />
              </Show>
              <Show when={ends() === 'count'}>
                <div class="flex items-center gap-1.5 text-xs font-medium">
                  <input
                    type="number"
                    min={1}
                    class="w-20 h-9 px-2 rounded-lg border border-border bg-card/70 text-center text-xs"
                    value={count()}
                    onInput={(e) => setCount(Math.max(1, Number(e.currentTarget.value)))}
                  />
                  <span>events</span>
                </div>
              </Show>
            </div>
          </div>
        </Show>

        <div class="flex flex-col gap-1.5">
          <span class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Category</span>
          <SlidingSegmentedControl<EventCategory>
            value={category()}
            onChange={(cat) => {
              setManualCategory(true);
              setCategory(cat);
            }}
            options={EVENT_CATEGORIES.map((c) => {
              const Icon = c.icon;
              return { value: c.id, label: c.label, icon: <Icon size={13} /> };
            })}
            className="w-full overflow-x-auto no-scrollbar"
            buttonClassName="flex-1 py-1.5 text-xs font-medium"
            ariaLabel="Event category"
          />
        </div>

        <div class="flex flex-col gap-2">
          <span class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Location</span>
          <SlidingSegmentedControl<LocKind>
            value={locKind()}
            onChange={setLocKind}
            options={[
              { value: 'address', label: 'Google Maps / Address' },
              { value: 'link', label: 'Online link' },
              { value: 'none', label: 'None' },
            ]}
            className="w-full"
            buttonClassName="flex-1 py-1.5 text-xs font-medium"
            ariaLabel="Event location type"
          />
          <Show when={locKind() === 'address'}>
            <div class="space-y-3">
              <input
                type="text"
                value={address()}
                onInput={(e) => setAddress(e.currentTarget.value)}
                placeholder="Paste Google Maps link or street address..."
                class="w-full h-9 px-3 rounded-lg border border-border bg-card/70 text-xs text-foreground outline-none focus:border-primary"
              />
              <LocationMapPreview address={address()} />
            </div>
          </Show>
          <Show when={locKind() === 'link'}>
            <input
              type="text"
              value={url()}
              onInput={(e) => setUrl(e.currentTarget.value)}
              placeholder="https://meet.google.com/... or https://zoom.us/..."
              class="w-full h-9 px-3 rounded-lg border border-border bg-card/70 text-xs text-foreground outline-none focus:border-primary"
            />
          </Show>
        </div>

        <div class="flex flex-col gap-1.5">
          <span class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Cover image URL</span>
          <div class="flex items-center gap-2">
            <ImageIcon size={15} class="text-muted-foreground shrink-0" />
            <input
              type="text"
              value={imageUrl()}
              onInput={(e) => setImageUrl(e.currentTarget.value)}
              placeholder="https://.../image.jpg"
              class="w-full h-9 px-3 rounded-lg border border-border bg-card/70 text-xs text-foreground outline-none focus:border-primary"
            />
          </div>
          <Show when={imageUrl().trim()}>
            <img src={imageUrl()} alt="" class="mt-2 w-full h-28 object-cover rounded-xl border border-border" />
          </Show>
        </div>

        <div class="flex flex-col gap-2">
          <span class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Additional Links</span>
          <For each={links()}>
            {(l, i) => (
              <div class="flex gap-2">
                <input
                  type="text"
                  class="w-1/3 h-9 px-2.5 rounded-lg border border-border bg-card/70 text-xs"
                  value={l.label}
                  placeholder="Label"
                  onInput={(e) =>
                    setLinks(links().map((x, j) => (j === i() ? { ...x, label: e.currentTarget.value } : x)))
                  }
                />
                <input
                  type="text"
                  class="flex-1 h-9 px-2.5 rounded-lg border border-border bg-card/70 text-xs"
                  value={l.url}
                  placeholder="https://"
                  onInput={(e) =>
                    setLinks(links().map((x, j) => (j === i() ? { ...x, url: e.currentTarget.value } : x)))
                  }
                />
                <button
                  type="button"
                  aria-label="Remove link"
                  onClick={() => setLinks(links().filter((_, j) => j !== i()))}
                  class="h-9 w-9 rounded-lg grid place-items-center text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </For>
          <button
            type="button"
            onClick={() => setLinks([...links(), { label: '', url: '' }])}
            class="self-start inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-primary hover:bg-primary/10"
          >
            <Plus size={13} /> Add link
          </button>
        </div>

        <div class="flex flex-col gap-2">
          <span class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Invite Audience</span>
          <label class="flex items-center gap-2 text-sm cursor-pointer font-medium">
            <input
              type="checkbox"
              checked={everyone()}
              onChange={(e) => setEveryone(e.currentTarget.checked)}
              class="accent-[var(--primary)] h-4 w-4 rounded"
            />
            Everyone in this group (+ anyone with the invite link)
          </label>
          <Show when={!everyone()}>
            <div class="space-y-2.5 pt-1">
              <div class="relative">
                <Search size={13} class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={memberSearch()}
                  onInput={(e) => setMemberSearch(e.currentTarget.value)}
                  placeholder="Search group members..."
                  class="w-full h-8 pl-8 pr-3 rounded-lg border border-border bg-card/70 text-xs outline-none focus:border-primary"
                />
              </div>
              <div class="flex flex-wrap gap-2">
                <Show when={filteredOthers().length === 0}>
                  <span class="text-xs text-muted-foreground">
                    No other members in this group yet—anyone can join via your Group Invite Code or Event Link!
                  </span>
                </Show>
                <For each={filteredOthers()}>
                  {(m) => {
                    const on = () => invitees().includes(m.id);
                    return (
                      <button
                        type="button"
                        aria-pressed={on()}
                        class={`invitee-chip ${on() ? 'is-active' : ''}`}
                        onClick={() =>
                          setInvitees((list) => (on() ? list.filter((x) => x !== m.id) : [...list, m.id]))
                        }
                      >
                        <AvatarBadge name={m.name} avatar={m.avatar} size={18} />
                        <span>{m.name}</span>
                        <Show when={on()}>
                          <Check size={12} />
                        </Show>
                      </button>
                    );
                  }}
                </For>
              </div>
            </div>
          </Show>
        </div>
      </div>

      <div class="px-6 py-4 border-t border-border shrink-0 bg-card/90 flex items-center justify-between gap-3 flex-wrap">
        <Show
          when={error()}
          fallback={<span class="text-xs text-muted-foreground">Fill in details and save</span>}
        >
          <p class="text-xs text-destructive font-medium">{error()}</p>
        </Show>
        <div class="flex items-center gap-2.5 ml-auto">
          <button
            type="button"
            disabled={saving()}
            onClick={props.onClose}
            class="px-3.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving()}
            onClick={() => void handleSave()}
            class="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 disabled:opacity-60"
          >
            <Show when={saving()}>
              <Loader2 size={13} class="animate-spin" />
            </Show>
            {props.initial ? 'Save changes' : 'Create event'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

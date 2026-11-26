import { Show, createEffect, createSignal, onMount } from 'solid-js';
import { Bell, BellOff, Check, KeyRound, Landmark, Lock, LogOut } from 'lucide-solid';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { AvatarBadge } from '@/components/schedule/AvatarBadge';
import { fetchVietQrBanks, type VietQrBank } from '@/lib/vietqr';
import { authStore } from '@/stores/authStore';
import { notificationStore } from '@/stores/notificationStore';
import { scheduleStore } from '@/stores/scheduleStore';

export function MobileProfileTab() {
  const user = () => authStore.user();
  const [displayName, setDisplayName] = createSignal('');
  const [bankBin, setBankBin] = createSignal('');
  const [bankAccountNumber, setBankAccountNumber] = createSignal('');
  const [banks, setBanks] = createSignal<VietQrBank[]>([]);
  const [profileSaving, setProfileSaving] = createSignal(false);
  const [profileError, setProfileError] = createSignal('');
  const [profileSuccess, setProfileSuccess] = createSignal('');

  const [currentPassword, setCurrentPassword] = createSignal('');
  const [newPassword, setNewPassword] = createSignal('');
  const [confirmPassword, setConfirmPassword] = createSignal('');
  const [pwSaving, setPwSaving] = createSignal(false);
  const [pwError, setPwError] = createSignal('');
  const [pwSuccess, setPwSuccess] = createSignal('');

  onMount(() => {
    void fetchVietQrBanks().then(setBanks);
  });

  createEffect(() => {
    const u = user();
    if (!u) return;
    setDisplayName(u.displayName);
    setBankBin(u.bankBin ?? '');
    setBankAccountNumber(u.bankAccountNumber ?? '');
  });

  const handleSaveProfile = async (e: Event) => {
    e.preventDefault();
    const trimmed = displayName().trim();
    if (!trimmed) return setProfileError('Display name cannot be empty.');
    const cleanBin = bankBin().trim();
    const cleanAcc = bankAccountNumber().trim();
    if ((cleanBin && !cleanAcc) || (!cleanBin && cleanAcc)) {
      return setProfileError('Select a bank AND enter your account number.');
    }
    setProfileSaving(true);
    setProfileError('');
    setProfileSuccess('');
    try {
      await authStore.updateProfile(trimmed, cleanBin || null, cleanAcc || null);
      setProfileSuccess('Profile saved.');
    } catch (err: unknown) {
      setProfileError(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleChangePassword = async (e: Event) => {
    e.preventDefault();
    if (!currentPassword()) return setPwError('Enter your current password.');
    if (newPassword().length < 8) return setPwError('New password must be at least 8 characters.');
    if (newPassword() !== confirmPassword()) return setPwError('New passwords do not match.');
    setPwSaving(true);
    setPwError('');
    setPwSuccess('');
    try {
      await authStore.changePassword(currentPassword(), newPassword());
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPwSuccess('Password updated.');
    } catch (err: unknown) {
      setPwError(err instanceof Error ? err.message : 'Failed to update password');
    } finally {
      setPwSaving(false);
    }
  };

  return (
    <div class="flex flex-col min-h-full px-[18px] pt-5 pb-36 space-y-[18px]">
      <div class="px-2 flex items-center justify-between">
        <h1 class="text-[21.5px] leading-[26.5px] font-bold">Profile</h1>
        <button
          type="button"
          onClick={() => {
            scheduleStore.disconnect();
            void authStore.logout();
          }}
          class="h-10 px-4 rounded-full border border-border bg-card/60 text-xs font-semibold inline-flex items-center gap-1.5 text-muted-foreground hover:text-destructive"
        >
          <LogOut size={13} /> Sign out
        </button>
      </div>

      <Show when={user()}>
        {(u) => (
          <>
            <div class="rounded-[23.5px] border border-border bg-card/60 p-5 flex items-center gap-4">
              <AvatarBadge name={u().displayName} avatar={u().avatar} size={56} />
              <div class="min-w-0">
                <div class="text-lg font-bold truncate">{u().displayName}</div>
                <div class="text-xs font-mono text-muted-foreground truncate">@{u().username}</div>
                <div class="text-[11px] text-muted-foreground/80 mt-0.5">Avatar placeholder</div>
              </div>
            </div>

            <form
              onSubmit={(e) => void handleSaveProfile(e)}
              class="rounded-[23.5px] border border-border bg-card/60 p-5 space-y-4"
            >
              <div class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Profile &amp; Bank Details
              </div>

              <div class="space-y-1.5">
                <label class="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                  <Lock size={11} /> Username (permanent)
                </label>
                <input
                  type="text"
                  value={u().username}
                  disabled
                  class="w-full h-10 px-3 rounded-xl border border-border bg-muted/40 text-xs font-mono text-muted-foreground"
                />
              </div>

              <div class="space-y-1.5">
                <label class="text-[11px] font-semibold text-muted-foreground">Display Name</label>
                <input
                  type="text"
                  maxLength={80}
                  value={displayName()}
                  onInput={(e) => setDisplayName(e.currentTarget.value)}
                  class="w-full h-10 px-3 rounded-xl border border-border bg-card/80 text-sm outline-none focus:border-primary"
                />
              </div>

              <div class="space-y-1.5">
                <label class="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                  <Landmark size={11} class="text-primary" /> Bank
                </label>
                <CustomSelect
                  value={bankBin()}
                  onChange={setBankBin}
                  options={banks().map((b) => ({ value: b.bin, label: b.shortName, badge: b.code }))}
                  placeholder="Select bank..."
                  searchable
                  searchPlaceholder="Search bank..."
                  className="w-full"
                />
              </div>

              <div class="space-y-1.5">
                <label class="text-[11px] font-semibold text-muted-foreground">Account Number</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={32}
                  value={bankAccountNumber()}
                  onInput={(e) => setBankAccountNumber(e.currentTarget.value)}
                  class="w-full h-10 px-3 rounded-xl border border-border bg-card/80 text-sm font-mono outline-none focus:border-primary"
                />
              </div>

              <Show when={profileError()}>
                <p class="text-xs text-destructive">{profileError()}</p>
              </Show>
              <Show when={profileSuccess()}>
                <p class="text-xs text-primary">{profileSuccess()}</p>
              </Show>

              <button
                type="submit"
                disabled={profileSaving()}
                class="w-full h-11 rounded-full bg-primary text-primary-foreground text-sm font-semibold inline-flex items-center justify-center gap-1.5"
              >
                <Check size={14} /> {profileSaving() ? 'Saving...' : 'Save Profile'}
              </button>
            </form>

            <form
              onSubmit={(e) => void handleChangePassword(e)}
              class="rounded-[23.5px] border border-border bg-card/60 p-5 space-y-3"
            >
              <div class="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <KeyRound size={12} class="text-primary" /> Reset Password
              </div>
              <input
                type="password"
                value={currentPassword()}
                onInput={(e) => setCurrentPassword(e.currentTarget.value)}
                placeholder="Current password"
                class="w-full h-10 px-3 rounded-xl border border-border bg-card/80 text-sm outline-none focus:border-primary"
              />
              <input
                type="password"
                value={newPassword()}
                onInput={(e) => setNewPassword(e.currentTarget.value)}
                placeholder="New password (min 8 chars)"
                class="w-full h-10 px-3 rounded-xl border border-border bg-card/80 text-sm outline-none focus:border-primary"
              />
              <input
                type="password"
                value={confirmPassword()}
                onInput={(e) => setConfirmPassword(e.currentTarget.value)}
                placeholder="Confirm new password"
                class="w-full h-10 px-3 rounded-xl border border-border bg-card/80 text-sm outline-none focus:border-primary"
              />
              <Show when={pwError()}>
                <p class="text-xs text-destructive">{pwError()}</p>
              </Show>
              <Show when={pwSuccess()}>
                <p class="text-xs text-primary">{pwSuccess()}</p>
              </Show>
              <button
                type="submit"
                disabled={pwSaving()}
                class="w-full h-11 rounded-full border border-border bg-card/80 text-sm font-semibold"
              >
                {pwSaving() ? 'Updating...' : 'Update Password'}
              </button>
            </form>

            <div class="rounded-[23.5px] border border-border bg-card/60 p-5 flex items-center justify-between gap-3">
              <div>
                <div class="text-sm font-semibold">Push Reminders</div>
                <div class="text-xs text-muted-foreground">
                  {notificationStore.status() === 'active' ? 'Active on this device' : 'Disabled'}
                </div>
              </div>
              <Show
                when={notificationStore.status() === 'active'}
                fallback={
                  <button
                    type="button"
                    onClick={() => void notificationStore.enablePush()}
                    class="h-10 px-4 rounded-full bg-primary text-primary-foreground text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <Bell size={13} /> Enable
                  </button>
                }
              >
                <button
                  type="button"
                  onClick={() => void notificationStore.disablePush()}
                  class="h-10 px-4 rounded-full border border-border text-xs font-medium inline-flex items-center gap-1.5"
                >
                  <BellOff size={13} /> Disable
                </button>
              </Show>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}

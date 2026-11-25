import { Show, createEffect, createSignal, onMount } from 'solid-js';
import { Bell, BellOff, Check, KeyRound, Landmark, Lock, User as UserIcon, X } from 'lucide-solid';
import { Dialog } from '@/components/ui/Dialog';
import { CustomSelect } from '@/components/ui/CustomSelect';
import { AvatarBadge } from './AvatarBadge';
import { fetchVietQrBanks, type VietQrBank } from '@/lib/vietqr';
import { authStore } from '@/stores/authStore';
import { notificationStore } from '@/stores/notificationStore';

export function ProfileModal(props: { open: boolean; onClose: () => void }) {
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
    if (!props.open) return;
    setDisplayName(user()?.displayName ?? '');
    setBankBin(user()?.bankBin ?? '');
    setBankAccountNumber(user()?.bankAccountNumber ?? '');
    setProfileError('');
    setProfileSuccess('');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPwError('');
    setPwSuccess('');
  });

  const handleSaveProfile = async (e: Event) => {
    e.preventDefault();
    const trimmed = displayName().trim();
    if (!trimmed) {
      setProfileError('Display name cannot be empty.');
      return;
    }
    if (trimmed.length > 80) {
      setProfileError('Display name must be 80 characters or fewer.');
      return;
    }
    const cleanBin = bankBin().trim();
    const cleanAcc = bankAccountNumber().trim();
    if ((cleanBin && !cleanAcc) || (!cleanBin && cleanAcc)) {
      setProfileError('Please select a bank AND enter your bank account number.');
      return;
    }

    setProfileSaving(true);
    setProfileError('');
    setProfileSuccess('');
    try {
      const updated = await authStore.updateProfile(trimmed, cleanBin || null, cleanAcc || null);
      setDisplayName(updated.displayName);
      setBankBin(updated.bankBin ?? '');
      setBankAccountNumber(updated.bankAccountNumber ?? '');
      setProfileSuccess('Profile updated.');
    } catch (err: unknown) {
      setProfileError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleChangePassword = async (e: Event) => {
    e.preventDefault();
    if (!currentPassword()) {
      setPwError('Enter your current password.');
      return;
    }
    if (newPassword().length < 8 || newPassword().length > 128) {
      setPwError('New password must be between 8 and 128 characters.');
      return;
    }
    if (newPassword() !== confirmPassword()) {
      setPwError('New passwords do not match.');
      return;
    }
    setPwSaving(true);
    setPwError('');
    setPwSuccess('');
    try {
      await authStore.changePassword(currentPassword(), newPassword());
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPwSuccess('Password updated successfully.');
    } catch (err: unknown) {
      setPwError(err instanceof Error ? err.message : 'Failed to update password');
    } finally {
      setPwSaving(false);
    }
  };

  return (
    <Dialog open={props.open} onClose={props.onClose}>
      <div class="px-6 py-4 border-b border-border shrink-0 bg-card/90 flex items-center justify-between gap-2">
        <h3 class="text-lg font-bold flex items-center gap-2">
          <UserIcon size={18} class="text-primary" />
          Profile &amp; Account
        </h3>
        <button
          type="button"
          onClick={props.onClose}
          class="p-1.5 rounded-lg text-muted-foreground hover:text-foreground"
        >
          <X size={16} />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto px-6 py-5 space-y-6">
        <Show when={user()}>
          {(u) => (
            <>
              {/* Avatar placeholder & identity */}
              <div class="flex items-center gap-4 p-4 rounded-xl border border-border bg-card/50">
                <div class="relative shrink-0">
                  <AvatarBadge name={u().displayName} avatar={u().avatar} size={52} />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="text-base font-bold truncate">{u().displayName}</div>
                  <div class="text-xs text-muted-foreground font-mono truncate">@{u().username}</div>
                  <div class="text-[11px] text-muted-foreground/80 mt-1">
                    Avatar placeholder (custom image upload coming soon)
                  </div>
                </div>
              </div>

              {/* Profile details + Bank Info */}
              <form onSubmit={(e) => void handleSaveProfile(e)} class="space-y-3">
                <div class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Profile Details
                </div>

                <div class="flex flex-col gap-1.5">
                  <label class="text-[11px] font-semibold text-muted-foreground flex items-center gap-1.5">
                    <Lock size={11} /> Username (permanent)
                  </label>
                  <input
                    type="text"
                    value={u().username}
                    disabled
                    class="w-full h-9 px-3 rounded-lg border border-border bg-muted/40 text-xs font-mono text-muted-foreground cursor-not-allowed"
                  />
                </div>

                <div class="flex flex-col gap-1.5">
                  <label class="text-[11px] font-semibold text-muted-foreground">Display Name</label>
                  <input
                    type="text"
                    value={displayName()}
                    onInput={(e) => {
                      setDisplayName(e.currentTarget.value);
                      setProfileError('');
                      setProfileSuccess('');
                    }}
                    maxLength={80}
                    placeholder="Your display name"
                    class="w-full h-9 px-3 rounded-lg border border-border bg-card/70 text-sm text-foreground outline-none focus:border-primary"
                  />
                </div>

                <div class="pt-2 space-y-3">
                  <div class="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Landmark size={12} class="text-primary" />
                    Bank Info (for Split Bills / VietQR)
                  </div>

                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div class="flex flex-col gap-1.5">
                      <label class="text-[11px] font-semibold text-muted-foreground">Bank</label>
                      <CustomSelect
                        value={bankBin()}
                        onChange={(val) => {
                          setBankBin(val);
                          setProfileError('');
                          setProfileSuccess('');
                        }}
                        options={banks().map((b) => ({
                          value: b.bin,
                          label: b.shortName,
                          badge: b.code,
                        }))}
                        placeholder="Select bank..."
                        searchable
                        searchPlaceholder="Search bank (VPBank, VCB...)"
                        ariaLabel="Select bank"
                        className="w-full"
                      />
                    </div>

                    <div class="flex flex-col gap-1.5">
                      <label class="text-[11px] font-semibold text-muted-foreground">Account Number</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={bankAccountNumber()}
                        onInput={(e) => {
                          setBankAccountNumber(e.currentTarget.value);
                          setProfileError('');
                          setProfileSuccess('');
                        }}
                        maxLength={32}
                        placeholder="e.g. 12308042004"
                        class="w-full h-9 px-3 rounded-lg border border-border bg-card/70 text-sm font-mono text-foreground outline-none focus:border-primary"
                      />
                    </div>
                  </div>
                </div>

                <Show when={profileError()}>
                  <p class="text-xs text-destructive">{profileError()}</p>
                </Show>
                <Show when={profileSuccess()}>
                  <p class="text-xs text-primary">{profileSuccess()}</p>
                </Show>

                <div class="flex justify-end">
                  <button
                    type="submit"
                    disabled={profileSaving()}
                    class="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
                  >
                    <Check size={13} />
                    {profileSaving() ? 'Saving...' : 'Save Profile'}
                  </button>
                </div>
              </form>

              {/* Password reset */}
              <form onSubmit={(e) => void handleChangePassword(e)} class="space-y-3 pt-4 border-t border-border">
                <div class="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <KeyRound size={12} class="text-primary" />
                  Reset Password
                </div>

                <div class="flex flex-col gap-1.5">
                  <label class="text-[11px] font-semibold text-muted-foreground">Current Password</label>
                  <input
                    type="password"
                    value={currentPassword()}
                    onInput={(e) => {
                      setCurrentPassword(e.currentTarget.value);
                      setPwError('');
                      setPwSuccess('');
                    }}
                    placeholder="Enter current password"
                    class="w-full h-9 px-3 rounded-lg border border-border bg-card/70 text-sm text-foreground outline-none focus:border-primary"
                  />
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div class="flex flex-col gap-1.5">
                    <label class="text-[11px] font-semibold text-muted-foreground">New Password</label>
                    <input
                      type="password"
                      value={newPassword()}
                      onInput={(e) => {
                        setNewPassword(e.currentTarget.value);
                        setPwError('');
                        setPwSuccess('');
                      }}
                      placeholder="Min 8 characters"
                      class="w-full h-9 px-3 rounded-lg border border-border bg-card/70 text-sm text-foreground outline-none focus:border-primary"
                    />
                  </div>
                  <div class="flex flex-col gap-1.5">
                    <label class="text-[11px] font-semibold text-muted-foreground">Confirm New Password</label>
                    <input
                      type="password"
                      value={confirmPassword()}
                      onInput={(e) => {
                        setConfirmPassword(e.currentTarget.value);
                        setPwError('');
                        setPwSuccess('');
                      }}
                      placeholder="Repeat new password"
                      class="w-full h-9 px-3 rounded-lg border border-border bg-card/70 text-sm text-foreground outline-none focus:border-primary"
                    />
                  </div>
                </div>

                <Show when={pwError()}>
                  <p class="text-xs text-destructive">{pwError()}</p>
                </Show>
                <Show when={pwSuccess()}>
                  <p class="text-xs text-primary">{pwSuccess()}</p>
                </Show>

                <div class="flex justify-end">
                  <button
                    type="submit"
                    disabled={pwSaving()}
                    class="h-9 px-4 rounded-lg border border-border bg-card/80 hover:bg-accent text-xs font-semibold text-foreground disabled:opacity-50"
                  >
                    {pwSaving() ? 'Updating...' : 'Update Password'}
                  </button>
                </div>
              </form>

              {/* Device push reminders status */}
              <div class="pt-4 border-t border-border flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-xs font-semibold">Push Reminders on This Device</div>
                  <div class="text-[11px] text-muted-foreground">
                    {notificationStore.status() === 'active'
                      ? 'Enabled — lock-screen reminders are active.'
                      : 'Currently disabled on this device.'}
                  </div>
                </div>
                <Show
                  when={notificationStore.status() === 'active'}
                  fallback={
                    <button
                      type="button"
                      disabled={notificationStore.status() === 'loading'}
                      onClick={() => void notificationStore.enablePush()}
                      class="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold inline-flex items-center gap-1.5 shrink-0"
                    >
                      <Bell size={12} /> Enable
                    </button>
                  }
                >
                  <button
                    type="button"
                    onClick={() => void notificationStore.disablePush()}
                    class="h-8 px-3 rounded-lg border border-border bg-card/70 hover:bg-destructive/15 text-xs font-medium text-muted-foreground hover:text-destructive inline-flex items-center gap-1.5 shrink-0"
                  >
                    <BellOff size={12} /> Disable
                  </button>
                </Show>
              </div>
            </>
          )}
        </Show>
      </div>
    </Dialog>
  );
}

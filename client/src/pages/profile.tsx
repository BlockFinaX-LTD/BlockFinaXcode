/**
 * Profile — BlockFinaX 2026 redesign
 *
 * Avatar hero card → grouped form sections (Personal, Contact, Location,
 * Social) → collapsible optional sections (Business, Identity) → public
 * profile toggle → sticky Save bar. All form/data wiring identical to
 * the prior version (react-hook-form + Zod + TanStack mutations).
 */
import { useState, useEffect } from 'react';
import { SettingsRow, SettingsGroup } from '@/components/app-settings-row';
import { clearLocalRiftState } from '@/lib/rift-client';
import { useLocation } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Settings as SettingsIcon,
  User,
  Save,
  ShieldCheck,
  Copy,
  Loader2,
  Bell,
  TrendingUp,
  BadgeCheck,
  LogOut,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useWallet } from '@/hooks/use-wallet';
import { queryClient } from '@/lib/api-client';
import { AppShell } from '@/components/app-shell';
import { getRiftAccessToken } from '@/lib/rift-token-bridge';
import { Pill, shortAddr } from '@/components/ui/bfx';

const profileSchema = z.object({
  displayName: z.string().optional().or(z.literal('')),
  firstName: z.string().optional().or(z.literal('')),
  lastName: z.string().optional().or(z.literal('')),
  email: z.string().email().optional().or(z.literal('')),
  phoneNumber: z.string().optional().or(z.literal('')),
  companyName: z.string().optional().or(z.literal('')),
  jobTitle: z.string().optional().or(z.literal('')),
  country: z.string().optional().or(z.literal('')),
  city: z.string().optional().or(z.literal('')),
  address: z.string().optional().or(z.literal('')),
  postalCode: z.string().optional().or(z.literal('')),
  dateOfBirth: z.string().optional().or(z.literal('')),
  nationality: z.string().optional().or(z.literal('')),
  idType: z.string().optional().or(z.literal('')),
  idNumber: z.string().optional().or(z.literal('')),
  taxId: z.string().optional().or(z.literal('')),
  website: z.string().url().optional().or(z.literal('')),
  linkedin: z.string().optional().or(z.literal('')),
  twitter: z.string().optional().or(z.literal('')),
  bio: z.string().optional().or(z.literal('')),
  isPublic: z.boolean().optional(),
});

type ProfileFormData = z.infer<typeof profileSchema>;

const africanCountries = [
  'Ghana', 'Nigeria', 'Kenya', 'South Africa', 'Tanzania', 'Uganda', 'Ethiopia',
  'Rwanda', 'Senegal', 'Ivory Coast', 'Cameroon', 'Morocco', 'Egypt', 'Tunisia',
  'Algeria', 'Mozambique', 'Zambia', 'Zimbabwe', 'Botswana', 'Namibia', 'Malawi',
  'DRC Congo', 'Angola', 'Madagascar', 'Mali', 'Burkina Faso', 'Niger', 'Benin',
  'Togo', 'Sierra Leone', 'Liberia', 'Guinea', 'Gambia',
];
const otherCountries = [
  'United States', 'United Kingdom', 'Canada', 'Germany', 'France', 'Netherlands',
  'Switzerland', 'UAE', 'Singapore', 'China', 'Japan', 'India', 'Brazil', 'Australia',
  'Other',
];

function SectionCard({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center gap-2 text-[13px] font-semibold tracking-tight">
          <span className="h-7 w-7 rounded-full bg-primary/10 text-primary inline-flex items-center justify-center">
            <Icon className="h-3.5 w-3.5" strokeWidth={1.9} />
          </span>
          {title}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

export default function ProfilePage() {
  const [, setLocation] = useLocation();
  const { wallet, isUnlocked, walletExists, isLoading: walletLoading } = useWallet();
  // The form is a page in its own right, opened from the row rather than
  // stacked below it — the list is the shape people scan.
  const [showPersonal, setShowPersonal] = useState(false);
  const { toast } = useToast();
  const [showBusiness, setShowBusiness] = useState(false);

  useEffect(() => {
    if (!walletLoading) {
      if (!walletExists()) setLocation('/auth');
      else if (!isUnlocked) setLocation('/auth');
    }
  }, [isUnlocked, walletExists, walletLoading, setLocation]);

  const walletAddress = wallet?.address || '';

  const { data: profile, isLoading } = useQuery({
    queryKey: ['/api/profiles', walletAddress],
    queryFn: async () => {
      const res = await fetch(`/api/profiles/${walletAddress}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('Failed to load profile');
      return res.json();
    },
    enabled: !!walletAddress,
  });

  const form = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      displayName: '',
      firstName: '',
      lastName: '',
      email: '',
      phoneNumber: '',
      companyName: '',
      jobTitle: '',
      country: '',
      city: '',
      address: '',
      postalCode: '',
      dateOfBirth: '',
      nationality: '',
      idType: '',
      idNumber: '',
      taxId: '',
      website: '',
      linkedin: '',
      twitter: '',
      bio: '',
      isPublic: false,
    },
  });

  useEffect(() => {
    if (profile) {
      form.reset({
        displayName: profile.displayName || '',
        firstName: profile.firstName || '',
        lastName: profile.lastName || '',
        email: profile.email || '',
        phoneNumber: profile.phoneNumber || '',
        companyName: profile.companyName || '',
        jobTitle: profile.jobTitle || '',
        country: profile.country || '',
        city: profile.city || '',
        address: profile.address || '',
        postalCode: profile.postalCode || '',
        dateOfBirth: profile.dateOfBirth || '',
        nationality: profile.nationality || '',
        idType: profile.idType || '',
        idNumber: profile.idNumber || '',
        taxId: profile.taxId || '',
        website: profile.website || '',
        linkedin: profile.linkedin || '',
        twitter: profile.twitter || '',
        bio: profile.bio || '',
        isPublic: profile.isPublic || false,
      });
      if (profile.companyName || profile.jobTitle || profile.taxId) setShowBusiness(true);
    }
  }, [profile]);

  const saveMutation = useMutation({
    mutationFn: async (data: ProfileFormData) => {
      const cleaned: Record<string, any> = { walletAddress };
      for (const [key, val] of Object.entries(data)) {
        cleaned[key] = typeof val === 'string' && val.trim() === '' ? null : val;
      }
      const url = profile ? `/api/profiles/${walletAddress}` : '/api/profiles';
      const method = profile ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleaned),
      });
      if (!res.ok) throw new Error(profile ? 'Failed to update' : 'Failed to create');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/profiles', walletAddress] });
      toast({ title: 'Profile saved', description: 'Your profile has been updated.' });
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to save profile. Please try again.',
        variant: 'destructive',
      });
    },
  });

  const onSubmit = (data: ProfileFormData) => saveMutation.mutate(data);

  const copyAddress = () => {
    navigator.clipboard.writeText(walletAddress);
    toast({ title: 'Copied', description: 'Wallet address copied to clipboard.' });
  };

  const getInitials = () => {
    const fn = form.watch('firstName');
    const ln = form.watch('lastName');
    const dn = form.watch('displayName');
    if (fn && ln) return `${fn[0]}${ln[0]}`.toUpperCase();
    if (dn) return dn.slice(0, 2).toUpperCase();
    // No name yet. The old fallback took two characters off the address, which
    // on 0x420e… renders as "42" — a number, not initials, and the first thing
    // anyone sees on the page. A glyph is honest about there being no name.
    return null;
  };

  if (walletLoading || !isUnlocked) return null;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <AppShell active="profile" greeting={{ title: 'Profile', subtitle: 'Your account, verification and settings' }}>
      <main className="mx-auto max-w-2xl pb-12">
        {/* The name is the page heading, not another destination. It comes
            from identity verification — there is no separate profile form to
            fill in, because the same details are already collected there and
            asking twice is how records disagree with each other. */}
        <div className="st-me">
          <div className="st-av">{getInitials() ?? <User className="h-6 w-6" strokeWidth={1.7} />}</div>
          <div className="min-w-0 flex-1">
            <div className="st-name">
              {form.watch('displayName') || form.watch('firstName') || 'Your account'}
            </div>
            <button onClick={copyAddress} className="st-addr">
              {shortAddr(walletAddress)}
              <Copy />
            </button>
          </div>
        </div>

        <div className="mt-6">
          <SettingsGroup title="Wallet">
            <SettingsRow
              icon={ShieldCheck}
              label="Signing methods"
              sub="Passkeys and Google accounts that authorise payments"
              href="/signing"
            />
            <SettingsRow icon={Bell} label="Notifications" sub="Alerts for cover, payouts and verification" href="/settings" />
          </SettingsGroup>
        </div>

        <SettingsGroup title="Compliance">
          <VerificationRow />
        </SettingsGroup>

        <SettingsGroup title="Earn">
          <SettingsRow icon={TrendingUp} label="Tasks and rewards" sub="Points, referrals and payouts in USDC" href="/tasks" />
        </SettingsGroup>

        <SettingsGroup title="App">
          <SettingsRow icon={SettingsIcon} label="Preferences" sub="Security, network and legal" href="/settings" />
          <SettingsRow
            icon={LogOut}
            label="Log out"
            tone="bad"
            noChevron
            onClick={() => { clearLocalRiftState(); window.location.href = '/'; }}
          />
        </SettingsGroup>

        <p className="mt-8 text-center text-[11px] text-muted-foreground">BlockFinaX Inc.</p>
      </main>
    </AppShell>
  );
}

/**
 * Verification status, and the way into /verify.
 *
 * Sits at the top of the profile because how much someone can transact is the
 * thing they most often come here to find out — and until this existed there
 * was no route to the verification page at all.
 */
function VerificationRow() {
  const { data } = useQuery<{ tier: number; status: string } | null>({
    queryKey: ['compliance-me-profile'],
    queryFn: async () => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      try {
        headers.Authorization = `Bearer ${await getRiftAccessToken()}`;
      } catch {
        /* signed out — the endpoint will simply answer for nobody */
      }
      try {
        const r = await fetch("/api/compliance/me", { headers });
        return r.ok ? await r.json() : null;
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
  });

  const status = data?.status ?? "unverified";
  const verified = status === "approved";
  const pending = status === "pending" || status === "submitted";

  return (
    <SettingsRow
      icon={BadgeCheck}
      label="Identity verification"
      sub={
        verified
          ? `Verified${data?.tier ? ` — tier ${data.tier}` : ""}`
          : pending
            ? "Under review"
            : "Required before you can buy cover or provide liquidity"
      }
      href="/verify"
      tone={verified ? "ok" : pending ? "default" : "warn"}
    />
  );
}

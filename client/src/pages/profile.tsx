/**
 * Profile — BlockFinaX 2026 redesign
 *
 * Avatar hero card → grouped form sections (Personal, Contact, Location,
 * Social) → collapsible optional sections (Business, Identity) → public
 * profile toggle → sticky Save bar. All form/data wiring identical to
 * the prior version (react-hook-form + Zod + TanStack mutations).
 */
import { useState, useEffect } from 'react';
import { SigningSection } from '@/components/wallet/signing-section';
import { SettingsRow, SettingsGroup } from '@/components/app-settings-row';
import { clearLocalRiftState } from '@/lib/rift-client';
import { useLocation } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  User,
  Building2,
  Mail,
  MapPin,
  Globe,
  Shield,
  Save,
  CheckCircle,
  Clock,
  ArrowLeft,
  ChevronRight,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Copy,
  Loader2,
  Bell,
  Gift,
  TrendingUp,
  BadgeCheck,
  Settings as SettingsIcon,
  LogOut,
  Wallet as WalletIcon,
  Pencil,
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
  const [showSigning, setShowSigning] = useState(false);
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
    return walletAddress ? walletAddress.slice(2, 4).toUpperCase() : 'U';
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
      <main className="max-w-2xl mx-auto space-y-5 pb-10">
        {/* Identity, then the list. The address sits under the name because it
            is the thing people come here to copy. */}
        <div className="flex items-center gap-3.5 px-1 pt-1">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <span className="bfx-display text-lg font-semibold text-primary">{getInitials()}</span>
          </div>
          <div className="min-w-0 flex-1">
            <button
              onClick={() => setShowPersonal(true)}
              className="flex items-center gap-1.5 text-left"
            >
              <span className="bfx-display truncate text-[19px] font-semibold tracking-tight">
                {form.watch('displayName') || form.watch('firstName') || 'Set your name'}
              </span>
              <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
            <button
              onClick={copyAddress}
              className="mt-0.5 flex items-center gap-1 font-mono-data text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {shortAddr(walletAddress)}
              <Copy className="h-3 w-3" />
            </button>
          </div>
        </div>

        <SettingsGroup title="Account">
          <SettingsRow
            icon={User}
            label="Personal info"
            sub={form.watch('displayName') || form.watch('firstName') ? 'Name, contact and business' : 'Not set up yet'}
            onClick={() => setShowPersonal((v) => !v)}
          />
          <SettingsRow icon={WalletIcon} label="Withdrawal account" sub="Where payouts are sent" href="/settings" />
          <SettingsRow icon={Bell} label="Notifications" sub="Manage alerts" href="/settings" />
          <SettingsRow icon={Gift} label="Invite friends" sub="Share your referral link" href="/rewards" />
          <SettingsRow icon={TrendingUp} label="Earn" sub="Tasks, points and rewards" href="/tasks" />
          <SettingsRow
            icon={ShieldCheck}
            label="Signing methods"
            sub="Passkeys and Google accounts that authorise payments"
            onClick={() => setShowSigning((v) => !v)}
          />
        </SettingsGroup>

        {showSigning && <SigningSection />}

        <SettingsGroup title="Compliance">
          <VerificationRow />
        </SettingsGroup>

        <SettingsGroup title="App">
          <SettingsRow icon={SettingsIcon} label="Preferences" sub="Security, network and legal" href="/settings" />
          <SettingsRow
            icon={LogOut}
            label="Log out"
            tone="danger"
            noChevron
            onClick={() => { clearLocalRiftState(); window.location.href = '/'; }}
          />
        </SettingsGroup>

        <p className="pb-2 text-center text-[11px] text-muted-foreground">BlockFinaX Inc.</p>

        {showPersonal && (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Personal */}
            <SectionCard icon={User} title="Personal info">
              <FormField
                control={form.control}
                name="displayName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                      Display name
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="How others see you" {...field} className="rounded-xl" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                        First name
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="John" {...field} className="rounded-xl" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                        Last name
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="Doe" {...field} className="rounded-xl" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="bio"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                      Bio
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Tell others a bit about yourself…"
                        className="min-h-[80px] resize-none rounded-xl"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </SectionCard>

            {/* Contact */}
            <SectionCard icon={Mail} title="Contact">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                      Email
                    </FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="you@example.com" {...field} className="rounded-xl" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phoneNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                      Phone
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="+233 XX XXX XXXX" {...field} className="rounded-xl" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </SectionCard>

            {/* Location */}
            <SectionCard icon={MapPin} title="Location">
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="country"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                        Country
                      </FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || ''}>
                        <FormControl>
                          <SelectTrigger className="rounded-xl">
                            <SelectValue placeholder="Select country" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="max-h-60">
                          <SelectItem value="__africa_label" disabled>
                            --- Africa ---
                          </SelectItem>
                          {africanCountries.map((c) => (
                            <SelectItem key={c} value={c}>
                              {c}
                            </SelectItem>
                          ))}
                          <SelectItem value="__other_label" disabled>
                            --- Other ---
                          </SelectItem>
                          {otherCountries.map((c) => (
                            <SelectItem key={c} value={c}>
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                        City
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="Accra" {...field} className="rounded-xl" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="nationality"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                      Nationality
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="Country of citizenship" {...field} className="rounded-xl" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </SectionCard>

            {/* Social */}
            <SectionCard icon={Globe} title="Social & web">
              <FormField
                control={form.control}
                name="website"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                      Website
                    </FormLabel>
                    <FormControl>
                      <Input placeholder="https://yoursite.com" {...field} className="rounded-xl" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="linkedin"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                        LinkedIn
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="linkedin.com/in/you" {...field} className="rounded-xl" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="twitter"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                        X (Twitter)
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="@yourhandle" {...field} className="rounded-xl" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </SectionCard>

            {/* Business (optional, collapsible) */}
            <Collapsible open={showBusiness} onOpenChange={setShowBusiness}>
              <Card className="rounded-2xl">
                <CardContent className="p-4 space-y-4">
                  <CollapsibleTrigger className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-2 text-[13px] font-semibold tracking-tight">
                      <span className="h-7 w-7 rounded-full bg-primary/10 text-primary inline-flex items-center justify-center">
                        <Building2 className="h-3.5 w-3.5" strokeWidth={1.9} />
                      </span>
                      Business info
                      <Pill tone="neutral" uppercase={false} className="ml-1">
                        Optional
                      </Pill>
                    </div>
                    {showBusiness ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-4 pt-2">
                    <FormField
                      control={form.control}
                      name="companyName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                            Company / Organization
                          </FormLabel>
                          <FormControl>
                            <Input placeholder="Company name" {...field} className="rounded-xl" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="jobTitle"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                            Role / Title
                          </FormLabel>
                          <FormControl>
                            <Input
                              placeholder="e.g. Trader, CEO, Student"
                              {...field}
                              className="rounded-xl"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="taxId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
                            Tax ID / Business reg.
                          </FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Business registration number"
                              {...field}
                              className="rounded-xl"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CollapsibleContent>
                </CardContent>
              </Card>
            </Collapsible>

            {/* Identity (optional, collapsible) */}
            {/* Identity lives in verification, not here.
                These fields are what a KYC decision is made on — freely
                editable, they would let someone verify as one person and then
                present as another. They are collected once, as a sequence, at
                /verify, and shown read-only above once approved. */}

            {/* Public toggle */}
            <Card className="rounded-2xl">
              <CardContent className="p-4">
                <FormField
                  control={form.control}
                  name="isPublic"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between">
                      <div>
                        <FormLabel className="text-sm font-medium">Public profile</FormLabel>
                        <p className="text-[11px] text-muted-foreground">
                          Let others find and view your profile
                        </p>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Sticky save bar */}
            <div className="fixed bottom-[88px] inset-x-0 z-40 pointer-events-none">
              <div className="max-w-2xl mx-auto px-4 pointer-events-auto">
                <Button
                  type="submit"
                  className="w-full h-12 rounded-2xl shadow-lg"
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" /> Save profile
                    </>
                  )}
                </Button>
              </div>
            </div>
          </form>
        </Form>
        )}
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
      tone={verified ? "success" : pending ? "default" : "warning"}
    />
  );
}

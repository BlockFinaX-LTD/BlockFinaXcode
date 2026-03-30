import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
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
  Phone,
  MapPin,
  Globe,
  Shield,
  Save,
  CheckCircle,
  XCircle,
  Clock,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Copy,
  Loader2,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useWallet } from '@/hooks/use-wallet';
import { queryClient } from '@/lib/api-client';
import logoPath from "@/assets/logo.png";

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

export default function ProfilePage() {
  const [, setLocation] = useLocation();
  const { wallet, isUnlocked, walletExists, isLoading: walletLoading } = useWallet();
  const { toast } = useToast();
  const [showBusiness, setShowBusiness] = useState(false);
  const [showIdentity, setShowIdentity] = useState(false);

  useEffect(() => {
    if (!walletLoading) {
      if (!walletExists()) {
        setLocation('/wallet');
      } else if (!isUnlocked) {
        setLocation('/unlock-wallet');
      }
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
      if (profile.companyName || profile.jobTitle || profile.taxId) {
        setShowBusiness(true);
      }
      if (profile.idType || profile.idNumber) {
        setShowIdentity(true);
      }
    }
  }, [profile]);

  const saveMutation = useMutation({
    mutationFn: async (data: ProfileFormData) => {
      const cleaned: Record<string, any> = { walletAddress };
      for (const [key, val] of Object.entries(data)) {
        cleaned[key] = typeof val === 'string' && val.trim() === '' ? null : val;
      }
      if (profile) {
        const res = await fetch(`/api/profiles/${walletAddress}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cleaned),
        });
        if (!res.ok) throw new Error('Failed to update');
        return res.json();
      } else {
        const res = await fetch('/api/profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cleaned),
        });
        if (!res.ok) throw new Error('Failed to create');
        return res.json();
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/profiles', walletAddress] });
      toast({ title: 'Profile saved', description: 'Your profile has been updated successfully.' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to save profile. Please try again.', variant: 'destructive' });
    },
  });

  const onSubmit = (data: ProfileFormData) => {
    saveMutation.mutate(data);
  };

  const copyAddress = () => {
    navigator.clipboard.writeText(walletAddress);
    toast({ title: 'Copied', description: 'Wallet address copied to clipboard.' });
  };

  const shortAddr = walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : '';

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
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-8">
      <header className="sticky top-0 z-40 bg-card/80 backdrop-blur-md border-b border-border/50">
        <div className="w-full px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setLocation('/home')} className="h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <img src={logoPath} alt="BlockFinaX" className="w-7 h-7 object-contain" />
            <h1 className="text-lg font-bold">Profile</h1>
          </div>
          {profile && (
            <Badge variant="secondary" className="text-xs">
              {profile.kycStatus === 'verified' ? (
                <span className="flex items-center gap-1"><CheckCircle className="h-3 w-3 text-green-500" /> Verified</span>
              ) : (
                <span className="flex items-center gap-1"><Clock className="h-3 w-3 text-yellow-500" /> Unverified</span>
              )}
            </Badge>
          )}
        </div>
      </header>

      <main className="w-full px-4 py-4 space-y-4">
        <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-background">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-primary/10 border-2 border-primary/30 flex items-center justify-center shrink-0">
              <span className="text-lg font-bold text-primary">{getInitials()}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold truncate">
                {form.watch('displayName') || form.watch('firstName') || 'Set up your profile'}
              </p>
              <button onClick={copyAddress} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <span className="font-mono">{shortAddr}</span>
                <Copy className="h-3 w-3" />
              </button>
            </div>
          </CardContent>
        </Card>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <User className="h-4 w-4 text-primary" />
                  <span>Personal Info</span>
                </div>

                <FormField
                  control={form.control}
                  name="displayName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Display Name</FormLabel>
                      <FormControl>
                        <Input placeholder="How others see you" {...field} />
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
                        <FormLabel>First Name</FormLabel>
                        <FormControl>
                          <Input placeholder="John" {...field} />
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
                        <FormLabel>Last Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Doe" {...field} />
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
                      <FormLabel>Bio</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Tell others a bit about yourself..." className="min-h-[80px] resize-none" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Mail className="h-4 w-4 text-primary" />
                  <span>Contact</span>
                </div>

                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="you@example.com" {...field} />
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
                      <FormLabel>Phone Number</FormLabel>
                      <FormControl>
                        <Input placeholder="+233 XX XXX XXXX" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <MapPin className="h-4 w-4 text-primary" />
                  <span>Location</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="country"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Country</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || ''}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select country" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent className="max-h-60">
                            <SelectItem value="__africa_label" disabled>--- Africa ---</SelectItem>
                            {africanCountries.map(c => (
                              <SelectItem key={c} value={c}>{c}</SelectItem>
                            ))}
                            <SelectItem value="__other_label" disabled>--- Other ---</SelectItem>
                            {otherCountries.map(c => (
                              <SelectItem key={c} value={c}>{c}</SelectItem>
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
                        <FormLabel>City</FormLabel>
                        <FormControl>
                          <Input placeholder="Accra" {...field} />
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
                      <FormLabel>Nationality</FormLabel>
                      <FormControl>
                        <Input placeholder="Country of citizenship" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Globe className="h-4 w-4 text-primary" />
                  <span>Social & Web</span>
                </div>
                <FormField
                  control={form.control}
                  name="website"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Website</FormLabel>
                      <FormControl>
                        <Input placeholder="https://yoursite.com" {...field} />
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
                        <FormLabel>LinkedIn</FormLabel>
                        <FormControl>
                          <Input placeholder="linkedin.com/in/you" {...field} />
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
                        <FormLabel>X (Twitter)</FormLabel>
                        <FormControl>
                          <Input placeholder="@yourhandle" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            <Collapsible open={showBusiness} onOpenChange={setShowBusiness}>
              <Card>
                <CardContent className="p-4 space-y-4">
                  <CollapsibleTrigger className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Building2 className="h-4 w-4 text-primary" />
                      <span>Business Info</span>
                      <Badge variant="outline" className="text-[10px] ml-1">Optional</Badge>
                    </div>
                    {showBusiness ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-4 pt-2">
                    <FormField
                      control={form.control}
                      name="companyName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Company / Organization</FormLabel>
                          <FormControl>
                            <Input placeholder="Company name" {...field} />
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
                          <FormLabel>Role / Title</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. Trader, CEO, Student" {...field} />
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
                          <FormLabel>Tax ID / Business Reg.</FormLabel>
                          <FormControl>
                            <Input placeholder="Business registration number" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CollapsibleContent>
                </CardContent>
              </Card>
            </Collapsible>

            <Collapsible open={showIdentity} onOpenChange={setShowIdentity}>
              <Card>
                <CardContent className="p-4 space-y-4">
                  <CollapsibleTrigger className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Shield className="h-4 w-4 text-primary" />
                      <span>Identity Verification</span>
                      <Badge variant="outline" className="text-[10px] ml-1">Optional</Badge>
                    </div>
                    {showIdentity ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-4 pt-2">
                    <FormField
                      control={form.control}
                      name="idType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>ID Type</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || ''}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select ID type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="passport">Passport</SelectItem>
                              <SelectItem value="driver_license">Driver's License</SelectItem>
                              <SelectItem value="national_id">National ID</SelectItem>
                              <SelectItem value="voter_id">Voter's ID</SelectItem>
                              <SelectItem value="residence_permit">Residence Permit</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="idNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>ID Number</FormLabel>
                          <FormControl>
                            <Input placeholder="Document number" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="dateOfBirth"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Date of Birth</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CollapsibleContent>
                </CardContent>
              </Card>
            </Collapsible>

            <Card>
              <CardContent className="p-4">
                <FormField
                  control={form.control}
                  name="isPublic"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between">
                      <div>
                        <FormLabel className="text-sm font-medium">Public Profile</FormLabel>
                        <p className="text-xs text-muted-foreground">Let others find and view your profile</p>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Button
              type="submit"
              className="w-full h-12 text-base font-semibold"
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? (
                <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Saving...</span>
              ) : (
                <span className="flex items-center gap-2"><Save className="h-4 w-4" /> Save Profile</span>
              )}
            </Button>
          </form>
        </Form>
      </main>
    </div>
  );
}

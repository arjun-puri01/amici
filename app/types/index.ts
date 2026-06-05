// ─── Database row types (match Supabase schema) ───────────────────────────────

export type User = {
  id: string;
  email: string;
  first_name: string;
  profile_photo_url: string | null;
  graduation_year: number;
  hometown_city: string;
  hometown_state: string;
  instagram_handle: string | null;
  phone_number: string | null;
  expo_push_token: string | null;
  created_at: string;
};

export type Interest = {
  id: string;
  label: string;
  category: string;
};

export type UserInterest = {
  user_id: string;
  interest_id: string;
};

// day_of_week: 0 = Sunday, 6 = Saturday
export type ActiveWindow = {
  id: string;
  user_id: string;
  day_of_week: number;
  start_time: string; // HH:MM:SS
  end_time: string;   // HH:MM:SS
};

export type LocationPing = {
  id: string;
  user_id: string;
  lat: number;
  lng: number;
  timestamp: string;
};

export type MatchStatus = 'pending' | 'talked' | 'connected' | 'missed';
export type TriggerType = 'hometown' | 'interest';

export type Match = {
  id: string;
  user_id_1: string;
  user_id_2: string;
  trigger_type: TriggerType;
  trigger_value: string;
  fired_at: string;
  status: MatchStatus;
  talked_by_user_id: string | null;
};

export type Connection = {
  id: string;
  match_id: string;
  user_id_1: string;
  user_id_2: string;
  shared_instagram_1: boolean;
  shared_instagram_2: boolean;
  shared_phone_1: boolean;
  shared_phone_2: boolean;
  shared_at_1: string | null;
  shared_at_2: string | null;
  connected_at: string;
};

export type DormExclusionZone = {
  id: string;
  user_id: string;
  lat: number;
  lng: number;
  radius_meters: number; // default 100
};

// ─── App state / UI types ──────────────────────────────────────────────────────

// Profile as seen in the app (joined from users + interests)
export type UserProfile = User & {
  interests: Interest[];
  active_windows: ActiveWindow[];
  dorm_exclusion_zone: DormExclusionZone | null;
};

// Match with the other user's public info attached (no contact info)
export type MatchWithUser = Match & {
  other_user: Pick<User, 'id' | 'first_name' | 'profile_photo_url' | 'graduation_year'>;
};

// What gets shown on the history screen
export type HistoryEntry = MatchWithUser & {
  times_matched: number;
  connection: Connection | null;
};

// Navigation param types
export type RootStackParamList = {
  // Auth
  SignIn: undefined;
  SignUp: undefined;
  // Onboarding (sequential after sign-up)
  OnboardingPhoto: undefined;
  OnboardingGradYear: undefined;
  OnboardingHometown: undefined;
  OnboardingInterests: undefined;
  OnboardingWindows: undefined;
  OnboardingDorm: undefined;
  OnboardingContact: undefined;
  // Main app
  Main: undefined;
  History: undefined;
  Profile: undefined;
  // Match modal
  MatchModal: { matchId: string };
  // Share modal (after mutual confirmation)
  ShareModal: { matchId: string; connectionId: string };
};

import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export const supabaseReady = Boolean(url && anonKey);

export const supabase: SupabaseClient = supabaseReady
  ? createClient(url, anonKey)
  : createClient("https://placeholder.supabase.co", "placeholder-anon-key");

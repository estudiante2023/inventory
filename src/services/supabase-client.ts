import { createClient } from '@supabase/supabase-js';
import { environment } from '../environments/environment'; // Importa el environment

// Ahora usa las variables del environment
export const supabase = createClient(
  environment.supabaseUrl,
  environment.supabaseAnonKey,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      storage: localStorage
    }
  }
);
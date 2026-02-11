import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { supabase } from './supabase-client';
import { BehaviorSubject } from 'rxjs';
import { UsuariosOnlineService } from './usuarios-online.service';

export interface UserProfile {
  id: string;
  nombre_completo?: string;
  role_id?: number;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  // Propiedad Observable para el estado de autenticación
  private isAuthenticatedSubject = new BehaviorSubject<boolean>(false);
  public isAuthenticated$ = this.isAuthenticatedSubject.asObservable();

  constructor(private router: Router,private usuariosOnlineService: UsuariosOnlineService ) {
    this.initializeAuth();
    this.setupAuthListener();
    
  }

  private async initializeAuth() {
    try {
      const session = await this.getCurrentSession();
      this.isAuthenticatedSubject.next(!!session);
    } catch (error) {
      console.error('Error inicializando autenticación:', error);
      this.isAuthenticatedSubject.next(false);
    }
  }

  private setupAuthListener() {
    supabase.auth.onAuthStateChange(async (event, session) => { 
      const isAuthenticated = !!session;
      this.isAuthenticatedSubject.next(isAuthenticated);
      
      // Redirigir automáticamente
      if (session) {
        // Si hay sesión y está en login/registro, ir a inicio
        if (this.router.url === '/login' || this.router.url === '/registro') {
          this.router.navigate(['/inicio']);
        }
      } else {
        // Si no hay sesión y no está en login/registro, ir a login
        if (this.router.url !== '/login' && this.router.url !== '/registro') {
          this.router.navigate(['/login']);
        }
      }
    });
  }

  // ==================== REGISTRO ====================
  async signUp(email: string, password: string, userMetadata?: { nombre_completo: string }) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: userMetadata
      }
    });

    if (error) throw error;
    return data;
  }

  // ==================== INICIO DE SESIÓN ====================
// ==================== INICIO DE SESIÓN ====================
 async signIn(email: string, password: string) {
    // 1. Primero intentar login
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;
    
    // 2. VERIFICAR SI EL USUARIO ESTÁ ACTIVO
    if (data.user) {
      try {
        const { data: perfil, error: perfilError } = await supabase
          .from('perfiles')
          .select('estado')
          .eq('id', data.user.id)
          .single();

        // Si no existe perfil, podría ser un usuario nuevo - permitir acceso
        if (perfilError && perfilError.code !== 'PGRST116') {
          console.error('Error verificando perfil:', perfilError);
        }
        
        // Si existe perfil Y está inactivo, cerrar sesión y mostrar error
        if (perfil && perfil.estado === 'inactivo') {
          // Cerrar sesión inmediatamente
          await supabase.auth.signOut();
          throw new Error('Tu cuenta está desactivada. Contacta al administrador.');
        }
        
        // 3. AGREGAR USUARIO A LA TABLA DE USUARIOS EN LÍNEA <-- AÑADE ESTO
        if (data.user.id) {
          await this.usuariosOnlineService.agregarUsuarioOnline(data.user.id); 
        }
        
      } catch (error) {
        // Si hay error en la verificación, lanzar el error
        if (error instanceof Error && error.message.includes('desactivada')) {
          throw error; // Lanzar error específico de cuenta desactivada
        }
        // Otros errores no deben bloquear el login
        console.error('Error en verificación de estado:', error);
      }
    }
    
    // 3. Si todo está bien, redirigir
    this.router.navigate(['/inicio']).then(() => {
      window.location.reload();
    });
    
    return data;
  }

  // ==================== CERRAR SESIÓN ====================
  async signOut() {
    // 1. Obtener usuario actual ANTES de cerrar sesión
    const { data: { user } } = await supabase.auth.getUser();
    
    // 2. QUITAR USUARIO DE LA TABLA DE USUARIOS EN LÍNEA <-- AÑADE ESTO
    if (user?.id) {
      await this.usuariosOnlineService.quitarUsuarioOnline(user.id); 
    }
    
    // 3. Cerrar sesión en Supabase
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    
    // 4. Forzar navegación a login
    this.router.navigate(['/login']).then(() => {
      // Recargar la ruta actual
      window.location.reload();
    });
  }


  // ==================== OBTENER SESIÓN ACTUAL ====================
  async getCurrentSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session;
  }

  // ==================== OBTENER PERFIL DEL USUARIO ====================
  async getUserProfile(userId: string): Promise<UserProfile | null> {
    const { data, error } = await supabase
      .from('perfiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error al obtener perfil:', error);
    }
    return data;
  }

  // ==================== CERRAR SESIÓN ====================
  
}
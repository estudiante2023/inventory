import { Injectable } from '@angular/core';
import { supabase } from './supabase-client';
import { environment } from '../environments/environment';

export interface Usuario {
  id: string;
  email: string;
  nombre_completo: string | null;
  role_id: number | null;
  telefono: string | null;
  avatar_url: string | null;
  estado: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  
  // Información del rol
  rol_nombre?: string;
  rol_descripcion?: string;
  rol_nivel_permisos?: number;
}

export interface UpdateUsuarioData {
  nombre_completo?: string;
  role_id?: number | null;
  telefono?: string;
  avatar_url?: string;
  estado?: string;
}

@Injectable({
  providedIn: 'root'
})
export class UsuariosService {
  private tableName = 'perfiles';

  constructor() {
  }

  // ==================== CRUD COMPLETO ====================

  /**
   * Obtener todos los usuarios con paginación
   */
  async getUsuarios(filters?: { 
    estado?: string; 
    search?: string;
    role_id?: number;
    limit?: number;
    page?: number 
  }) {
    try {
      
      let query = supabase
        .from(this.tableName)
        .select(`
          *,
          roles:role_id (id, nombre, descripcion, nivel_permisos, esta_activo)
        `, { count: 'exact' })
        .order('created_at', { ascending: false });

      // Aplicar filtros
      if (filters?.estado && filters.estado !== 'todos') {
        query = query.eq('estado', filters.estado);
      }

      if (filters?.role_id) {
        query = query.eq('role_id', filters.role_id);
      }

      if (filters?.search) {
        query = query.or(`nombre_completo.ilike.%${filters.search}%,telefono.ilike.%${filters.search}%`);
      }

      // Paginación
      if (filters?.limit && filters?.page) {
        const from = (filters.page - 1) * filters.limit;
        const to = from + filters.limit - 1;
        query = query.range(from, to);
      }

      const { data: perfiles, error, count } = await query;
      
      if (error) {
        console.error('❌ Error en getUsuarios:', error);
        throw error;
      }

      // Enriquecer con datos de auth (email, last_sign_in, etc.)
      const usuariosCompletos = await this.enriquecerConDatosAuth(perfiles || []);

      return { 
        data: usuariosCompletos, 
        count: count || 0,
        page: filters?.page || 1,
        limit: filters?.limit || 10
      };
      
    } catch (error: any) {
      console.error('💥 Error crítico en getUsuarios:', error);
      throw this.handleError(error, 'obtener usuarios');
    }
  }

  /**
   * Obtener un usuario por ID
   */
  async getUsuarioById(id: string): Promise<Usuario> {
    try {
      
      // Obtener perfil con información del rol
      const { data: perfil, error: perfilError } = await supabase
        .from(this.tableName)
        .select(`
          *,
          roles:role_id (id, nombre, descripcion, nivel_permisos, esta_activo)
        `)
        .eq('id', id)
        .single();

      if (perfilError) {
        // Si no existe el perfil, quizás el usuario está recién registrado
        if (perfilError.code === 'PGRST116') {
          console.warn(`⚠️ Perfil no encontrado para ID: ${id}, creando perfil básico`);
          // Podríamos crear un perfil básico aquí si es necesario
        }
        throw perfilError;
      }

      // Obtener datos de auth (email, last_sign_in, etc.)
      const authData = await this.obtenerDatosAuth(id);
      
      const usuario: Usuario = {
        id: perfil.id,
        email: authData?.email || 'email@no-disponible.com',
        nombre_completo: perfil.nombre_completo,
        role_id: perfil.role_id,
        telefono: perfil.telefono,
        avatar_url: perfil.avatar_url,
        estado: perfil.estado || 'activo',
        last_sign_in_at: authData?.last_sign_in_at || null,
        email_confirmed_at: authData?.email_confirmed_at || null,
        created_at: perfil.created_at,
        updated_at: perfil.updated_at,
        rol_nombre: (perfil as any).roles?.nombre,
        rol_descripcion: (perfil as any).roles?.descripcion,
        rol_nivel_permisos: (perfil as any).roles?.nivel_permisos
      };

      return usuario;
      
    } catch (error: any) {
      console.error(`❌ Error obteniendo usuario ${id}:`, error);
      throw this.handleError(error, `obtener usuario ${id}`);
    }
  }
async obtenerNombreUsuario(userId: string): Promise<string> {
  try {
    const { data: perfil, error } = await supabase
      .from('perfiles')
      .select('nombre_completo')
      .eq('id', userId)
      .single();

    if (!error && perfil?.nombre_completo) {
      return perfil.nombre_completo;
    }
    return 'Usuario';
  } catch (error) {
    return 'Usuario';
  }
}
  /**
   * Actualizar usuario (perfil)
   */
  async updateUsuario(id: string, updates: UpdateUsuarioData): Promise<Usuario> {
    try {
      
      // Verificar si el perfil existe
      const { data: perfilExistente, error: checkError } = await supabase
        .from(this.tableName)
        .select('id')
        .eq('id', id)
        .maybeSingle();

      let perfilActualizado: any = null;

      if (perfilExistente) {
        // Actualizar perfil existente
        const { data: perfil, error: perfilError } = await supabase
          .from(this.tableName)
          .update(updates)
          .eq('id', id)
          .select(`
            *,
            roles:role_id (id, nombre, descripcion, nivel_permisos, esta_activo)
          `)
          .single();

        if (perfilError) throw perfilError;
        perfilActualizado = perfil;
      } else {
        // Crear perfil si no existe (puede pasar con usuarios recién registrados)
        
        const { data: perfil, error: perfilError } = await supabase
          .from(this.tableName)
          .insert([{
            id: id,
            nombre_completo: updates.nombre_completo || '',
            role_id: updates.role_id || null,
            telefono: updates.telefono || null,
            avatar_url: updates.avatar_url || null,
            estado: updates.estado || 'activo'
          }])
          .select(`
            *,
            roles:role_id (id, nombre, descripcion, nivel_permisos, esta_activo)
          `)
          .single();

        if (perfilError) throw perfilError;
        perfilActualizado = perfil;
      }

      // Obtener datos de auth para completar
      const authData = await this.obtenerDatosAuth(id);
      
      const usuario: Usuario = {
        id: id,
        email: authData?.email || 'email@no-disponible.com',
        nombre_completo: perfilActualizado.nombre_completo,
        role_id: perfilActualizado.role_id,
        telefono: perfilActualizado.telefono,
        avatar_url: perfilActualizado.avatar_url,
        estado: perfilActualizado.estado || 'activo',
        last_sign_in_at: authData?.last_sign_in_at || null,
        email_confirmed_at: authData?.email_confirmed_at || null,
        created_at: perfilActualizado.created_at,
        updated_at: perfilActualizado.updated_at,
        rol_nombre: perfilActualizado.roles?.nombre,
        rol_descripcion: perfilActualizado.roles?.descripcion,
        rol_nivel_permisos: perfilActualizado.roles?.nivel_permisos
      };

      return usuario;
      
    } catch (error: any) {
      console.error(`❌ Error actualizando usuario ${id}:`, error);
      throw this.handleError(error, `actualizar usuario ${id}`);
    }
  }

  /**
   * Desactivar usuario
   */
  async desactivarUsuario(id: string): Promise<boolean> {
    try {
      
      // Actualizar estado en el perfil
      const { error } = await supabase
        .from(this.tableName)
        .update({ estado: 'inactivo' })
        .eq('id', id);

      if (error) throw error;
      
      return true;
      
    } catch (error: any) {
      console.error(`❌ Error desactivando usuario ${id}:`, error);
      throw this.handleError(error, `desactivar usuario ${id}`);
    }
  }

  /**
   * Activar usuario
   */
  async activarUsuario(id: string): Promise<boolean> {
    try {
      
      const { error } = await supabase
        .from(this.tableName)
        .update({ estado: 'activo' })
        .eq('id', id);

      if (error) throw error;
      
      return true;
      
    } catch (error: any) {
      console.error(`❌ Error activando usuario ${id}:`, error);
      throw this.handleError(error, `activar usuario ${id}`);
    }
  }

  /**
   * Cambiar rol de usuario
   */
  async cambiarRolUsuario(id: string, role_id: number | null): Promise<boolean> {
    try {
      
      const { error } = await supabase
        .from(this.tableName)
        .update({ role_id })
        .eq('id', id);

      if (error) throw error;
      
      return true;
      
    } catch (error: any) {
      console.error(`❌ Error cambiando rol del usuario ${id}:`, error);
      throw this.handleError(error, `cambiar rol del usuario ${id}`);
    }
  }

  /**
   * Eliminar usuario permanentemente (solo perfil)
   */
  async eliminarUsuario(id: string): Promise<boolean> {
    try {
      
      // 1. Verificar si hay datos asociados (trazabilidad, etc.)
      // Esto depende de tu modelo de datos
      
      // 2. Eliminar perfil (la cuenta de auth permanece)
      const { error } = await supabase
        .from(this.tableName)
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      return true;
      
    } catch (error: any) {
      console.error(`❌ Error eliminando usuario ${id}:`, error);
      throw this.handleError(error, `eliminar usuario ${id}`);
    }
  }

  // ==================== MÉTODOS ESPECÍFICOS ====================

  /**
   * Obtener usuarios activos para dropdowns
   */
  async getUsuariosActivos() {
    try {
      const { data: perfiles, error } = await supabase
        .from(this.tableName)
        .select('id, nombre_completo')
        .eq('estado', 'activo')
        .order('nombre_completo');

      if (error) throw error;
      
      // Enriquecer con email
      const usuariosConEmail = await Promise.all(
        (perfiles || []).map(async (perfil) => {
          const authData = await this.obtenerDatosAuth(perfil.id);
          return {
            id: perfil.id,
            nombre: perfil.nombre_completo || 'Sin nombre',
            email: authData?.email || 'email@no-disponible.com'
          };
        })
      );

      return usuariosConEmail;
      
    } catch (error: any) {
      console.error('❌ Error obteniendo usuarios activos:', error);
      return [];
    }
  }

  /**
   * Verificar si existe usuario con mismo nombre
   */
  async checkNombreExists(nombre: string, excludeId?: string): Promise<boolean> {
    try {
      let query = supabase
        .from(this.tableName)
        .select('id')
        .eq('nombre_completo', nombre);

      if (excludeId) {
        query = query.neq('id', excludeId);
      }

      const { data, error } = await query;
      
      if (error) throw error;
      return (data?.length || 0) > 0;
      
    } catch (error) {
      console.error('❌ Error verificando nombre:', error);
      return false;
    }
  }

  /**
   * Estadísticas de usuarios
   */
  async getEstadisticas() {
    try {
      const { data, error } = await supabase
        .from(this.tableName)
        .select('estado, role_id');

      if (error) throw error;

      const total = data?.length || 0;
      const activos = data?.filter(u => u.estado === 'activo').length || 0;
      const inactivos = data?.filter(u => u.estado === 'inactivo').length || 0;

      // Contar por rol
      const porRol: { [rol_id: number]: number } = {};
      data?.forEach(u => {
        if (u.role_id) {
          porRol[u.role_id] = (porRol[u.role_id] || 0) + 1;
        }
      });

      return { total, activos, inactivos, por_rol: porRol };
      
    } catch (error) {
      console.error('❌ Error obteniendo estadísticas:', error);
      return { total: 0, activos: 0, inactivos: 0, por_rol: {} };
    }
  }

  /**
   * Buscar usuarios por email o nombre
   */
  async buscarUsuarios(termino: string): Promise<Usuario[]> {
    try {
      const { data: perfiles, error } = await supabase
        .from(this.tableName)
        .select(`
          *,
          roles:role_id (id, nombre, descripcion, nivel_permisos, esta_activo)
        `)
        .or(`nombre_completo.ilike.%${termino}%,telefono.ilike.%${termino}%`)
        .limit(10);

      if (error) throw error;

      // Enriquecer con datos de auth
      return await this.enriquecerConDatosAuth(perfiles || []);
      
    } catch (error) {
      console.error('❌ Error buscando usuarios:', error);
      return [];
    }
  }







  /**
 * Obtiene una lista simple con los nombres de los privilegios de un usuario
 * @param userId ID del usuario (UUID)
 * @returns Arreglo de strings con los nombres de los privilegios
 */
async getUserPrivilegesList(userId: string): Promise<string[]> {
  try {
    
    // 1. Obtener el rol del usuario
    const { data: perfil, error: perfilError } = await supabase
      .from('perfiles')
      .select('role_id')
      .eq('id', userId)
      .single();

    if (perfilError || !perfil?.role_id) {
      return []; // Retorna arreglo vacío
    }

    const roleId = perfil.role_id;

    // 2. Obtener los IDs de privilegios del rol
    const { data: privilegiosData, error: privError } = await supabase
      .from('rol_privilegio')
      .select('privilegio_id')
      .eq('role_id', roleId);

    if (privError || !privilegiosData || privilegiosData.length === 0) {
      return [];
    }

    // 3. Extraer IDs de privilegios
    const privIds = privilegiosData.map(item => item.privilegio_id);

    // 4. Obtener los códigos/nombres de los privilegios
    const { data: privilegios, error: codigosError } = await supabase
      .from('privilegios')
      .select('codigo')
      .in('id', privIds);

    if (codigosError || !privilegios) {
      return [];
    }

    // 5. Extraer solo los códigos en un arreglo simple
    const privilegiosList = privilegios.map(p => p.codigo);
 
    return privilegiosList;

  } catch (error) {
    console.error('💥 Error inesperado:', error);
    return []; // Siempre retorna arreglo vacío en caso de error
  }
}
  // ==================== MÉTODOS PRIVADOS DE AYUDA ====================

  /**
   * Enriquecer perfiles con datos de auth (email, last_sign_in, etc.)
   * Nota: Esto requiere una función de Edge o RPC ya que no podemos acceder directamente a auth.users
   */
  private async enriquecerConDatosAuth(perfiles: any[]): Promise<Usuario[]> {
    // Implementación básica - en una app real necesitarías una función de Edge
    // Por ahora, devolvemos los perfiles con datos básicos
    
    return perfiles.map(perfil => ({
      id: perfil.id,
      email: 'email@no-disponible.com', // Placeholder - necesitas función de Edge
      nombre_completo: perfil.nombre_completo,
      role_id: perfil.role_id,
      telefono: perfil.telefono,
      avatar_url: perfil.avatar_url,
      estado: perfil.estado || 'activo',
      last_sign_in_at: null,
      email_confirmed_at: null,
      created_at: perfil.created_at,
      updated_at: perfil.updated_at,
      rol_nombre: perfil.roles?.nombre,
      rol_descripcion: perfil.roles?.descripcion,
      rol_nivel_permisos: perfil.roles?.nivel_permisos
    }));
  }

  /**
   * Obtener datos de auth para un usuario específico
   */
  private async obtenerDatosAuth(userId: string): Promise<any> {
    try {
      // Esto es un placeholder - en realidad necesitas una función de Edge
      // porque no puedes acceder a auth.users desde el cliente
      return null;
    } catch (error) {
      console.error(`❌ Error obteniendo datos de auth para ${userId}:`, error);
      return null;
    }
  }

  // ==================== MANEJO DE ERRORES ====================

  private handleError(error: any, context: string): Error {
    console.error(`[${context}] Error:`, error);
    
    // Errores comunes de Supabase
    if (error.code === '23505') {
      return new Error('Ya existe un usuario con ese nombre');
    }
    
    if (error.code === '42501') {
      return new Error('No tienes permisos para realizar esta acción');
    }
    
    if (error.code === '42P01') {
      return new Error('La tabla de perfiles no existe');
    }
    
    if (error.message?.includes('JWT')) {
      return new Error('Error de autenticación. Por favor, inicia sesión nuevamente');
    }
    
    if (error.code === 'PGRST116') {
      return new Error('Usuario no encontrado');
    }
    
    // Mensaje personalizado para el usuario
    return new Error(error.message || `Error al ${context}`);
  }
}
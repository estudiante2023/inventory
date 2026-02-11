// src/app/services/roles.service.ts
import { Injectable } from '@angular/core';
import { supabase } from './supabase-client';

export interface Rol {
  id: number;
  nombre: string;
  descripcion: string | null;
  nivel_permisos: number;
  esta_activo: boolean;
  created_at: string;
  updated_at: string;
}

export interface Privilegio {
  id: number;
  codigo: string;
  nombre: string;
  modulo: string;
  accion: string;
  created_at: string;
}

export interface RolPrivilegio {
  id: number;
  role_id: number;
  privilegio_id: number;
  created_at: string;
}

export interface RolConPrivilegios extends Rol {
  privilegios: Privilegio[];
}

@Injectable({
  providedIn: 'root'
})
export class RolesService {
  private rolesTable = 'roles';
  private privilegiosTable = 'privilegios';
  private rolPrivilegioTable = 'rol_privilegio';

  constructor() { 
  }

  // ==================== CRUD PARA ROLES ====================

  // Obtener todos los roles con paginación
  async getRoles(filters?: { 
    esta_activo?: boolean; 
    search?: string;
    limit?: number;
    page?: number;
    ordenar_por?: string;
    orden?: 'asc' | 'desc';
  }) {
    try { 
      
      let query = supabase
        .from(this.rolesTable)
        .select('*', { count: 'exact' });

      // Aplicar filtros
      if (filters?.esta_activo !== undefined) {
        query = query.eq('esta_activo', filters.esta_activo);
      }

      if (filters?.search) {
        query = query.or(`nombre.ilike.%${filters.search}%,descripcion.ilike.%${filters.search}%`);
      }

      // Ordenación
      const ordenarPor = filters?.ordenar_por || 'created_at';
      const orden = filters?.orden || 'desc';
      query = query.order(ordenarPor, { ascending: orden === 'asc' });

      // Paginación
      if (filters?.limit && filters?.page) {
        const from = (filters.page - 1) * filters.limit;
        const to = from + filters.limit - 1;
        query = query.range(from, to);
      }

      const { data, error, count } = await query;
      
      if (error) {
        throw error;
      }
       
      return { 
        data: data as Rol[], 
        count: count || 0,
        page: filters?.page || 1,
        limit: filters?.limit || 10
      };
      
    } catch (error: any) {
      throw this.handleError(error, 'obtener roles');
    }
  }

  // Obtener un rol por ID
  async getRolById(id: number): Promise<Rol> {
    try {
      
      const { data, error } = await supabase
        .from(this.rolesTable)
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      
      return data as Rol;
      
    } catch (error: any) {
      throw this.handleError(error, `obtener rol ${id}`);
    }
  }

  // Obtener rol con sus privilegios
  async getRolConPrivilegios(id: number): Promise<RolConPrivilegios> {
    try { 
      
      // Obtener el rol
      const rol = await this.getRolById(id);
      
      // Obtener los privilegios del rol
      const privilegios = await this.getPrivilegiosDelRol(id);
      
      return {
        ...rol,
        privilegios
      };
      
    } catch (error: any) {
      console.error(`❌ Error obteniendo rol con privilegios ${id}:`, error);
      throw this.handleError(error, `obtener rol con privilegios ${id}`);
    }
  }

  // Crear nuevo rol
  async createRol(rol: Omit<Rol, 'id' | 'created_at' | 'updated_at'>) {
    try { 
      
      // Verificar si ya existe un rol con el mismo nombre
      const { data: exists } = await supabase
        .from(this.rolesTable)
        .select('id')
        .eq('nombre', rol.nombre)
        .maybeSingle();
      
      if (exists) {
        throw new Error(`Ya existe un rol con el nombre "${rol.nombre}"`);
      }

      const { data, error } = await supabase
        .from(this.rolesTable)
        .insert([{
          ...rol,
          esta_activo: rol.esta_activo ?? true,
          nivel_permisos: rol.nivel_permisos || 0,
          updated_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (error) throw error;
       
      return data as Rol;
      
    } catch (error: any) {
      console.error('❌ Error creando rol:', error);
      throw this.handleError(error, 'crear rol');
    }
  }

  // Actualizar rol
  async updateRol(id: number, updates: Partial<Rol>) {
    try { 
      
      // Si se actualiza el nombre, verificar que no exista otro con el mismo nombre
      if (updates.nombre) {
        const { data: exists } = await supabase
          .from(this.rolesTable)
          .select('id')
          .eq('nombre', updates.nombre)
          .neq('id', id)
          .maybeSingle();
        
        if (exists) {
          throw new Error(`Ya existe otro rol con el nombre "${updates.nombre}"`);
        }
      }

      const { data, error } = await supabase
        .from(this.rolesTable)
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
       
      return data as Rol;
      
    } catch (error: any) {
      console.error(`❌ Error actualizando rol ${id}:`, error);
      throw this.handleError(error, `actualizar rol ${id}`);
    }
  }

  // Desactivar rol
  async desactivarRol(id: number) {
    try { 
      
      // Verificar si hay perfiles usando este rol
      const { data: perfiles, error: perfilesError } = await supabase
        .from('perfiles')
        .select('id')
        .eq('role_id', id)
        .limit(1);
      
      if (perfilesError) throw perfilesError;
      
      if (perfiles && perfiles.length > 0) {
        throw new Error('No se puede desactivar el rol porque hay perfiles asignados a él');
      }

      const { error } = await supabase
        .from(this.rolesTable)
        .update({ 
          esta_activo: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', id);

      if (error) throw error;
      
      return true;
      
    } catch (error: any) {
      console.error(`❌ Error desactivando rol ${id}:`, error);
      throw this.handleError(error, `desactivar rol ${id}`);
    }
  }

  // Activar rol
  async activarRol(id: number) {
    try { 
      
      const { error } = await supabase
        .from(this.rolesTable)
        .update({ 
          esta_activo: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', id);

      if (error) throw error;
       
      return true;
      
    } catch (error: any) {
      console.error(`❌ Error activando rol ${id}:`, error);
      throw this.handleError(error, `activar rol ${id}`);
    }
  }

  // Eliminar rol (solo si no tiene perfiles asignados)
  async eliminarRol(id: number) {
    try {
      
      // Verificar si hay perfiles usando este rol
      const { data: perfiles } = await supabase
        .from('perfiles')
        .select('id')
        .eq('role_id', id)
        .limit(1);
      
      if (perfiles && perfiles.length > 0) {
        throw new Error('No se puede eliminar el rol porque hay perfiles asignados a él');
      }

      // Primero eliminar las relaciones con privilegios
      await this.eliminarTodosPrivilegiosDeRol(id);

      // Luego eliminar el rol
      const { error } = await supabase
        .from(this.rolesTable)
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      return true;
      
    } catch (error: any) {
      console.error(`❌ Error eliminando rol ${id}:`, error);
      throw this.handleError(error, `eliminar rol ${id}`);
    }
  }

  // ==================== GESTIÓN DE PRIVILEGIOS ====================

  // Obtener todos los privilegios disponibles
  async getPrivilegios(filters?: { 
    modulo?: string;
    search?: string;
  }): Promise<Privilegio[]> {
    try {
      
      let query = supabase
        .from(this.privilegiosTable)
        .select('*')
        .order('modulo', { ascending: true })
        .order('codigo', { ascending: true });

      // Aplicar filtros
      if (filters?.modulo) {
        query = query.eq('modulo', filters.modulo);
      }

      if (filters?.search) {
        query = query.or(`codigo.ilike.%${filters.search}%,nombre.ilike.%${filters.search}%,modulo.ilike.%${filters.search}%`);
      }

      const { data, error } = await query;
      
      if (error) {
        console.error('❌ Error en getPrivilegios:', error);
        throw error;
      }
      
      return data as Privilegio[];
      
    } catch (error: any) {
      console.error('💥 Error crítico en getPrivilegios:', error);
      throw this.handleError(error, 'obtener privilegios');
    }
  }

  // Obtener privilegios agrupados por módulo
  async getPrivilegiosAgrupados(): Promise<Record<string, Privilegio[]>> {
    try {
      const privilegios = await this.getPrivilegios();
      
      // Agrupar por módulo
      const agrupados: Record<string, Privilegio[]> = {};
      
      privilegios.forEach(privilegio => {
        if (!agrupados[privilegio.modulo]) {
          agrupados[privilegio.modulo] = [];
        }
        agrupados[privilegio.modulo].push(privilegio);
      });
      
      return agrupados;
      
    } catch (error: any) {
      console.error('❌ Error agrupando privilegios:', error);
      throw this.handleError(error, 'agrupar privilegios');
    }
  }

  // Obtener módulos únicos
  async getModulos(): Promise<string[]> {
    try {
      const privilegios = await this.getPrivilegios();
      
      // Extraer módulos únicos
      const modulosSet = new Set<string>();
      privilegios.forEach(p => modulosSet.add(p.modulo));
      
      return Array.from(modulosSet).sort();
      
    } catch (error: any) {
      console.error('❌ Error obteniendo módulos:', error);
      throw this.handleError(error, 'obtener módulos');
    }
  }

  // ==================== GESTIÓN DE ROL_PRIVILEGIO ====================

  // Obtener privilegios de un rol específico - VERSIÓN CORREGIDA
  async getPrivilegiosDelRol(roleId: number): Promise<Privilegio[]> {
    try {
      
      // Primero, obtener los IDs de los privilegios asignados al rol
      const { data: relaciones, error: relacionesError } = await supabase
        .from(this.rolPrivilegioTable)
        .select('privilegio_id')
        .eq('role_id', roleId);

      if (relacionesError) throw relacionesError;
      
      if (!relaciones || relaciones.length === 0) {
        return [];
      }

      // Extraer los IDs de los privilegios
      const privilegioIds = relaciones.map(rel => rel.privilegio_id);
      
      // Luego, obtener los detalles de esos privilegios
      const { data: privilegios, error: privilegiosError } = await supabase
        .from(this.privilegiosTable)
        .select('*')
        .in('id', privilegioIds);

      if (privilegiosError) throw privilegiosError;
      
      return privilegios as Privilegio[];
      
    } catch (error: any) {
      console.error(`❌ Error obteniendo privilegios del rol ${roleId}:`, error);
      throw this.handleError(error, `obtener privilegios del rol ${roleId}`);
    }
  }

  // Asignar privilegio a rol
  async asignarPrivilegioARol(roleId: number, privilegioId: number): Promise<RolPrivilegio> {
    try {
      
      // Verificar si ya existe la asignación
      const { data: exists } = await supabase
        .from(this.rolPrivilegioTable)
        .select('id')
        .eq('role_id', roleId)
        .eq('privilegio_id', privilegioId)
        .maybeSingle();
      
      if (exists) {
        throw new Error('Este privilegio ya está asignado al rol');
      }

      const { data, error } = await supabase
        .from(this.rolPrivilegioTable)
        .insert([{
          role_id: roleId,
          privilegio_id: privilegioId
        }])
        .select()
        .single();

      if (error) throw error;
      
      return data as RolPrivilegio;
      
    } catch (error: any) {
      console.error(`❌ Error asignando privilegio al rol:`, error);
      throw this.handleError(error, `asignar privilegio al rol`);
    }
  }

  // Asignar múltiples privilegios a rol
  async asignarPrivilegiosARol(roleId: number, privilegioIds: number[]): Promise<{asignados: number, ya_existian: number}> {
    try {
      
      // Verificar duplicados primero
      const { data: existentes } = await supabase
        .from(this.rolPrivilegioTable)
        .select('privilegio_id')
        .eq('role_id', roleId)
        .in('privilegio_id', privilegioIds);

      const existentesIds = existentes?.map(item => item.privilegio_id) || [];
      const nuevosIds = privilegioIds.filter(id => !existentesIds.includes(id));

      if (nuevosIds.length === 0) {        return { asignados: 0, ya_existian: privilegioIds.length };
      }

      // Preparar datos para inserción
      const datosInsertar = nuevosIds.map(privilegio_id => ({
        role_id: roleId,
        privilegio_id
      }));

      const { error } = await supabase
        .from(this.rolPrivilegioTable)
        .insert(datosInsertar);

      if (error) throw error;
      
      return { 
        asignados: nuevosIds.length, 
        ya_existian: existentesIds.length 
      };
      
    } catch (error: any) {
      console.error(`❌ Error asignando privilegios al rol:`, error);
      throw this.handleError(error, `asignar privilegios al rol`);
    }
  }

  // Remover privilegio de rol
  async removerPrivilegioDeRol(roleId: number, privilegioId: number): Promise<boolean> {
    try {
      
      const { error } = await supabase
        .from(this.rolPrivilegioTable)
        .delete()
        .eq('role_id', roleId)
        .eq('privilegio_id', privilegioId);

      if (error) throw error;
      
      return true;
      
    } catch (error: any) {
      console.error(`❌ Error removiendo privilegio del rol:`, error);
      throw this.handleError(error, `remover privilegio del rol`);
    }
  }

  // Remover múltiples privilegios de rol
  async removerPrivilegiosDeRol(roleId: number, privilegioIds: number[]): Promise<boolean> {
    try {
      
      const { error } = await supabase
        .from(this.rolPrivilegioTable)
        .delete()
        .eq('role_id', roleId)
        .in('privilegio_id', privilegioIds);

      if (error) throw error;
      
      return true;
      
    } catch (error: any) {
      console.error(`❌ Error removiendo privilegios del rol:`, error);
      throw this.handleError(error, `remover privilegios del rol`);
    }
  }

  // Eliminar todos los privilegios de un rol
  async eliminarTodosPrivilegiosDeRol(roleId: number): Promise<boolean> {
    try {
      
      const { error } = await supabase
        .from(this.rolPrivilegioTable)
        .delete()
        .eq('role_id', roleId);

      if (error) throw error;
      
      return true;
      
    } catch (error: any) {
      console.error(`❌ Error eliminando privilegios del rol:`, error);
      throw this.handleError(error, `eliminar privilegios del rol`);
    }
  }

  // Sincronizar privilegios de un rol (reemplaza todos los privilegios actuales)
  async sincronizarPrivilegiosDelRol(roleId: number, privilegioIds: number[]): Promise<boolean> {
    try {
      
      // 1. Eliminar todos los privilegios actuales
      await this.eliminarTodosPrivilegiosDeRol(roleId);
      
      // 2. Asignar los nuevos privilegios
      if (privilegioIds.length > 0) {
        await this.asignarPrivilegiosARol(roleId, privilegioIds);
      }
      
      return true;
      
    } catch (error: any) {
      console.error(`❌ Error sincronizando privilegios:`, error);
      throw this.handleError(error, `sincronizar privilegios del rol`);
    }
  }

  // Verificar si un rol tiene un privilegio específico
  async rolTienePrivilegio(roleId: number, privilegioCodigo: string): Promise<boolean> {
    try {
      // Primero obtener el ID del privilegio por su código
      const { data: privilegio, error: privilegioError } = await supabase
        .from(this.privilegiosTable)
        .select('id')
        .eq('codigo', privilegioCodigo)
        .single();

      if (privilegioError || !privilegio) {
        return false;
      }

      // Verificar si existe la relación
      const { data: relacion, error: relacionError } = await supabase
        .from(this.rolPrivilegioTable)
        .select('id')
        .eq('role_id', roleId)
        .eq('privilegio_id', privilegio.id)
        .maybeSingle();

      if (relacionError) return false;
      
      return !!relacion;
      
    } catch (error) {
      console.error(`❌ Error verificando privilegio:`, error);
      return false;
    }
  }

  // ==================== MÉTODOS ÚTILES ====================

  // Obtener roles activos para dropdowns
  async getRolesActivos(): Promise<{id: number, nombre: string, nivel_permisos: number}[]> {
    try {
      const { data, error } = await supabase
        .from(this.rolesTable)
        .select('id, nombre, nivel_permisos')
        .eq('esta_activo', true)
        .order('nivel_permisos', { ascending: false });

      if (error) throw error;
      return data || [];
      
    } catch (error: any) {
      console.error('❌ Error obteniendo roles activos:', error);
      return [];
    }
  }

  // Obtener roles con conteo de privilegios
  async getRolesConConteo(): Promise<(Rol & { total_privilegios: number })[]> {
    try {
      const resultado = await this.getRoles();
      const roles = resultado.data;

      // Obtener conteo de privilegios por rol
      const rolesConConteo = await Promise.all(
        roles.map(async (rol) => {
          const { count } = await supabase
            .from(this.rolPrivilegioTable)
            .select('*', { count: 'exact', head: true })
            .eq('role_id', rol.id);
          
          return {
            ...rol,
            total_privilegios: count || 0
          };
        })
      );

      return rolesConConteo;
      
    } catch (error: any) {
      console.error('❌ Error obteniendo roles con conteo:', error);
      throw this.handleError(error, 'obtener roles con conteo');
    }
  }

  // Verificar si existe rol con mismo nombre
  async checkNombreExists(nombre: string, excludeId?: number): Promise<boolean> {
    try {
      let query = supabase
        .from(this.rolesTable)
        .select('id')
        .eq('nombre', nombre);

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

  // Estadísticas de roles
  async getEstadisticas(): Promise<{total: number, activos: number, inactivos: number}> {
    try {
      const resultado = await this.getRoles();
      const roles = resultado.data;

      const total = roles.length || 0;
      const activos = roles.filter(r => r.esta_activo).length || 0;
      const inactivos = roles.filter(r => !r.esta_activo).length || 0;

      return { total, activos, inactivos };
      
    } catch (error) {
      console.error('❌ Error obteniendo estadísticas:', error);
      return { total: 0, activos: 0, inactivos: 0 };
    }
  }

  // ==================== MANEJO DE ERRORES ====================

  private handleError(error: any, context: string): Error {
    console.error(`[${context}] Error:`, error);
    
    // Errores comunes de Supabase
    if (error.code === '23505') {
      return new Error('Ya existe un registro con esos datos');
    }
    
    if (error.code === '23503') {
      return new Error('No se puede realizar la acción porque hay registros relacionados');
    }
    
    if (error.code === '42501') {
      return new Error('No tienes permisos para realizar esta acción');
    }
    
    if (error.code === '42P01') {
      return new Error('La tabla no existe');
    }
    
    if (error.message?.includes('JWT')) {
      return new Error('Error de autenticación. Por favor, inicia sesión nuevamente');
    }
    
    // Mensaje personalizado para el usuario
    return new Error(error.message || `Error al ${context}`);
  }
}
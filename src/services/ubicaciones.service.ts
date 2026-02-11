 import { Injectable } from '@angular/core';
import { supabase } from './supabase-client'; // Importas desde tu archivo actualizado
import { environment } from '../environments/environment'; // Si necesitas otras configuraciones

export interface Ubicacionx {
  id: number;
  nombre: string;
  descripcion: string | null;
  estado: string;
  created_at: string;
}

@Injectable({
  providedIn: 'root'
})
export class UbicacionesService {
  private tableName = 'ubicaciones';

  constructor() {
    console.log('✅ UbicacionesService inicializado con environment:', {
      production: environment.production,
      url: environment.supabaseUrl
    });
  }

  // ==================== CRUD COMPLETO ====================

  // Obtener todas las ubicaciones con paginación
  async getUbicaciones(filters?: { 
    estado?: string; 
    search?: string;
    limit?: number;
    page?: number 
  }) {
    try {
      console.log('📡 Obteniendo ubicaciones con filtros:', filters);
      
      let query = supabase
        .from(this.tableName)
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

      // Aplicar filtros
      if (filters?.estado && filters.estado !== 'todos') {
        query = query.eq('estado', filters.estado);
      }

      if (filters?.search) {
        query = query.or(`nombre.ilike.%${filters.search}%,descripcion.ilike.%${filters.search}%`);
      }

      // Paginación
      if (filters?.limit && filters?.page) {
        const from = (filters.page - 1) * filters.limit;
        const to = from + filters.limit - 1;
        query = query.range(from, to);
      }

      const { data, error, count } = await query;
      
      if (error) {
        console.error('❌ Error en getUbicaciones:', error);
        throw error;
      }
      
      console.log(`✅ ${data?.length || 0} ubicaciones obtenidas`);
      return { 
        data: data as Ubicacionx[], 
        count: count || 0,
        page: filters?.page || 1,
        limit: filters?.limit || 10
      };
      
    } catch (error: any) {
      console.error('💥 Error crítico en getUbicaciones:', error);
      throw this.handleError(error, 'obtener ubicaciones');
    }
  }

  // Obtener una ubicación por ID
  async getUbicacionById(id: number): Promise<Ubicacionx> {
    try {
      console.log(`📡 Obteniendo ubicación ID: ${id}`);
      
      const { data, error } = await supabase
        .from(this.tableName)
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      
      console.log(`✅ Ubicación ${id} obtenida:`, data?.nombre);
      return data as Ubicacionx;
      
    } catch (error: any) {
      console.error(`❌ Error obteniendo ubicación ${id}:`, error);
      throw this.handleError(error, `obtener ubicación ${id}`);
    }
  }

  // Crear nueva ubicación
  async createUbicacion(ubicacion: Omit<Ubicacionx, 'id' | 'created_at'>) {
    try {
      console.log('➕ Creando nueva ubicación:', ubicacion.nombre);
      
      // Verificar si ya existe una ubicación con el mismo nombre
      const { data: exists } = await supabase
        .from(this.tableName)
        .select('id')
        .eq('nombre', ubicacion.nombre)
        .maybeSingle();
      
      if (exists) {
        throw new Error(`Ya existe una ubicación con el nombre "${ubicacion.nombre}"`);
      }

      const { data, error } = await supabase
        .from(this.tableName)
        .insert([{
          ...ubicacion,
          estado: ubicacion.estado || 'activo'
        }])
        .select()
        .single();

      if (error) throw error;
      
      console.log(`✅ Ubicación creada: ${data.nombre} (ID: ${data.id})`);
      return data as Ubicacionx;
      
    } catch (error: any) {
      console.error('❌ Error creando ubicación:', error);
      throw this.handleError(error, 'crear ubicación');
    }
  }

  // Actualizar ubicación
  async updateUbicacion(id: number, updates: Partial<Ubicacionx>) {
    try {
      console.log(`✏️ Actualizando ubicación ID: ${id}`, updates);
      
      // Si se actualiza el nombre, verificar que no exista otro con el mismo nombre
      if (updates.nombre) {
        const { data: exists } = await supabase
          .from(this.tableName)
          .select('id')
          .eq('nombre', updates.nombre)
          .neq('id', id)
          .maybeSingle();
        
        if (exists) {
          throw new Error(`Ya existe otra ubicación con el nombre "${updates.nombre}"`);
        }
      }

      const { data, error } = await supabase
        .from(this.tableName)
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      
      console.log(`✅ Ubicación ${id} actualizada`);
      return data as Ubicacionx;
      
    } catch (error: any) {
      console.error(`❌ Error actualizando ubicación ${id}:`, error);
      throw this.handleError(error, `actualizar ubicación ${id}`);
    }
  }

  // Desactivar ubicación (soft delete)
  async desactivarUbicacion(id: number) {
    try {
      console.log(`⏸️ Desactivando ubicación ID: ${id}`);
      
      const { error } = await supabase
        .from(this.tableName)
        .update({ estado: 'inactivo' })
        .eq('id', id);

      if (error) throw error;
      
      console.log(`✅ Ubicación ${id} desactivada`);
      return true;
      
    } catch (error: any) {
      console.error(`❌ Error desactivando ubicación ${id}:`, error);
      throw this.handleError(error, `desactivar ubicación ${id}`);
    }
  }

  // Activar ubicación
  async activarUbicacion(id: number) {
    try {
      console.log(`▶️ Activando ubicación ID: ${id}`);
      
      const { error } = await supabase
        .from(this.tableName)
        .update({ estado: 'activo' })
        .eq('id', id);

      if (error) throw error;
      
      console.log(`✅ Ubicación ${id} activada`);
      return true;
      
    } catch (error: any) {
      console.error(`❌ Error activando ubicación ${id}:`, error);
      throw this.handleError(error, `activar ubicación ${id}`);
    }
  }

  // Eliminar permanentemente (hard delete) - Solo para admin
  async eliminarUbicacion(id: number) {
    try {
      console.log(`🗑️ Eliminando permanentemente ubicación ID: ${id}`);
      
      // Verificar si hay productos en esta ubicación
      const { data: productos } = await supabase
        .from('productos')
        .select('id')
        .eq('ubicacion_id', id)
        .limit(1);
      
      if (productos && productos.length > 0) {
        throw new Error('No se puede eliminar la ubicación porque tiene productos asociados');
      }

      const { error } = await supabase
        .from(this.tableName)
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      console.log(`✅ Ubicación ${id} eliminada permanentemente`);
      return true;
      
    } catch (error: any) {
      console.error(`❌ Error eliminando ubicación ${id}:`, error);
      throw this.handleError(error, `eliminar ubicación ${id}`);
    }
  }

  // ==================== MÉTODOS ESPECÍFICOS ====================

  // Obtener ubicaciones activas para dropdowns
  async getUbicacionesActivas() {
    try {
      const { data, error } = await supabase
        .from(this.tableName)
        .select('id, nombre')
        .eq('estado', 'activo')
        .order('nombre');

      if (error) throw error;
      return data;
      
    } catch (error: any) {
      console.error('❌ Error obteniendo ubicaciones activas:', error);
      return [];
    }
  }

  // Verificar si existe ubicación con mismo nombre
  async checkNombreExists(nombre: string, excludeId?: number): Promise<boolean> {
    try {
      let query = supabase
        .from(this.tableName)
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

  // Estadísticas de ubicaciones
  async getEstadisticas() {
    try {
      const { data, error } = await supabase
        .from(this.tableName)
        .select('estado');

      if (error) throw error;

      const total = data?.length || 0;
      const activas = data?.filter(u => u.estado === 'activo').length || 0;
      const inactivas = data?.filter(u => u.estado === 'inactivo').length || 0;

      return { total, activas, inactivas };
      
    } catch (error) {
      console.error('❌ Error obteniendo estadísticas:', error);
      return { total: 0, activas: 0, inactivas: 0 };
    }
  }

  // ==================== MANEJO DE ERRORES ====================

  private handleError(error: any, context: string): Error {
    console.error(`[${context}] Error:`, error);
    
    // Errores comunes de Supabase
    if (error.code === '23505') {
      return new Error('Ya existe una ubicación con ese nombre');
    }
    
    if (error.code === '42501') {
      return new Error('No tienes permisos para realizar esta acción');
    }
    
    if (error.code === '42P01') {
      return new Error('La tabla de ubicaciones no existe');
    }
    
    if (error.message?.includes('JWT')) {
      return new Error('Error de autenticación. Por favor, inicia sesión nuevamente');
    }
    
    // Mensaje personalizado para el usuario
    return new Error(error.message || `Error al ${context}`);
  }
 
 
}
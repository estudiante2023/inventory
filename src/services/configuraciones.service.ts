// src/app/services/configuraciones.service.ts
import { Injectable } from '@angular/core';
import { supabase } from './supabase-client';
import { environment } from '../environments/environment';

export interface Configuracionx {
  id: number;
  clave: string;
  valor: string | null;
  descripcion: string | null;
  fecha_actualizacion: string;
}

@Injectable({
  providedIn: 'root'
})
export class ConfiguracionesService {
  private tableName = 'configuraciones';

  constructor() { 
  }

  // ==================== CRUD COMPLETO ====================

  // Obtener todas las configuraciones con paginación
  async getConfiguraciones(filters?: { 
    search?: string;
    limit?: number;
    page?: number 
  }) {
    try { 
      
      let query = supabase
        .from(this.tableName)
        .select('*', { count: 'exact' })
        .order('clave', { ascending: true });

      // Aplicar filtro de búsqueda
      if (filters?.search) {
        query = query.or(`clave.ilike.%${filters.search}%,descripcion.ilike.%${filters.search}%,valor.ilike.%${filters.search}%`);
      }

      // Paginación
      if (filters?.limit && filters?.page) {
        const from = (filters.page - 1) * filters.limit;
        const to = from + filters.limit - 1;
        query = query.range(from, to);
      }

      const { data, error, count } = await query;
      
      if (error) {
        console.error('❌ Error en getConfiguraciones:', error);
        throw error;
      }
       
      return { 
        data: data as Configuracionx[], 
        count: count || 0,
        page: filters?.page || 1,
        limit: filters?.limit || 20
      };
      
    } catch (error: any) {
      console.error('💥 Error crítico en getConfiguraciones:', error);
      throw this.handleError(error, 'obtener configuraciones');
    }
  }

  // Obtener una configuración por ID
  async getConfiguracionById(id: number): Promise<Configuracionx> {
    try { 
      
      const { data, error } = await supabase
        .from(this.tableName)
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
       
      return data as Configuracionx;
      
    } catch (error: any) {
      console.error(`❌ Error obteniendo configuración ${id}:`, error);
      throw this.handleError(error, `obtener configuración ${id}`);
    }
  }

  // Obtener configuración por clave
  async getConfiguracionByClave(clave: string): Promise<Configuracionx | null> {
    try { 
      
      const { data, error } = await supabase
        .from(this.tableName)
        .select('*')
        .eq('clave', clave)
        .maybeSingle(); // Usamos maybeSingle para que retorne null si no existe

      if (error) throw error;
      
      return data as Configuracionx | null;
      
    } catch (error: any) {
      console.error(`❌ Error obteniendo configuración ${clave}:`, error);
      throw this.handleError(error, `obtener configuración ${clave}`);
    }
  }

  // Obtener valor de configuración por clave (método rápido)
  async getValorConfiguracion(clave: string): Promise<string | null> {
    try {
      const config = await this.getConfiguracionByClave(clave);
      return config?.valor || null;
    } catch (error) {
      console.error(`❌ Error obteniendo valor para ${clave}:`, error);
      return null;
    }
  }

  // Crear nueva configuración
  async createConfiguracion(configuracion: Omit<Configuracionx, 'id' | 'fecha_actualizacion'>) {
    try { 
      
      // Verificar si ya existe una configuración con la misma clave
      const { data: exists } = await supabase
        .from(this.tableName)
        .select('id')
        .eq('clave', configuracion.clave)
        .maybeSingle();
      
      if (exists) {
        throw new Error(`Ya existe una configuración con la clave "${configuracion.clave}"`);
      }

      const { data, error } = await supabase
        .from(this.tableName)
        .insert([configuracion])
        .select()
        .single();

      if (error) throw error;
       
      return data as Configuracionx;
      
    } catch (error: any) {
      console.error('❌ Error creando configuración:', error);
      throw this.handleError(error, 'crear configuración');
    }
  }

  // Actualizar configuración
  async updateConfiguracion(id: number, updates: Partial<Configuracionx>) {
    try { 
      
      // Si se actualiza la clave, verificar que no exista otra con la misma clave
      if (updates.clave) {
        const { data: exists } = await supabase
          .from(this.tableName)
          .select('id')
          .eq('clave', updates.clave)
          .neq('id', id)
          .maybeSingle();
        
        if (exists) {
          throw new Error(`Ya existe otra configuración con la clave "${updates.clave}"`);
        }
      }

      const { data, error } = await supabase
        .from(this.tableName)
        .update({
          ...updates,
          fecha_actualizacion: new Date().toISOString() // Actualizar timestamp
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
       
      return data as Configuracionx;
      
    } catch (error: any) {
      console.error(`❌ Error actualizando configuración ${id}:`, error);
      throw this.handleError(error, `actualizar configuración ${id}`);
    }
  }

  // Actualizar configuración por clave (método conveniente)
  async updateConfiguracionByClave(clave: string, valor: string, descripcion?: string) {
    try { 
      
      // Primero obtener el ID
      const { data: existing } = await supabase
        .from(this.tableName)
        .select('id')
        .eq('clave', clave)
        .single();

      if (!existing) {
        throw new Error(`No existe configuración con la clave "${clave}"`);
      }

      return this.updateConfiguracion(existing.id, { 
        valor, 
        ...(descripcion && { descripcion }) 
      });
      
    } catch (error: any) {
      console.error(`❌ Error actualizando configuración ${clave}:`, error);
      throw this.handleError(error, `actualizar configuración ${clave}`);
    }
  }

  // Upsert - Crear o actualizar configuración
  async upsertConfiguracion(configuracion: Omit<Configuracionx, 'id' | 'fecha_actualizacion'>) {
    try { 
      
      // Verificar si existe
      const existing = await this.getConfiguracionByClave(configuracion.clave);
      
      if (existing) {
        // Actualizar existente
        return this.updateConfiguracion(existing.id, {
          valor: configuracion.valor,
          descripcion: configuracion.descripcion
        });
      } else {
        // Crear nueva
        return this.createConfiguracion(configuracion);
      }
      
    } catch (error: any) {
      console.error(`❌ Error en upsert para ${configuracion.clave}:`, error);
      throw this.handleError(error, `upsert configuración ${configuracion.clave}`);
    }
  }

  // Eliminar configuración
  async eliminarConfiguracion(id: number) {
    try { 
      
      const { error } = await supabase
        .from(this.tableName)
        .delete()
        .eq('id', id);

      if (error) throw error;
       
      return true;
      
    } catch (error: any) {
      console.error(`❌ Error eliminando configuración ${id}:`, error);
      throw this.handleError(error, `eliminar configuración ${id}`);
    }
  }

  // Eliminar configuración por clave
  async eliminarConfiguracionByClave(clave: string) {
    try { 
      
      const { error } = await supabase
        .from(this.tableName)
        .delete()
        .eq('clave', clave);

      if (error) throw error;
       
      return true;
      
    } catch (error: any) {
      console.error(`❌ Error eliminando configuración ${clave}:`, error);
      throw this.handleError(error, `eliminar configuración ${clave}`);
    }
  }

  // ==================== MÉTODOS ESPECÍFICOS ====================

  // Obtener múltiples configuraciones por claves
  async getConfiguracionesByClaves(claves: string[]): Promise<Record<string, string | null>> {
    try {
      const { data, error } = await supabase
        .from(this.tableName)
        .select('clave, valor')
        .in('clave', claves);

      if (error) throw error;

      const resultado: Record<string, string | null> = {};
      claves.forEach(clave => resultado[clave] = null);
      
      data?.forEach(item => {
        resultado[item.clave] = item.valor;
      });

      return resultado;
      
    } catch (error: any) {
      console.error('❌ Error obteniendo configuraciones por claves:', error);
      throw this.handleError(error, 'obtener configuraciones por claves');
    }
  }

  // Verificar si existe configuración con misma clave
  async checkClaveExists(clave: string, excludeId?: number): Promise<boolean> {
    try {
      let query = supabase
        .from(this.tableName)
        .select('id')
        .eq('clave', clave);

      if (excludeId) {
        query = query.neq('id', excludeId);
      }

      const { data, error } = await query;
      
      if (error) throw error;
      return (data?.length || 0) > 0;
      
    } catch (error) {
      console.error('❌ Error verificando clave:', error);
      return false;
    }
  }

  // Obtener configuraciones agrupadas por prefijo
  async getConfiguracionesAgrupadas(prefix?: string) {
    try {
      let query = supabase
        .from(this.tableName)
        .select('*')
        .order('clave');

      if (prefix) {
        query = query.ilike('clave', `${prefix}%`);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Agrupar por prefijo (parte antes del primer punto)
      const agrupadas: Record<string, Configuracionx[]> = {};
      
      data?.forEach(config => {
        const partes = config.clave.split('.');
        const grupo = partes.length > 1 ? partes[0] : 'general';
        
        if (!agrupadas[grupo]) {
          agrupadas[grupo] = [];
        }
        agrupadas[grupo].push(config);
      });

      return agrupadas;
      
    } catch (error: any) {
      console.error('❌ Error obteniendo configuraciones agrupadas:', error);
      throw this.handleError(error, 'obtener configuraciones agrupadas');
    }
  }

  // Métodos para tipos específicos

  async getConfiguracionBooleana(clave: string): Promise<boolean> {
    const valor = await this.getValorConfiguracion(clave);
    return valor?.toLowerCase() === 'true' || valor === '1';
  }

  async getConfiguracionNumerica(clave: string): Promise<number | null> {
    const valor = await this.getValorConfiguracion(clave);
    return valor ? Number(valor) : null;
  }

  async getConfiguracionJSON<T = any>(clave: string): Promise<T | null> {
    try {
      const valor = await this.getValorConfiguracion(clave);
      return valor ? JSON.parse(valor) : null;
    } catch {
      return null;
    }
  }

  // ==================== CONFIGURACIONES DEL SISTEMA ====================

  // Configuraciones predefinidas del sistema
  async inicializarConfiguracionesPorDefecto() {
    const configuracionesPorDefecto = [
      {
        clave: 'sistema.nombre',
        valor: 'Sistema de Gestión de Inventarios',
        descripcion: 'Nombre del sistema'
      },
      {
        clave: 'sistema.version',
        valor: '1.0.0',
        descripcion: 'Versión del sistema'
      },
      {
        clave: 'sistema.modo_mantenimiento',
        valor: 'false',
        descripcion: 'Activar modo mantenimiento'
      },
      {
        clave: 'sistema.paginacion.productos',
        valor: '20',
        descripcion: 'Número de productos por página'
      },
      {
        clave: 'sistema.paginacion.ubicaciones',
        valor: '15',
        descripcion: 'Número de ubicaciones por página'
      },
      {
        clave: 'sistema.notificaciones.email',
        valor: 'true',
        descripcion: 'Activar notificaciones por email'
      },
      {
        clave: 'inventario.cantidad_minima_alerta',
        valor: '5',
        descripcion: 'Cantidad mínima para alertas de stock'
      },
      {
        clave: 'inventario.reporte_automatico',
        valor: 'true',
        descripcion: 'Generar reportes automáticos'
      },
      {
        clave: 'backup.frecuencia',
        valor: 'diario',
        descripcion: 'Frecuencia de backups: diario, semanal, mensual'
      }
    ];

    try { 
      
      for (const config of configuracionesPorDefecto) {
        await this.upsertConfiguracion(config);
      } 
    } catch (error) {
      console.error('❌ Error inicializando configuraciones:', error);
    }
  }

  // ==================== MANEJO DE ERRORES ====================

  private handleError(error: any, context: string): Error { 
    
    // Errores comunes de Supabase
    if (error.code === '23505') {
      return new Error('Ya existe una configuración con esa clave');
    }
    
    if (error.code === '42501') {
      return new Error('No tienes permisos para realizar esta acción');
    }
    
    if (error.code === '42P01') {
      return new Error('La tabla de configuraciones no existe');
    }
    
    if (error.message?.includes('JWT')) {
      return new Error('Error de autenticación. Por favor, inicia sesión nuevamente');
    }
    
    // Mensaje personalizado para el usuario
    return new Error(error.message || `Error al ${context}`);
  }
}
// services/trazabilidad.service.ts
import { Injectable } from '@angular/core';
import { supabase } from './supabase-client';   
import { NuevoMovimiento, Trazabilidadx, TrazabilidadCompleto } from '../app/moldes/producto.model';
import * as XLSX from 'xlsx';
@Injectable({
  providedIn: 'root'
})
export class TrazabilidadService {
  private tableName = 'trazabilidad';

  constructor() {
  }

  // ==================== CRUD BÁSICO ====================

  // Obtener trazabilidad con filtros (YA EXISTE)
 async getTrazabilidad(filters?: {
  producto_id?: number;
  tipo_evento?: string;
  fecha_inicio?: string;
  fecha_fin?: string;
  usuario_id?: string;
  limit?: number;
  page?: number;
  search?: string;
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
}) {
  try {
    
    let query = supabase
      .from(this.tableName)
      .select(`
        *,
        productos (nombre, codigo),
        perfiles (nombre_completo)
      `, { count: 'exact' });

    // Aplicar filtros
    if (filters?.producto_id) {
      query = query.eq('producto_id', filters.producto_id);
    }

    if (filters?.tipo_evento && filters.tipo_evento !== 'todos') {
      query = query.eq('tipo_evento', filters.tipo_evento);
    }

    if (filters?.usuario_id) {
      query = query.eq('usuario_id', filters.usuario_id);
    }

    if (filters?.fecha_inicio) {
      query = query.gte('fecha_evento', filters.fecha_inicio);
    }

    if (filters?.fecha_fin) {
      query = query.lte('fecha_evento', filters.fecha_fin);
    }

    // BÚSQUEDA GENERAL MEJORADA - CORREGIDA
    // PostgREST no soporta OR con tablas relacionadas en la misma consulta
    // Tenemos que hacer un enfoque diferente
    if (filters?.search) {
      const searchTerm = filters.search.toLowerCase();
      
      // SOLUCIÓN: Buscar primero productos que coincidan, luego filtrar por sus IDs
      // 1. Primero buscar productos que coincidan
      const { data: productosEncontrados, error: errorProductos } = await supabase
        .from('productos')
        .select('id')
        .or(`nombre.ilike.%${searchTerm}%,codigo.ilike.%${searchTerm}%`);
      
      let productoIds: number[] = [];
      if (productosEncontrados && !errorProductos) {
        productoIds = productosEncontrados.map(p => p.id);
      }
      
      // 2. Aplicar filtro OR que incluya:
      // - Campos directos de trazabilidad
      // - IDs de productos encontrados (si hay alguno)
      if (productoIds.length > 0) {
        query = query.or(
          `motivo.ilike.%${searchTerm}%,` +
          `detalles.ilike.%${searchTerm}%,` +
          `observaciones.ilike.%${searchTerm}%,` +
          `ubicacion_origen.ilike.%${searchTerm}%,` +
          `ubicacion_destino.ilike.%${searchTerm}%,` +
          `producto_id.in.(${productoIds.join(',')})`
        );
      } else {
        // Si no hay productos encontrados, buscar solo en campos directos
        query = query.or(
          `motivo.ilike.%${searchTerm}%,` +
          `detalles.ilike.%${searchTerm}%,` +
          `observaciones.ilike.%${searchTerm}%,` +
          `ubicacion_origen.ilike.%${searchTerm}%,` +
          `ubicacion_destino.ilike.%${searchTerm}%`
        );
      }
    }

    // MODIFICACIÓN AQUÍ: Ordenar por id descendente por defecto
    const orderColumn = filters?.orderBy || 'id';
    const orderDirection = filters?.orderDir || 'desc';
    query = query.order(orderColumn, { ascending: orderDirection === 'asc' });

    // Paginación
    if (filters?.limit && filters?.page) {
      const from = (filters.page - 1) * filters.limit;
      const to = from + filters.limit - 1;
      query = query.range(from, to);
    }

    const { data, error, count } = await query;
    
    if (error) {
      console.error('❌ Error en query:', error);
      throw error;
    }
    
    // Procesar datos para incluir nombres
    const trazabilidadCompleta = (data || []).map(item => {
      // Verifica si hay datos de productos
      const productosData = (item as any).productos;
      const perfilesData = (item as any).perfiles;
      
      return {
        ...item,
        producto_nombre: productosData?.nombre || 'Producto desconocido',
        producto_codigo: productosData?.codigo || 'Sin código',
        usuario_nombre: perfilesData?.nombre_completo || 'Sistema',
        ubicacion_origen_nombre: item.ubicacion_origen,
        ubicacion_destino_nombre: item.ubicacion_destino
      };
    });
    
    return { 
      data: trazabilidadCompleta as TrazabilidadCompleto[], 
      count: count || 0,
      page: filters?.page || 1,
      limit: filters?.limit || 10
    };
    
  } catch (error: any) {
    console.error('💥 Error en getTrazabilidad:', error);
    throw this.handleError(error, 'obtener trazabilidad');
  }
}

  // ==================== MÉTODOS QUE TE FALTAN ====================

  // 1. Obtener un registro específico por ID
  async getRegistroById(id: number): Promise<TrazabilidadCompleto> {
    try {
      
      const { data, error } = await supabase
        .from(this.tableName)
        .select(`
          *,
          productos (*),
          perfiles (*),
          ubicacion_origen_data:ubicaciones!trazabilidad_ubicacion_origen_fkey(id, nombre),
          ubicacion_destino_data:ubicaciones!trazabilidad_ubicacion_destino_fkey(id, nombre)
        `)
        .eq('id', id)
        .single();

      if (error) throw error;
      
      // Formatear la respuesta
      const registroCompleto = {
        ...data,
        producto_nombre: (data as any).productos?.nombre,
        producto_codigo: (data as any).productos?.codigo,
        usuario_nombre: (data as any).perfiles?.nombre_completo,
        ubicacion_origen_nombre: (data as any).ubicacion_origen_data?.nombre || data.ubicacion_origen,
        ubicacion_destino_nombre: (data as any).ubicacion_destino_data?.nombre || data.ubicacion_destino
      };
      
      return registroCompleto as TrazabilidadCompleto;
      
    } catch (error: any) {
      console.error(`❌ Error obteniendo registro ${id}:`, error);
      throw this.handleError(error, `obtener registro ${id}`);
    }
  }

  // 2. Actualizar un registro existente
 async updateRegistro(id: number, updates: Partial<Trazabilidadx>): Promise<Trazabilidadx> {
  try {
    
    // Verificar que el registro existe
    const { data: existing } = await supabase
      .from(this.tableName)
      .select('id')
      .eq('id', id)
      .single();
      
    if (!existing) {
      throw new Error('Registro no encontrado');
    }
    
    // No permitir actualizar ciertos campos críticos
    const camposNoEditables = ['producto_id', 'cantidad', 'tipo_evento', 'fecha_modificacion'];
    for (const campo of camposNoEditables) {
      if (campo in updates) {
        throw new Error(`No se puede modificar el campo ${campo} de un registro existente`);
      }
    }
    
    // El trigger se encargará de actualizar fecha_modificacion automáticamente
    const { data, error } = await supabase
      .from(this.tableName)
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    
    return data as Trazabilidadx;
    
  } catch (error: any) {
    console.error(`❌ Error actualizando registro ${id}:`, error);
    throw this.handleError(error, `actualizar registro ${id}`);
  }
}

  // 3. Eliminar un registro
  async deleteRegistro(id: number): Promise<boolean> {
    try {
      
      // Verificar permisos (solo admin puede eliminar)
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      
      if (!user) {
        throw new Error('Usuario no autenticado');
      }
      
      // Obtener rol del usuario
      const { data: perfil } = await supabase
        .from('perfiles')
        .select('role_id')
        .eq('id', user.id)
        .single();
        
      const { data: rol } = await supabase
        .from('roles')
        .select('nombre')
        .eq('id', perfil?.role_id)
        .single();
        
      if (rol?.nombre !== 'admin') {
        throw new Error('Solo administradores pueden eliminar registros de trazabilidad');
      }
      
      const { error } = await supabase
        .from(this.tableName)
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      return true;
      
    } catch (error: any) {
      console.error(`❌ Error eliminando registro ${id}:`, error);
      throw this.handleError(error, `eliminar registro ${id}`);
    }
  }

  // 4. Búsqueda avanzada con múltiples criterios
  async buscarRegistrosAvanzado(criterios: {
    search?: string;
    tipo_evento?: string[];
    estado_evento?: string[];
    fecha_desde?: string;
    fecha_hasta?: string;
    usuario_ids?: string[];
    producto_ids?: number[];
    ordenar_por?: 'fecha_evento' | 'cantidad' | 'tipo_evento';
    orden?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
  }) {
    try {
      
      let query = supabase
        .from(this.tableName)
        .select(`
          *,
          productos (nombre, codigo, serial_number),
          perfiles (nombre_completo, email)
        `, { count: 'exact' });
      
      // Aplicar filtros
      
      // Búsqueda de texto en múltiples campos
      // Búsqueda de texto en múltiples campos
if (criterios.search) {
  const searchPattern = `%${criterios.search}%`;
  query = query.or(`motivo.ilike.${searchPattern},detalles.ilike.${searchPattern},observaciones.ilike.${searchPattern},productos.nombre.ilike.${searchPattern},productos.codigo.ilike.${searchPattern}`);
}
      
      // Filtro por tipos de evento (array)
      if (criterios.tipo_evento && criterios.tipo_evento.length > 0) {
        query = query.in('tipo_evento', criterios.tipo_evento);
      }
      
      // Filtro por estados de evento (array)
      if (criterios.estado_evento && criterios.estado_evento.length > 0) {
        query = query.in('estado_evento', criterios.estado_evento);
      }
      
      // Filtro por fechas
      if (criterios.fecha_desde) {
        query = query.gte('fecha_evento', criterios.fecha_desde);
      }
      
      if (criterios.fecha_hasta) {
        query = query.lte('fecha_evento', criterios.fecha_hasta);
      }
      
      // Filtro por usuarios (array)
      if (criterios.usuario_ids && criterios.usuario_ids.length > 0) {
        query = query.in('usuario_id', criterios.usuario_ids);
      }
      
      // Filtro por productos (array)
      if (criterios.producto_ids && criterios.producto_ids.length > 0) {
        query = query.in('producto_id', criterios.producto_ids);
      }
      
      // Ordenar
      if (criterios.ordenar_por) {
        query = query.order(criterios.ordenar_por, { 
          ascending: criterios.orden === 'asc' 
        });
      } else {
        query = query.order('fecha_evento', { ascending: false });
      }
      
      // Paginación
      if (criterios.limit) {
        query = query.limit(criterios.limit);
      }
      
      if (criterios.offset) {
        query = query.range(criterios.offset, criterios.offset + (criterios.limit || 10) - 1);
      }
      
      const { data, error, count } = await query;
      
      if (error) throw error;
      
      // Formatear respuesta
      const registrosFormateados = (data || []).map(item => ({
        ...item,
        producto_nombre: (item as any).productos?.nombre,
        producto_codigo: (item as any).productos?.codigo,
        producto_serial: (item as any).productos?.serial_number,
        usuario_nombre: (item as any).perfiles?.nombre_completo,
        usuario_email: (item as any).perfiles?.email
      }));
      
      return {
        data: registrosFormateados,
        total: count || 0,
        limit: criterios.limit || 10,
        offset: criterios.offset || 0
      };
      
    } catch (error: any) {
      console.error('💥 Error en búsqueda avanzada:', error);
      throw this.handleError(error, 'realizar búsqueda avanzada');
    }
  }

  // 5. Obtener estadísticas detalladas
  async getEstadisticasCompletas(fecha_desde?: string, fecha_hasta?: string) {
    try {
      
      let query = supabase
        .from(this.tableName)
        .select('*');
      
      if (fecha_desde) {
        query = query.gte('fecha_evento', fecha_desde);
      }
      
      if (fecha_hasta) {
        query = query.lte('fecha_evento', fecha_hasta);
      }
      
      const { data, error } = await query;
      
      if (error) throw error;
      
      const registros = data || [];
      
      // Calcular estadísticas
      const estadisticas = {
        total: registros.length,
        por_tipo_evento: {} as Record<string, number>,
        por_estado: {} as Record<string, number>,
        por_usuario: {} as Record<string, number>,
        por_producto: {} as Record<string, number>,
        cantidad_total_movida: 0,
        promedio_diario: 0,
        
        // Series temporales
        por_dia: {} as Record<string, number>,
        por_mes: {} as Record<string, number>,
        
        // Top 5
        top_productos_movidos: [] as Array<{producto_id: number, nombre: string, cantidad: number}>,
        top_usuarios: [] as Array<{usuario_id: string, nombre: string, cantidad: number}>
      };
      
      // Procesar cada registro
      registros.forEach(registro => {
        // Por tipo de evento
        estadisticas.por_tipo_evento[registro.tipo_evento] = 
          (estadisticas.por_tipo_evento[registro.tipo_evento] || 0) + 1;
        
        // Por estado
        estadisticas.por_estado[registro.estado_evento] = 
          (estadisticas.por_estado[registro.estado_evento] || 0) + 1;
        
        // Cantidad total movida
        estadisticas.cantidad_total_movida += registro.cantidad;
        
        // Por día (fecha sin hora)
        const fechaDia = registro.fecha_evento.split('T')[0];
        estadisticas.por_dia[fechaDia] = (estadisticas.por_dia[fechaDia] || 0) + 1;
        
        // Por mes (YYYY-MM)
        const fechaMes = fechaDia.substring(0, 7);
        estadisticas.por_mes[fechaMes] = (estadisticas.por_mes[fechaMes] || 0) + 1;
      });
      
      // Calcular promedio diario
      if (Object.keys(estadisticas.por_dia).length > 0) {
        estadisticas.promedio_diario = Number(
          (estadisticas.total / Object.keys(estadisticas.por_dia).length).toFixed(2)
        );
      }
      
      return estadisticas;
      
    } catch (error: any) {
      console.error('❌ Error obteniendo estadísticas:', error);
      throw this.handleError(error, 'obtener estadísticas');
    }
  }

async exportarTrazabilidad(filters?: {
  fecha_desde?: string;
  fecha_hasta?: string;
  tipo_evento?: string;
  producto_id?: number;
  search?: string; // ¡AGREGAR ESTO!
  usuario_id?: string; // ¡AGREGAR ESTO!
}) {
  try {
    
    let query = supabase
      .from(this.tableName)
      .select(`
        *,
        productos (nombre, codigo, serial_number),
        perfiles (nombre_completo)
      `)
      .order('fecha_evento', { ascending: true });
    
    // APLICAR TODOS LOS FILTROS
    if (filters?.fecha_desde) {
      query = query.gte('fecha_evento', filters.fecha_desde);
    }
    
    if (filters?.fecha_hasta) {
      query = query.lte('fecha_evento', filters.fecha_hasta);
    }
    
    if (filters?.tipo_evento) {
      query = query.eq('tipo_evento', filters.tipo_evento);
    }
    
    if (filters?.producto_id) {
      query = query.eq('producto_id', filters.producto_id);
    }
    
    if (filters?.usuario_id) {
      query = query.eq('usuario_id', filters.usuario_id);
    }
    
    // ¡¡¡AGREGAR EL FILTRO DE BÚSQUEDA GENERAL!!!
    if (filters?.search) {
      const searchTerm = filters.search.toLowerCase();
      
      
      // 1. Primero buscar productos que coincidan
      const { data: productosEncontrados, error: errorProductos } = await supabase
        .from('productos')
        .select('id')
        .or(`nombre.ilike.%${searchTerm}%,codigo.ilike.%${searchTerm}%`);
      
      let productoIds: number[] = [];
      if (productosEncontrados && !errorProductos) {
        productoIds = productosEncontrados.map(p => p.id);
      }
      
      // 2. Aplicar filtro OR
      if (productoIds.length > 0) {
        query = query.or(
          `motivo.ilike.%${searchTerm}%,` +
          `detalles.ilike.%${searchTerm}%,` +
          `observaciones.ilike.%${searchTerm}%,` +
          `ubicacion_origen.ilike.%${searchTerm}%,` +
          `ubicacion_destino.ilike.%${searchTerm}%,` +
          `producto_id.in.(${productoIds.join(',')})`
        );
      } else {
        query = query.or(
          `motivo.ilike.%${searchTerm}%,` +
          `detalles.ilike.%${searchTerm}%,` +
          `observaciones.ilike.%${searchTerm}%,` +
          `ubicacion_origen.ilike.%${searchTerm}%,` +
          `ubicacion_destino.ilike.%${searchTerm}%`
        );
      }
    }

    const { data, error } = await query;
    
    if (error) throw error;
    
    if (!data || data.length === 0) {
      console.warn('⚠️ No hay datos para exportar con los filtros aplicados');
      alert('No hay registros para exportar con los filtros actuales');
      return [];
    }
    
    
    // Formatear datos para Excel
    const excelData = (data || []).map(registro => {
      const fecha = new Date(registro.fecha_evento);
      
      return {
        'ID': registro.id,
        'Fecha': fecha.toLocaleDateString('es-ES'),
        'Hora': fecha.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
        'Tipo Evento': registro.tipo_evento.toUpperCase(),
        'Producto': (registro as any).productos?.nombre || '',
        'Código Producto': (registro as any).productos?.codigo || '',
        'Serial': (registro as any).productos?.serial_number || '',
        'Cantidad': registro.cantidad,
        'Ubicación Origen': registro.ubicacion_origen || '',
        'Ubicación Destino': registro.ubicacion_destino || '',
        'Usuario': (registro as any).perfiles?.nombre_completo || '',
        'Motivo': registro.motivo || '',
        'Detalles': registro.detalles || '',
        'Observaciones': registro.observaciones || '',
        'Estado': registro.estado_evento.toUpperCase()
      };
    });
    
    // Crear libro de trabajo
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    
    // Definir anchos de columna
    const colWidths = [
      { wch: 5 },   // ID
      { wch: 12 },  // Fecha
      { wch: 10 },  // Hora
      { wch: 15 },  // Tipo Evento
      { wch: 25 },  // Producto
      { wch: 15 },  // Código Producto
      { wch: 20 },  // Serial
      { wch: 10 },  // Cantidad
      { wch: 20 },  // Ubicación Origen
      { wch: 20 },  // Ubicación Destino
      { wch: 25 },  // Usuario
      { wch: 30 },  // Motivo
      { wch: 40 },  // Detalles
      { wch: 40 },  // Observaciones
      { wch: 12 }   // Estado
    ];
    
    worksheet['!cols'] = colWidths;
    
    // Agregar hoja al libro
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Trazabilidad');
    
    // Generar nombre de archivo con filtros aplicados
    const fechaActual = new Date();
    const fechaFormateada = `${fechaActual.getFullYear()}-${(fechaActual.getMonth()+1).toString().padStart(2,'0')}-${fechaActual.getDate().toString().padStart(2,'0')}`;
    const filtroTexto = filters?.search ? `_${filters.search.substring(0, 20)}` : '';
    const tipoTexto = filters?.tipo_evento ? `_${filters.tipo_evento}` : '';
    
    const fileName = `trazabilidad${filtroTexto}${tipoTexto}_${fechaFormateada}.xlsx`;
    
    // DESCARGAR
    XLSX.writeFile(workbook, fileName);
    
    return excelData;
    
  } catch (error: any) {
    console.error('❌ Error exportando trazabilidad:', error);
    throw this.handleError(error, 'exportar trazabilidad');
  }
}
  // 7. Obtener tipos de evento únicos para filtros
  async getTiposEventoUnicos(): Promise<string[]> {
    try {
      
      const { data, error } = await supabase
        .from(this.tableName)
        .select('tipo_evento')
        .order('tipo_evento');
      
      if (error) throw error;
      
      // Extraer valores únicos
      const tiposUnicos = Array.from(
        new Set((data || []).map(item => item.tipo_evento))
      );
      
      return tiposUnicos;
      
    } catch (error: any) {
      console.error('❌ Error obteniendo tipos de evento:', error);
      return [];
    }
  }

  // 8. Obtener usuarios que han realizado movimientos
  async getUsuariosConMovimientos(): Promise<Array<{id: string, nombre: string, total_movimientos: number}>> {
    try {
      
      const { data, error } = await supabase
        .from(this.tableName)
        .select(`
          usuario_id,
          perfiles (nombre_completo)
        `);
      
      if (error) throw error;
      
      // Agrupar por usuario
      const usuariosMap = new Map();
      
      (data || []).forEach(item => {
        if (item.usuario_id) {
          const current = usuariosMap.get(item.usuario_id) || {
            id: item.usuario_id,
            nombre: (item as any).perfiles?.nombre_completo || 'Desconocido',
            total_movimientos: 0
          };
          
          current.total_movimientos += 1;
          usuariosMap.set(item.usuario_id, current);
        }
      });
      
      const usuariosArray = Array.from(usuariosMap.values())
        .sort((a, b) => b.total_movimientos - a.total_movimientos);
      
      return usuariosArray;
      
    } catch (error: any) {
      console.error('❌ Error obteniendo usuarios:', error);
      return [];
    }
  }

  // 9. Validar permisos para acciones administrativas
  async validarPermisosAdmin(): Promise<boolean> {
    try {
      const { data: userData } = await supabase.auth.getUser();
      
      if (!userData.user) {
        return false;
      }
      
      // Verificar si es administrador
      const { data: perfil } = await supabase
        .from('perfiles')
        .select('role_id')
        .eq('id', userData.user.id)
        .single();
        
      if (!perfil) {
        return false;
      }
      
      const { data: rol } = await supabase
        .from('roles')
        .select('nombre')
        .eq('id', perfil.role_id)
        .single();
        
      return rol?.nombre === 'admin';
      
    } catch (error) {
      console.error('Error validando permisos:', error);
      return false;
    }
  }

  // ==================== TUS MÉTODOS EXISTENTES (NO MODIFICAR) ====================

  // Registrar movimiento (YA EXISTE)
  // services/trazabilidad.service.ts - MÉTODO CORREGIDO
async registrarMovimiento(movimiento: NuevoMovimiento) {
  try {
    
    // Obtener usuario actual
    const { data: userData } = await supabase.auth.getUser();
    const usuarioId = userData.user?.id;

    const movimientoData: Partial<Trazabilidadx> = {
      tipo_evento: movimiento.tipo_evento,
      producto_id: movimiento.producto_id,
      cantidad: movimiento.cantidad,
      motivo: movimiento.motivo,
      detalles: movimiento.detalles || null,
      ubicacion_origen: movimiento.ubicacion_origen || null,
      ubicacion_destino: movimiento.ubicacion_destino || null,
      estado_evento: movimiento.estado_evento || 'completado',
      observaciones: movimiento.observaciones || null,
      usuario_id: usuarioId || null,
      fecha_evento: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from(this.tableName)
      .insert([movimientoData])
      .select()
      .single();

    if (error) throw error;
    
    return data as Trazabilidadx;
    
  } catch (error: any) {
    console.error('❌ Error registrando movimiento:', error);
    throw this.handleError(error, 'registrar movimiento');
  }
}
  // Obtener historial completo de un producto (YA EXISTE)
  async getHistorialProducto(productoId: number, limit: number = 50) {
    try {
      
      const { data, error } = await supabase
        .from(this.tableName)
        .select(`
          *,
          perfiles (nombre_completo)
        `)
        .eq('producto_id', productoId)
        .order('fecha_evento', { ascending: false })
        .limit(limit);

      if (error) throw error;
      
      // Formatear datos
      const historial = (data || []).map(item => ({
        ...item,
        usuario_nombre: (item as any).perfiles?.nombre_completo
      }));
      
      return historial;
      
    } catch (error: any) {
      console.error(`❌ Error obteniendo historial producto ${productoId}:`, error);
      throw this.handleError(error, `obtener historial producto ${productoId}`);
    }
  }

  // Obtener movimientos por rango de fechas (YA EXISTE)
  async getMovimientosPorFecha(fechaInicio: string, fechaFin: string) {
    try {
      
      const { data, error } = await supabase
        .from(this.tableName)
        .select(`
          *,
          productos (nombre, codigo),
          perfiles (nombre_completo)
        `)
        .gte('fecha_evento', fechaInicio)
        .lte('fecha_evento', fechaFin)
        .order('fecha_evento', { ascending: false });

      if (error) throw error;
      
      return data;
      
    } catch (error: any) {
      console.error('❌ Error obteniendo movimientos por fecha:', error);
      throw this.handleError(error, 'obtener movimientos por fecha');
    }
  }

  // Obtener estadísticas de movimientos (YA EXISTE)
  async getEstadisticasMovimientos() {
    try {
      // Últimos 30 días
      const fechaInicio = new Date();
      fechaInicio.setDate(fechaInicio.getDate() - 30);
      
      const { data, error } = await supabase
        .from(this.tableName)
        .select('tipo_evento, cantidad, fecha_evento')
        .gte('fecha_evento', fechaInicio.toISOString());

      if (error) throw error;

      const totalMovimientos = data?.length || 0;
      const entradas = data?.filter(m => m.tipo_evento === 'entrada').length || 0;
      const salidas = data?.filter(m => m.tipo_evento === 'salida').length || 0;
      const transferencias = data?.filter(m => m.tipo_evento === 'transferencia').length || 0;
      const totalCantidad = data?.reduce((sum, m) => sum + m.cantidad, 0) || 0;

      return {
        totalMovimientos,
        entradas,
        salidas,
        transferencias,
        totalCantidad,
        promedioDiario: Number((totalCantidad / 30).toFixed(2))
      };
      
    } catch (error) {
      console.error('❌ Error obteniendo estadísticas de movimientos:', error);
      return { 
        totalMovimientos: 0, 
        entradas: 0, 
        salidas: 0, 
        transferencias: 0,
        totalCantidad: 0, 
        promedioDiario: 0 
      };
    }
  }

  // Obtener últimos movimientos para dashboard (YA EXISTE)
  async getUltimosMovimientos(limit: number = 10) {
    try {
      const { data, error } = await supabase
        .from(this.tableName)
        .select(`
          *,
          productos (nombre, codigo),
          perfiles (nombre_completo)
        `)
        .order('fecha_evento', { ascending: false })
        .limit(limit);

      if (error) throw error;
      
      return data;
      
    } catch (error) {
      console.error('❌ Error obteniendo últimos movimientos:', error);
      return [];
    }
  }

  // ==================== MANEJO DE ERRORES ====================

  private handleError(error: any, context: string): Error {
    console.error(`[${context}] Error:`, error);
    
    if (error.message?.includes('Stock insuficiente')) {
      return new Error(error.message);
    }
    
    if (error.code === '42501') {
      return new Error('No tienes permisos para realizar esta acción');
    }
    
    if (error.code === '23503') {
      return new Error('No se puede eliminar porque tiene registros relacionados');
    }
    
    if (error.message?.includes('JWT')) {
      return new Error('Error de autenticación. Por favor, inicie sesión nuevamente');
    }
    
    return new Error(error.message || `Error al ${context}`);
  }
}
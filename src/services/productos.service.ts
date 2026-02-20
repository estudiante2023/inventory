// services/productos.service.ts
import { Injectable } from '@angular/core';
import { supabase } from './supabase-client';
import { TrazabilidadService } from './trazabilidad.service';
import { AuthService } from './auth.service';
import { Producto, ProductoCompleto } from '../app/moldes/producto.model';
import * as XLSX from 'xlsx';
import { StorageService } from './storage.service';
import { EmailService } from './email.service';
@Injectable({
  providedIn: 'root'
})
export class ProductosService {
  private tableName = 'productos';
  private vistaCompleta = 'vista_productos_completa'; // Vista original
  private vistaSeriados = 'vista_todos_productos_bajo_stockx';
  ahoraEnStockBajocv: number | undefined;

  constructor(
    private trazabilidadService: TrazabilidadService,
    private authService: AuthService,
    private storageService: StorageService,
    private emailService: EmailService
  ) {
  }
async getProductosPorPartNumber(partNumber: string, excludeId?: number, includeId?: number): Promise<any[]> {
  try {
    let query = supabase
      .from(this.tableName)
      .select('*')
      .eq('part_number', partNumber)
      .eq('esta_activo', true);
    
    if (excludeId) {
      query = query.neq('id', excludeId);
    }
    if (includeId) {
      query = query.eq('id', includeId); // Esto es para casos específicos, normalmente no se usa con exclude
    }
    
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error obteniendo productos por part number:', error);
    return [];
  }
}


// En productos.service.ts
async getProductoAgrupadoPorPartNumber(partNumber: string): Promise<any | null> {
  try {
    const { data, error } = await supabase
      .from(this.vistaSeriados)
      .select('*')
      .eq('part_number', partNumber)
      .limit(1)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // no encontrado
      throw error;
    }
    return data;
  } catch (error) {
    console.error('Error obteniendo producto agrupado:', error);
    return null;
  }
}
async obtenerUmbralStockMinimo(): Promise<number> {
  try {
    const { data, error } = await supabase
      .from('configuraciones')
      .select('valor')
      .eq('clave', 'cantidad_minima')
      .single();
    if (error) throw error;
    return data ? parseInt(data.valor) : 5;
  } catch {
    return 5; // valor por defecto
  }
}

  // ==================== MÉTODOS AUXILIARES PARA TRAZABILIDAD ====================

  private async registrarCreacion(productoId: number, datosIniciales: any) {
    try {
      const detalles = Object.entries(datosIniciales)
        .map(([key, value]) => `${key}: ${value ?? 'N/A'}`)
        .join('\n');

      await this.trazabilidadService.registrarMovimiento({
        tipo_evento: 'CREACION',
        producto_id: productoId,
        cantidad: datosIniciales.cantidad_actual || 0,
        motivo: 'Producto creado',
        detalles: `Datos iniciales:\n${detalles}`,
        estado_evento: 'completado'
      });
    } catch (error) {
      console.error('⚠️ Error registrando creación:', error);
      // No lanzamos error para no interrumpir el flujo principal
    }
  }

  private async registrarActualizacion(
    productoId: number,
    cambios: { campo: string, anterior: any, nuevo: any }[],
    motivo: string = 'Actualización manual'
  ) {
    try {
      if (cambios.length === 0) return;

      const detalles = cambios.map(c =>
        `${c.campo}: ${c.anterior ?? 'N/A'} → ${c.nuevo ?? 'N/A'}`
      ).join('\n');

      await this.trazabilidadService.registrarMovimiento({
        tipo_evento: 'ACTUALIZACION',
        producto_id: productoId,
        cantidad: 0,
        motivo: motivo,
        detalles: detalles,
        estado_evento: 'completado'
      });
    } catch (error) {
      console.error('⚠️ Error registrando actualización:', error);
    }
  }

  private async registrarDesactivacion(productoId: number, datosFinales: any, motivo?: string) {
    try {
      const detalles = Object.entries(datosFinales)
        .filter(([key]) => !['id', 'created_at', 'updated_at'].includes(key))
        .map(([key, value]) => `${key}: ${value ?? 'N/A'}`)
        .join('\n');

      await this.trazabilidadService.registrarMovimiento({
        tipo_evento: 'ELIMINACION',
        producto_id: productoId,
        cantidad: datosFinales.cantidad_actual || 0,
        motivo: motivo || 'Producto desactivado',
        detalles: `Datos finales:\n${detalles}`,
        estado_evento: 'completado'
      });
    } catch (error) {
      console.error('⚠️ Error registrando desactivación:', error);
    }
  }

  // ==================== CRUD BÁSICO CON TRAZABILIDAD ====================

  // Crear producto CON registro de creación
  async createProducto(producto: Omit<Producto, 'id' | 'created_at' | 'esta_activo'>) {
    try {
      // Validar datos requeridos
      if (!producto.nombre.trim()) {
        throw new Error('El nombre del producto es requerido');
      }

      if (producto.cantidad_actual < 0) {
        throw new Error('La cantidad actual no puede ser negativa');
      }

      // Eliminar id si existe
      const productoParaInsertar: any = { ...producto };
      delete productoParaInsertar.id;

      console.log('📤 Creando producto:', productoParaInsertar);

      const { data, error } = await supabase
        .from(this.tableName)
        .insert([{
          ...productoParaInsertar,
          esta_activo: true,
          created_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (error) throw error;

      // REGISTRAR CREACIÓN
      await this.registrarCreacion(data.id, {
        nombre: data.nombre,
        serial_number: data.serial_number,
        cantidad_actual: data.cantidad_actual,
        ubicacion_id: data.ubicacion_id,
        estado: data.estado,
        precio: data.precio
      });

      console.log(`✅ Producto creado: ${data.nombre} (ID: ${data.id})`);
      return data as Producto;

    } catch (error: any) {
      console.error('❌ Error creando producto:', error);
      throw this.handleError(error, 'crear producto');
    }
  }

  // Actualizar producto CON registro de cambios
  async updateProducto(id: number, updates: Partial<Producto>) {
    try {
      console.log(`✏️ Actualizando producto ID: ${id}`, updates);

      // 1. Obtener producto actual para comparar
      const productoActual = await this.getProductoById(id);

      // 2. Identificar cambios específicos
      const cambios = [];
      const camposCriticos = ['nombre', 'serial_number', 'cantidad_actual', 'precio', 'ubicacion_id', 'estado'];

      for (const [key, nuevoValor] of Object.entries(updates)) {
        const valorAnterior = productoActual[key as keyof ProductoCompleto];

        // Solo registrar si realmente cambió
        if (JSON.stringify(valorAnterior) !== JSON.stringify(nuevoValor)) {
          cambios.push({
            campo: key,
            anterior: valorAnterior,
            nuevo: nuevoValor
          });
        }
      }

      // 3. Validar cantidad si se actualiza
      if (updates.cantidad_actual !== undefined && updates.cantidad_actual < 0) {
        throw new Error('La cantidad actual no puede ser negativa');
      }

      // 4. Actualizar producto
      const { data, error } = await supabase
        .from(this.tableName)
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      // 5. REGISTRAR CAMBIOS si hubo modificaciones
      if (cambios.length > 0) {
        await this.registrarActualizacion(id, cambios, 'Actualización de producto');
      }

      console.log(`✅ Producto ${id} actualizado (${cambios.length} cambios registrados)`);
      return data as Producto;

    } catch (error: any) {
      console.error(`❌ Error actualizando producto ${id}:`, error);
      throw this.handleError(error, `actualizar producto ${id}`);
    }
  }
  async eliminarProductoPermanente(id: number, motivo?: string): Promise<boolean> {
    try {
      console.log(`🔥 Intentando eliminación permanente de producto ID: ${id}`);

      // 1. Obtener producto
      const producto = await this.getProductoById(id);

      // 2. Verificar estado (sin importar la ubicación)
      if (!producto || producto.estado?.toUpperCase() !== 'CONDENADO') {
        const estadoActual = producto?.estado || 'sin estado';
        throw new Error(`No se puede eliminar: el producto no está en estado CONDENADO (estado actual: ${estadoActual})`);
      }

      // 3. Eliminar definitivamente (ON DELETE CASCADE eliminará trazabilidad)
      const { error } = await supabase
        .from(this.tableName)
        .delete()
        .eq('id', id);

      if (error) throw error;

      console.log(`✅ Producto ${id} eliminado permanentemente (estado: CONDENADO)`);
      return true;

    } catch (error: any) {
      console.error(`❌ Error eliminando producto ${id}:`, error);
      throw this.handleError(error, `eliminar producto permanente ${id}`);
    }
  }
  // Desactivar producto CON registro - MODIFICADO
  async desactivarProducto(id: number, motivo?: string) {
    try {
      console.log(`⏸️ Desactivando producto ID: ${id}`);

      // 1. Obtener datos antes de desactivar
      const producto = await this.getProductoById(id);

      // 2. VERIFICACIÓN CRÍTICA: Si el producto está en BODEGA QUITO (ubicacion_id = 9)
      // NO lo desactives ni elimines, déjalo activo con cantidad 0
      if (producto.ubicacion_id === 9) {
        console.log(`⚠️ Producto ${id} está en BODEGA QUITO (ID: 9). No se desactivará ni eliminará. Se mantendrá activo con cantidad 0.`);

        // Solo actualizar la cantidad a 0 si es necesario, pero mantener activo
        if (producto.cantidad_actual > 0) {
          await this.updateProducto(id, {
            cantidad_actual: 0
          });

          // Registrar el ajuste a 0 en trazabilidad
          await this.trazabilidadService.registrarMovimiento({
            tipo_evento: 'ajuste',
            producto_id: id,
            cantidad: 0,
            motivo: motivo || 'Producto en BODEGA QUITO con cantidad 0',
            detalles: `Producto en BODEGA QUITO mantiene estado activo. Cantidad ajustada a 0. Motivo: ${motivo}`,
            estado_evento: 'completado'
          });
        }

        console.log(`✅ Producto ${id} en BODEGA QUITO mantiene estado activo (cantidad: 0)`);
        return false; // Retornar false para indicar que no se desactivó
      }

      // 3. Solo desactivar productos que NO están en BODEGA QUITO
      const { error } = await supabase
        .from(this.tableName)
        .update({ esta_activo: false })
        .eq('id', id);

      if (error) throw error;

      // 4. REGISTRAR DESACTIVACIÓN
      await this.registrarDesactivacion(id, producto, motivo || 'Desactivación manual');

      console.log(`✅ Producto ${id} desactivado y registrado`);
      return true;

    } catch (error: any) {
      console.error(`❌ Error desactivando producto ${id}:`, error);
      throw this.handleError(error, `desactivar producto ${id}`);
    }
  }
  // Activar producto CON registro
  async activarProducto(id: number) {
    try {
      console.log(`▶️ Activando producto ID: ${id}`);

      const { error } = await supabase
        .from(this.tableName)
        .update({ esta_activo: true })
        .eq('id', id);

      if (error) throw error;

      // Registrar activación
      await this.trazabilidadService.registrarMovimiento({
        tipo_evento: 'ACTIVACION',
        producto_id: id,
        cantidad: 0,
        motivo: 'Producto reactivado',
        detalles: 'Producto marcado como activo nuevamente',
        estado_evento: 'completado'
      });

      console.log(`✅ Producto ${id} activado`);
      return true;

    } catch (error: any) {
      console.error(`❌ Error activando producto ${id}:`, error);
      throw this.handleError(error, `activar producto ${id}`);
    }
  }

  // ==================== MÉTODOS ESPECÍFICOS PARA MOVIMIENTOS ====================

  // Registrar INGRESO de stock (claro y separado)
  async registrarIngreso(
    productoId: number,
    cantidad: number,
    motivo: string,
    detalles?: string
  ) {
    try {
      console.log(`📥 Registrando INGRESO para producto ${productoId}: ${cantidad} unidades`);

      // 1. Obtener producto actual
      const producto = await this.getProductoById(productoId);

      // 2. Calcular nueva cantidad
      const nuevaCantidad = producto.cantidad_actual + cantidad;

      // 3. Actualizar stock
      await this.updateProducto(productoId, {
        cantidad_actual: nuevaCantidad
      });

      // 4. Registrar movimiento ESPECÍFICO DE INGRESO
      await this.trazabilidadService.registrarMovimiento({
        tipo_evento: 'INGRESO',
        producto_id: productoId,
        cantidad: cantidad,
        motivo: motivo,
        detalles: detalles || `Ingreso de ${cantidad} unidades. Stock anterior: ${producto.cantidad_actual}, Stock nuevo: ${nuevaCantidad}`,
        ubicacion_destino: producto.ubicacion_nombre,
        estado_evento: 'completado'
      });

      console.log(`✅ INGRESO registrado: ${cantidad} unidades al producto ${productoId}`);
      return true;

    } catch (error: any) {
      console.error(`❌ Error registrando ingreso producto ${productoId}:`, error);
      throw this.handleError(error, `registrar ingreso producto ${productoId}`);
    }
  }

  // Registrar EGRESO de stock (claro y separado)
  async registrarEgreso(
    productoId: number,
    cantidad: number,
    motivo: string,
    detalles?: string
  ) {
    try {
      console.log(`📤 Registrando EGRESO para producto ${productoId}: ${cantidad} unidades`);

      // 1. Obtener producto actual
      const producto = await this.getProductoById(productoId);

      // 2. Validar stock suficiente
      if (producto.cantidad_actual < cantidad) {
        throw new Error(`Stock insuficiente. Disponible: ${producto.cantidad_actual}, Solicitado: ${cantidad}`);
      }

      // 3. Calcular nueva cantidad
      const nuevaCantidad = producto.cantidad_actual - cantidad;

      // 4. Actualizar stock
      await this.updateProducto(productoId, {
        cantidad_actual: nuevaCantidad
      });

      // 5. Registrar movimiento ESPECÍFICO DE EGRESO
      await this.trazabilidadService.registrarMovimiento({
        tipo_evento: 'EGRESO',
        producto_id: productoId,
        cantidad: cantidad,
        motivo: motivo,
        detalles: detalles || `Egreso de ${cantidad} unidades. Stock anterior: ${producto.cantidad_actual}, Stock nuevo: ${nuevaCantidad}`,
        ubicacion_origen: producto.ubicacion_nombre,
        estado_evento: 'completado'
      });

      console.log(`✅ EGRESO registrado: ${cantidad} unidades del producto ${productoId}`);
      return true;

    } catch (error: any) {
      console.error(`❌ Error registrando egreso producto ${productoId}:`, error);
      throw this.handleError(error, `registrar egreso producto ${productoId}`);
    }
  }

  // Registrar TRANSFERENCIA entre ubicaciones
  async transferirProducto(
    productoId: number,
    nuevaUbicacionId: number,
    cantidad: number,
    motivo: string,
    detalles?: string
  ) {
    try {
      console.log(`🚚 Transferiendo producto ${productoId} a ubicación ${nuevaUbicacionId}`);

      // 1. Obtener producto y ubicaciones
      const producto = await this.getProductoById(productoId);

      const { data: ubicacionDestino, error: errorUbicacion } = await supabase
        .from('ubicaciones')
        .select('nombre')
        .eq('id', nuevaUbicacionId)
        .single();

      if (errorUbicacion) {
        throw new Error('Ubicación destino no encontrada');
      }

      // 2. Verificar stock suficiente (si es transferencia de cantidad específica)
      if (cantidad > 0 && producto.cantidad_actual < cantidad) {
        throw new Error(`Stock insuficiente. Disponible: ${producto.cantidad_actual}, Solicitado: ${cantidad}`);
      }

      // 3. Actualizar ubicación del producto (si es transferencia completa o parcial)
      if (cantidad === producto.cantidad_actual || cantidad === 0) {
        // Transferencia completa o solo cambio de ubicación
        await this.updateProducto(productoId, {
          ubicacion_id: nuevaUbicacionId
        });
      }

      // 4. Registrar TRANSFERENCIA específica
      await this.trazabilidadService.registrarMovimiento({
        tipo_evento: 'TRANSFERENCIA',
        producto_id: productoId,
        cantidad: cantidad || producto.cantidad_actual,
        motivo: motivo,
        detalles: detalles || `Transferencia de ${cantidad || 'todas las'} unidades`,
        ubicacion_origen: producto.ubicacion_nombre || null,
        ubicacion_destino: ubicacionDestino.nombre,
        estado_evento: 'completado'
      });

      console.log(`✅ Producto ${productoId} transferido exitosamente`);
      return true;

    } catch (error: any) {
      console.error(`❌ Error transfiriendo producto ${productoId}:`, error);
      throw this.handleError(error, `transferir producto ${productoId}`);
    }
  }

  // ==================== MÉTODOS EXISTENTES (sin cambios) ====================

  async getProductos(filters?: {
    estado?: string;
    criticidad?: string;
    ubicacion_id?: number;
    search?: string;
    bajo_stock?: boolean;
    componente?: string;          // ← NUEVA LÍNEA
    limit?: number;
    page?: number;
    orderBy?: string;
    orderDir?: 'asc' | 'desc';
  }) {
    try {
      console.log('📡 Obteniendo productos con filtros:', filters);

      // Decidir qué vista usar
      const usarVistaAgrupada = filters?.bajo_stock === true;
      const vistaAUsar = usarVistaAgrupada ? this.vistaSeriados : this.vistaCompleta;

      let query = supabase
        .from(vistaAUsar)
        .select('*', { count: 'exact' });

      // Aplicar filtros
      if (filters?.estado && filters.estado !== 'todos') {
        query = query.eq('estado', filters.estado);
      }

      if (filters?.criticidad && filters.criticidad !== 'todos') {
        query = query.eq('criticidad', filters.criticidad);
      }

      if (filters?.ubicacion_id) {
        query = query.eq('ubicacion_id', filters.ubicacion_id);
      }
      if (filters?.componente && filters.componente !== 'todos') {
        query = query.eq('componente', filters.componente);
      }
      if (filters?.search) {
        if (usarVistaAgrupada) {
          // En vista agrupada, buscar solo en nombre y part_number
          query = query.or(
            `nombre.ilike.%${filters.search}%,` +
            `part_number.ilike.%${filters.search}%`
          );
        } else {
          // En vista normal, buscar en todos los campos
          query = query.or(
            `nombre.ilike.%${filters.search}%,` +
            `descripcion.ilike.%${filters.search}%,` +
            `codigo.ilike.%${filters.search}%,` +
            `part_number.ilike.%${filters.search}%,` +
            `serial_number.ilike.%${filters.search}%`
          );
        }
      }

      // IMPORTANTE: Si estamos en vista agrupada, NO aplicar filtro bajo_stock
      // porque la vista YA está filtrada por bajo stock
      // Solo aplicar si estamos en vista normal
      if (filters?.bajo_stock && !usarVistaAgrupada) {
        query = query.or('estado_stock.eq.BAJO,estado_stock.eq.AGOTADO');
      }

      // Ordenamiento: usar columna diferente para vista agrupada
      let orderColumn = filters?.orderBy || 'id';
      const orderDirection = filters?.orderDir || 'desc';

      // Si es vista agrupada y se pide ordenar por cantidad, usar cantidad_total
      if (usarVistaAgrupada && orderColumn === 'cantidad_actual') {
        // En la vista agrupada, cantidad_actual es el alias de cantidad_total
        orderColumn = 'cantidad_actual';
      }

      // Si es vista agrupada y NO se especifica orden, ordenar por cantidad (más lógico)
      if (usarVistaAgrupada && !filters?.orderBy) {
        orderColumn = 'cantidad_actual';
        query = query.order(orderColumn, { ascending: true }); // Ascendente: menor cantidad primero
      } else {
        query = query.order(orderColumn, { ascending: orderDirection === 'asc' });
      }

      // Paginación
      if (filters?.limit && filters?.page) {
        const from = (filters.page - 1) * filters.limit;
        const to = from + filters.limit - 1;
        query = query.range(from, to);
      }

      const { data, error, count } = await query;

      if (error) {
        console.error('❌ Error en consulta:', error);
        throw error;
      }

      console.log(`✅ ${data?.length || 0} productos obtenidos (${usarVistaAgrupada ? 'AGRUPADOS' : 'INDIVIDUALES'})`);

      // Procesar datos según la vista usada
      let productosProcesados: ProductoCompleto[];

      if (usarVistaAgrupada) {
        // Para vista agrupada, enriquecer con ubicación si es posible
        productosProcesados = await this.enriquecerProductosAgrupados(data || []);
      } else {
        // Para vista normal, usar datos directamente
        productosProcesados = data as ProductoCompleto[];
      }

      return {
        data: productosProcesados,
        count: count || 0,
        page: filters?.page || 1,
        limit: filters?.limit || 10,
        agrupado: usarVistaAgrupada
      };

    } catch (error: any) {
      console.error('💥 Error en getProductos:', error);
      throw this.handleError(error, 'obtener productos');
    }
  }

  // Método auxiliar para enriquecer productos agrupados con información de ubicación
  private async enriquecerProductosAgrupados(productosAgrupados: any[]): Promise<ProductoCompleto[]> {
    try {
      // Obtener IDs de ubicación únicos
      const ubicacionIds = [...new Set(productosAgrupados.map(p => p.ubicacion_id).filter(Boolean))];

      // Obtener información de ubicaciones
      let ubicacionesMap = new Map<number, any>();

      if (ubicacionIds.length > 0) {
        const { data: ubicaciones, error } = await supabase
          .from('ubicaciones')
          .select('id, nombre, descripcion, estado')
          .in('id', ubicacionIds);

        if (!error && ubicaciones) {
          ubicaciones.forEach(u => {
            ubicacionesMap.set(u.id, u);
          });
        }
      }

      // Mapear productos agrupados a ProductoCompleto
      return productosAgrupados.map(item => {
        const ubicacion = item.ubicacion_id ? ubicacionesMap.get(item.ubicacion_id) : null;

        return {
          id: item.id,
          nombre: item.nombre,
          descripcion: item.descripcion || `Agrupado: ${item.cantidad_items} items con mismo Part Number`,
          componente: item.componente || null,
          criticidad: item.criticidad,
          part_number: item.part_number,
          codigo: item.codigo || null,
          serial_number: item.serial_numbers || null,
          estado: item.estado,
          cantidad_actual: item.cantidad_actual,
          ubicacion_id: item.ubicacion_id,
          precio: item.precio || 0,
          fecha_adquisicion: item.fecha_adquisicion || null,
          orden_envio: item.orden_envio || null,
          factura: item.factura || null,
          observaciones: item.observaciones || `Items agrupados: ${item.cantidad_items}`,
          created_at: item.created_at || null,
          esta_activo: item.esta_activo,
          ubicacion_nombre: ubicacion?.nombre || null,
          ubicacion_descripcion: ubicacion?.descripcion || null,
          ubicacion_estado: ubicacion?.estado || null,
          estado_stock: item.estado_stock,
          diferencia_stock: 0,
          valor_total: item.valor_total || 0,
          // Campos adicionales para vista agrupada
          cantidad_items: item.cantidad_items,
          es_agrupado: true
        } as ProductoCompleto & { cantidad_items?: number; es_agrupado?: boolean };
      });

    } catch (error) {
      console.error('Error enriqueciendo productos agrupados:', error);
      return productosAgrupados.map(item => ({
        ...item,
        ubicacion_nombre: null,
        ubicacion_descripcion: null,
        ubicacion_estado: null,
        es_agrupado: true
      })) as ProductoCompleto[];
    }
  }

  async getProductoById(id: number): Promise<ProductoCompleto> {
    try {
      console.log(`📡 Obteniendo producto ID: ${id}`);

      const { data, error } = await supabase
        .from(this.vistaCompleta)
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;

      console.log(`✅ Producto ${id} obtenido:`, data?.nombre);
      return data as ProductoCompleto;

    } catch (error: any) {
      console.error(`❌ Error obteniendo producto ${id}:`, error);
      throw this.handleError(error, `obtener producto ${id}`);
    }
  }

  // ==================== MÉTODOS DE CONSULTA (sin cambios) ====================


  async ejecutarTruncateCompleto(): Promise<{
    success: boolean;
    mensaje: string;
    detalles: any
  }> {
    try {
      // Llama a la nueva función
      const { data, error } = await supabase.rpc('limpiar_productos_y_trazabilidad');

      if (error) throw error;

      return {
        success: true,
        mensaje: data.mensaje,
        detalles: data
      };

    } catch (error: any) {
      console.error('💥 Error:', error);
      throw this.handleError(error, 'limpiar productos y trazabilidad');
    }
  }

  // 
  async setTotalProductosBajoStock(total: number): Promise<void> {
    try {
      const { error } = await supabase
        .from('configuraciones')
        .upsert({
          clave: 'total_productos_stock_bajo',
          valor: total.toString(),
          descripcion: 'Total de productos con stock bajo (para alertas automáticas)',
          fecha_actualizacion: new Date().toISOString()
        }, {
          onConflict: 'clave'
        });

      if (error) throw error;

      console.log(`✅ Total productos bajo stock actualizado a: ${total}`);
    } catch (error) {
      console.error('Error actualizando total productos bajo stock:', error);
    }
  }










  // Método de respaldo manual
  private async eliminacionManual(): Promise<any> {
    try {
      console.log('🔄 Usando método manual...');

      // 1. Eliminar trazabilidad
      await supabase.from('trazabilidad').delete().not('id', 'is', null);

      // 2. Eliminar productos
      await supabase.from('productos').delete().not('id', 'is', null);

      // 3. Obtener admin ID
      const { data: admin } = await supabase
        .from('roles')
        .select('id')
        .eq('nombre', 'admin')
        .single();

      // 4. Eliminar perfiles no admin
      if (admin) {
        await supabase
          .from('perfiles')
          .delete()
          .or(`role_id.neq.${admin.id},role_id.is.null`);
      }

      return {
        success: true,
        mensaje: '✅ Sistema limpiado manualmente (admin mantuvo).',
        detalles: { metodo: 'manual' }
      };

    } catch (error) {
      throw error;
    }
  }





  // En productos.service.ts
  // En productos.service.ts - NUEVO método para alertas AGRUPADAS
  async getProductosBajoStockAgrupadosParaAlertas(): Promise<any[]> {
    try {
      console.log('📡 Obteniendo productos bajo stock AGRUPADOS para alertas...');

      // Usar la vista AGRUPADA (vistaSeriados)
      const { data, error } = await supabase
        .from(this.vistaSeriados) // Esta es la vista agrupada
        .select('*')
        .order('cantidad_actual', { ascending: true });

      if (error) throw error;

      // Enriquecer con información de ubicación
      const productosEnriquecidos = await Promise.all(
        (data || []).map(async (producto: any) => {
          let ubicacionNombre = 'Sin ubicación';
          if (producto.ubicacion_id) {
            const { data: ubicacion } = await supabase
              .from('ubicaciones')
              .select('nombre')
              .eq('id', producto.ubicacion_id)
              .single();
            ubicacionNombre = ubicacion?.nombre || 'Sin ubicación';
          }

          return {
            id: producto.id || producto.id_referencia || 0,
            nombre: producto.nombre || '',
            descripcion: producto.descripcion || `Agrupado: ${producto.cantidad_items || 1} items`,
            componente: producto.componente || '',
            criticidad: producto.criticidad || 'medio',
            part_number: producto.part_number || producto.part_number_agrupado || '',
            codigo: producto.codigo || producto.part_number || `ID: ${producto.id}`,
            serial_number: producto.serial_numbers || producto.serial_number || '',
            estado: producto.estado || '',
            cantidad_actual: producto.cantidad_actual || producto.cantidad_total || 0,
            ubicacion_id: producto.ubicacion_id,
            ubicacion_nombre: ubicacionNombre,
            precio: producto.precio || producto.precio_promedio || 0,
            fecha_adquisicion: producto.fecha_adquisicion || '',
            orden_envio: producto.orden_envio || '',
            factura: producto.factura || '',
            observaciones: producto.observaciones || `Items agrupados: ${producto.cantidad_items || 1}`,
            created_at: producto.created_at || '',
            cantidad_items: producto.cantidad_items || 1,
            valor_total: producto.valor_total || 0,
            estado_stock: producto.estado_stock || 'BAJO'
          };
        })
      );

      console.log(`✅ ${productosEnriquecidos.length} productos AGRUPADOS para alerta obtenidos`);

      // Para debug
      productosEnriquecidos.forEach(p => {
        console.log(`🔍 Producto: #${p.id} | ${p.nombre} | Part: ${p.part_number} | Stock: ${p.cantidad_actual} | Items: ${p.cantidad_items}`);
      });

      return productosEnriquecidos;

    } catch (error: any) {
      console.error('❌ Error obteniendo productos agrupados para alertas:', error);
      return [];
    }
  }


  async diagnosticarVistaBajoStock() {
    try {
      console.log('🔍 Diagnóstico de vista bajo stock...');

      // 1. Ver qué devuelve la vista directamente
      const { data: vistaData, error: vistaError } = await supabase
        .from(this.vistaSeriados)
        .select('*')
        .limit(30);

      console.log('📊 Primeros 30 registros de la vista:', vistaData);
      console.log('❌ Error de vista:', vistaError);

      // 2. Verificar configuración
      const { data: config } = await supabase
        .from('configuraciones')
        .select('clave, valor')
        .eq('clave', 'cantidad_minima')
        .single();

      console.log('⚙️ Configuración cantidad_minima:', config);

      // 3. Ver productos individuales para comparar
      const { data: productosEjemplo } = await supabase
        .from('productos')
        .select('id, nombre, part_number, cantidad_actual, ubicacion_id')
        .eq('esta_activo', true)
        .limit(5);

      console.log('📦 Ejemplo productos individuales:', productosEjemplo);

      return {
        vista_muestra: vistaData,
        configuracion: config,
        productos_ejemplo: productosEjemplo,
        vista_nombre: this.vistaSeriados
      };

    } catch (error) {
      console.error('❌ Error en diagnóstico:', error);
      return null;
    }
  }


  async getEstadisticas() {
    try {
      console.log('📊 Obteniendo estadísticas desde vista filtrada...');

      // 1. Obtener configuración de cantidad mínima
      const { data: configData, error: configError } = await supabase
        .from('configuraciones')
        .select('valor')
        .eq('clave', 'cantidad_minima')
        .single();

      const cantidadMinima = configError ? 3 : parseInt(configData.valor) || 3;

      // 2. Obtener productos individuales SOLO para totales y valor total
      const { data: todosProductos, error: errorProductos } = await supabase
        .from('productos')
        .select('id, cantidad_actual, precio, criticidad')   // ← AGREGAR criticidad
        .eq('esta_activo', true);
      // Productos críticos (ALTA + CRÍTICO)
      const criticos = todosProductos?.filter(p =>
          p.criticidad === 'CRÍTICO'
      ).length || 0;
      if (errorProductos) {
        console.error('Error obteniendo productos totales:', errorProductos);
        throw errorProductos;
      }

      // 3. Obtener productos con bajo stock DESDE LA VISTA QUE YA FILTRA
      const { data: productosBajoStock, error: errorBajoStock } = await supabase
        .from(this.vistaSeriados) // Esta vista YA tiene solo productos con bajo stock/agotado
        .select('*');

      if (errorBajoStock) {
        console.warn('⚠️ No se pudo obtener vista de bajo stock:', errorBajoStock);
      }

      // 4. Cálculos SIMPLES usando la vista filtrada
      const total = todosProductos?.length || 0;
      const valorTotal = todosProductos?.reduce((sum, p) =>
        sum + (p.precio || 0) * (p.cantidad_actual || 0), 0
      ) || 0;

      // ¡CAMBIOS AQUÍ!
      // La vista ya filtra solo productos con BAJO o AGOTADO
      const totalAlertas = productosBajoStock?.length || 0; // Esto es 22

      // Contar agotados
      const agotados = productosBajoStock?.filter(p =>
        p.estado_stock === 'AGOTADO'
      ).length || 0; // Esto es 21

      // ¡IMPORTANTE: bajoStock será la SUMA de BAJO + AGOTADO!
      const bajoStock = totalAlertas; // Esto es 22 (1 BAJO + 21 AGOTADO)

      console.log(`✅ Estadísticas desde vista:`);
      console.log(`   - Total productos: ${total}`);
      console.log(`   - Bajo stock (BAJO + AGOTADO): ${bajoStock}`); // ← 22
      console.log(`   - Detalle: Agotados: ${agotados}, Bajo stock puro: ${bajoStock - agotados}`);
      console.log(`   - Valor total: $${valorTotal.toFixed(2)}`);

      return {
        // Estadísticas básicas
        total,
        activos: total, // Todos están activos
        bajoStock,      // ← 22 (suma de BAJO + AGOTADO)
        agotados,       // ← 21 (solo AGOTADO)
        criticos,
        valorTotal: Number(valorTotal.toFixed(2)),

        // Información de configuración
        cantidadMinima,

        // Para información/depuración
        totalAlertas, // Mismo que bajoStock
        bajoStockPuro: bajoStock - agotados, // Solo productos con BAJO (1)
        usandoVistaFiltrada: true,
        registrosVista: productosBajoStock?.length || 0,

        // Para el frontend si necesita diferenciar
        mensaje: `${bajoStock} productos requieren atención (${agotados} agotados, ${bajoStock - agotados} con stock bajo)`
      };

    } catch (error) {
      console.error('❌ Error en getEstadisticas:', error);

      // Retorno mínimo en caso de error
      return {
        total: 0,
        activos: 0,
        bajoStock: 0,
        agotados: 0,

        valorTotal: 0,
        cantidadMinima: 3,
        totalAlertas: 0,
        bajoStockPuro: 0,
        usandoVistaFiltrada: true,
        registrosVista: 0
      };
    }
  }

  async buscarProductos(termino: string) {
    try {
      const { data, error } = await supabase
        .from(this.vistaCompleta)
        .select('*')
        .or(
          `nombre.ilike.%${termino}%,` +
          `codigo.ilike.%${termino}%,` +
          `part_number.ilike.%${termino}%,` +
          `serial_number.ilike.%${termino}%,` +
          `descripcion.ilike.%${termino}%`
        )
        .limit(20);

      if (error) throw error;
      return data as ProductoCompleto[];

    } catch (error) {
      console.error('❌ Error buscando productos:', error);
      return [];
    }
  }

  async exportarProductosAExcel(filters?: {
    estado?: string;
    criticidad?: string;
    ubicacion_id?: number;
    search?: string;
    bajo_stock?: boolean;
    componente?: string;
  }) {
    try {
      console.log('📤 Exportando productos a Excel con filtros:', filters);

      // Decidir qué vista usar basado en el filtro bajo_stock
      const usarVistaAgrupada = filters?.bajo_stock === true;
      const vistaAUsar = usarVistaAgrupada ? this.vistaSeriados : this.vistaCompleta;

      console.log(`🔀 Usando vista: ${usarVistaAgrupada ? 'AGRUPADA' : 'NORMAL'}`);

      let query = supabase
        .from(vistaAUsar)
        .select('*')
        .eq('esta_activo', true);

      // Aplicar filtros comunes
      if (filters) {
        if (filters.estado && filters.estado !== 'todos') {
          query = query.eq('estado', filters.estado);
        }
        if (filters.criticidad && filters.criticidad !== 'todos') {
          query = query.eq('criticidad', filters.criticidad);
        }
        if (filters.ubicacion_id) {
          query = query.eq('ubicacion_id', filters.ubicacion_id);
        }
        if (filters.componente && filters.componente !== 'todos') {
          query = query.eq('componente', filters.componente);
        }
        if (filters.search) {
          if (usarVistaAgrupada) {
            // En vista agrupada, buscar solo en nombre y part_number
            query = query.or(
              `nombre.ilike.%${filters.search}%,` +
              `part_number.ilike.%${filters.search}%`
            );
          } else {
            // En vista normal, buscar en todos los campos
            query = query.or(
              `nombre.ilike.%${filters.search}%,` +
              `descripcion.ilike.%${filters.search}%,` +
              `codigo.ilike.%${filters.search}%,` +
              `part_number.ilike.%${filters.search}%,` +
              `serial_number.ilike.%${filters.search}%`
            );
          }
        }

        // ¡IMPORTANTE! Si estamos en vista agrupada, NO aplicar filtro bajo_stock
        // porque la vista YA está filtrada por bajo stock
        if (filters.bajo_stock && !usarVistaAgrupada) {
          query = query.or('estado_stock.eq.BAJO,estado_stock.eq.AGOTADO');
        }
      }

      // ============ SOLUCIÓN SIMPLE: SIEMPRE ORDENAR POR ID ASCENDENTE ============
      // Elimina toda la lógica condicional de orden y usa solo esto:
      query = query.order('id', { ascending: true });
      // ============ FIN DE LA SOLUCIÓN ============

      const { data, error } = await query;

      if (error) {
        console.error('❌ Error en consulta de exportación:', error);
        throw error;
      }

      // Mapear datos según la vista usada
      let excelData;

      if (usarVistaAgrupada) {
        // Para vista agrupada: incluir campos adicionales
        excelData = (data || []).map(producto => ({
          'ID Referencia': producto.id,
          'Nombre': producto.nombre || '',
          'Descripción': producto.descripcion || '',
          'Componente': producto.componente || '',
          'Criticidad': producto.criticidad || '',
          'Part Number': producto.part_number || '',
          'Código': producto.codigo || '',
          'Serial Numbers': producto.serial_numbers || '',
          'Estado': producto.estado || '',
          'Cantidad Total': producto.cantidad_actual || 0,
          'Items Agrupados': producto.cantidad_items || 1,
          'Ubicación': producto.ubicacion_nombre || '',
          'Estantería': producto.estanteria || '', // <-- CAMPO AGREGADO
          'Precio Promedio': producto.precio || 0,
          'Valor Total': (producto.valor_total || 0).toFixed(2),
          'Fecha Adquisición': producto.fecha_adquisicion || '',
          'Orden Envío': producto.orden_envio || '',
          'Factura': producto.factura || '',
          'Observaciones': producto.observaciones || `Agrupado: ${producto.cantidad_items || 1} items`,
          'Estado Stock': producto.estado_stock || '',
          'Tipo Vista': 'AGRUPADO'
        }));
      } else {
        // Para vista normal: campos normales
        excelData = (data || []).map(producto => ({
          'ID': producto.id,
          'Nombre': producto.nombre || '',
          'Descripción': producto.descripcion || '',
          'Componente': producto.componente || '',
          'Criticidad': producto.criticidad || '',
          'Part Number': producto.part_number || '',
          'Código': producto.codigo || '',
          'Serial Number': producto.serial_number || '',
          'Estado': producto.estado || '',
          'Cantidad Actual': producto.cantidad_actual || 0,
          'Ubicación': producto.ubicacion_nombre || '',
          'Estantería': producto.estanteria || '', // <-- CAMPO AGREGADO
          'Precio': producto.precio || 0,
          'Fecha Adquisición': producto.fecha_adquisicion || '',
          'Orden Envío': producto.orden_envio || '',
          'Factura': producto.factura || '',
          'Observaciones': producto.observaciones || '',
          'Estado Stock': producto.estado_stock || '',
          'Tipo Vista': 'INDIVIDUAL'
        }));
      }

      // Crear libro de trabajo
      const worksheet = XLSX.utils.json_to_sheet(excelData);
      const workbook = XLSX.utils.book_new();

      // Ajustar anchos de columna según la vista (agregando ancho para "Estantería")
      const colWidths = usarVistaAgrupada ? [
        { wch: 12 },   // ID Referencia
        { wch: 30 },   // Nombre
        { wch: 40 },   // Descripción
        { wch: 15 },   // Componente
        { wch: 10 },   // Criticidad
        { wch: 20 },   // Part Number
        { wch: 15 },   // Código
        { wch: 30 },   // Serial Numbers
        { wch: 15 },   // Estado
        { wch: 15 },   // Cantidad Total
        { wch: 15 },   // Items Agrupados
        { wch: 20 },   // Ubicación
        { wch: 15 },   // Estantería
        { wch: 15 },   // Precio Promedio
        { wch: 15 },   // Valor Total
        { wch: 15 },   // Fecha Adquisición
        { wch: 15 },   // Orden Envío
        { wch: 15 },   // Factura
        { wch: 40 },   // Observaciones
        { wch: 12 },   // Estado Stock
        { wch: 10 }    // Tipo Vista
      ] : [
        { wch: 5 },    // ID
        { wch: 30 },   // Nombre
        { wch: 40 },   // Descripción
        { wch: 15 },   // Componente
        { wch: 10 },   // Criticidad
        { wch: 15 },   // Part Number
        { wch: 15 },   // Código
        { wch: 20 },   // Serial Number
        { wch: 15 },   // Estado
        { wch: 15 },   // Cantidad Actual
        { wch: 20 },   // Ubicación
        { wch: 15 },   // Estantería
        { wch: 12 },   // Precio
        { wch: 15 },   // Fecha Adquisición
        { wch: 15 },   // Orden Envío
        { wch: 15 },   // Factura
        { wch: 40 },   // Observaciones
        { wch: 12 },   // Estado Stock
        { wch: 10 }    // Tipo Vista
      ];

      worksheet['!cols'] = colWidths;

      // Solo agregar la hoja de productos
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Productos');

      // Generar archivo
      const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;

      // Nombre del archivo con información del filtro
      const fecha = new Date().toISOString().split('T')[0];
      const nombreArchivo = filters?.bajo_stock
        ? `productos_bajo_stock_${fecha}.xlsx`
        : `productos_${fecha}.xlsx`;

      link.download = nombreArchivo;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      console.log(`✅ ${excelData.length} productos exportados (${usarVistaAgrupada ? 'AGRUPADOS' : 'INDIVIDUALES'})`);
      return excelData;

    } catch (error: any) {
      console.error('❌ Error exportando productos:', error);
      throw this.handleError(error, 'exportar productos');
    }
  }
  // Agregar este método al ProductosService
  async buscarProductoPorCodigoEnUbicacion(codigo: string, ubicacionId: number): Promise<any> {
    try {
      const { data, error } = await supabase
        .from('productos')
        .select('*')
        .eq('codigo', codigo)
        .eq('ubicacion_id', ubicacionId)
        .eq('esta_activo', true)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 es "no rows returned"
        console.error('Error buscando producto:', error);
        return null;
      }

      return data || null;
    } catch (error) {
      console.error('Error en búsqueda:', error);
      return null;
    }
  }
  async actualizarOCrearEnBodegaQuito(productoData: any, cantidad: number): Promise<any> {
    try {
      // Buscar producto existente en BODEGA QUITO
      const productoExistente = await this.buscarProductoPorCodigoEnUbicacion(productoData.codigo, 9);

      if (productoExistente) {
        // Actualizar cantidad existente
        const nuevaCantidad = productoExistente.cantidad_actual + cantidad;
        return await this.updateProducto(productoExistente.id, {
          cantidad_actual: nuevaCantidad
        });
      } else {
        // Crear nuevo producto en BODEGA QUITO
        const nuevoProducto = {
          ...productoData,
          cantidad_actual: cantidad,
          ubicacion_id: 9 // BODEGA QUITO
        };
        return await this.createProducto(nuevoProducto);
      }
    } catch (error) {
      console.error('Error actualizando/creando en BODEGA QUITO:', error);
      throw error;
    }
  }























  // Método para verificar si un producto específico pasó a stock bajo
  async verificarProductoStockBajo(
    productoId: number,
    cantidadAnterior: number
  ): Promise<{ bajoStock: boolean; producto?: any }> {
    try {
      console.log(`🔍 Verificando producto ${productoId} para stock bajo...`);

      // 1. Obtener el producto actualizado
      const producto = await this.getProductoById(productoId);

      // 2. Obtener el umbral de stock bajo
      const { data: configData } = await supabase
        .from('configuraciones')
        .select('valor')
        .eq('clave', 'cantidad_minima')
        .single();

      const stockMinimo = configData ? parseInt(configData.valor) : 5;


      if (!!producto.serial_number) {
        this.ahoraEnStockBajocv = await this.obtenerCantidadSeriadoPorId(productoId);
      } else {
        this.ahoraEnStockBajocv = producto.cantidad_actual;
      }

      // 3. Verificar si el producto está ahora en stock bajo y antes no
      const estabaEnStockBajo = cantidadAnterior <= stockMinimo;
      const ahoraEnStockBajo = this.ahoraEnStockBajocv <= stockMinimo;



      console.log(`📊 Producto ${productoId}: Anterior: ${cantidadAnterior}, Actual: ${this.ahoraEnStockBajocv}, Mínimo: ${stockMinimo}`);
      console.log(`📊 Estado: Estaba en stock bajo? ${estabaEnStockBajo}, Ahora en stock bajo? ${ahoraEnStockBajo}`);

      // 4. Solo retornar true si PASÓ a estar en stock bajo (antes no, ahora sí)
      const bajoStock = !estabaEnStockBajo && ahoraEnStockBajo;

      if (bajoStock) {
        console.log(`🚨 Producto ${productoId} PASÓ a stock bajo!`);
        return { bajoStock: true, producto };
      }

      return { bajoStock: false };

    } catch (error) {
      console.error(`❌ Error verificando producto ${productoId}:`, error);
      return { bajoStock: false };
    }
  }




  // Método para enviar alerta de UN solo producto
  async enviarAlertaProductoIndividual(producto: any): Promise<boolean> {
    try {
      console.log(`📧 Enviando alerta para producto individual: ${producto.nombre}`);

      if (!this.emailService) {
        console.warn('⚠️ EmailService no disponible');
        return false;
      }

      // Crear array con solo este producto
      const productosArray = [producto];

      const resultado = await this.emailService.enviarAlertaStockBajo(productosArray);
      return resultado.success;

    } catch (error) {
      console.error('❌ Error enviando alerta individual:', error);
      return false;
    }
  }




  // Agregar este método al ProductosService
  async obtenerCantidadSeriadoPorId(productoId: number): Promise<number> {
    try {
      console.log(`🔍 Obteniendo cantidad de producto seriado ID: ${productoId}`);

      // Llamar a la función RPC que creamos en PostgreSQL
      const { data, error } = await supabase.rpc(
        'obtener_cantidad_seriado',
        { p_producto_id: productoId }
      );

      if (error) {
        console.error(`❌ Error llamando a obtener_cantidad_seriado:`, error);

      }

      console.log(`✅ Cantidad obtenida para producto ${productoId}: ${data}`);
      return data || 0;

    } catch (error: any) {
      console.error(`❌ Error en obtenerCantidadSeriadoPorId:`, error);
      return 0;
    }
  }

























  // Método ESPECÍFICO para importación de Excel
  private async crearUbicacionSiNoExiste(nombre: string): Promise<number | null> {
    try {
      if (!nombre || nombre.trim() === '') {
        console.log('⚠️ Nombre de ubicación vacío, retornando null');
        return null;
      }

      const nombreLimpio = nombre.trim();
      console.log(`📍 Buscando/creando ubicación: "${nombreLimpio}"`);

      // 1. Buscar si ya existe (insensible a mayúsculas/minúsculas)
      const { data: existente, error: errorBuscar } = await supabase
        .from('ubicaciones')
        .select('id')
        .ilike('nombre', nombreLimpio)
        .maybeSingle();

      if (errorBuscar && errorBuscar.code !== 'PGRST116') {
        console.warn(`⚠️ Error buscando ubicación:`, errorBuscar);
      }

      // 2. Si existe, retornar ID
      if (existente?.id) {
        console.log(`✅ Ubicación existente encontrada: "${nombreLimpio}" -> ID: ${existente.id}`);
        return existente.id;
      }

      // 3. Si no existe, CREAR
      console.log(`➕ Creando nueva ubicación: "${nombreLimpio}"`);

      const { data: nueva, error: errorCrear } = await supabase
        .from('ubicaciones')
        .insert({
          nombre: nombreLimpio,
          descripcion: `Creada automáticamente en importación - ${new Date().toISOString().split('T')[0]}`,
          estado: 'activo',
          created_at: new Date().toISOString()
        })
        .select('id')
        .single();

      if (errorCrear) {
        console.error(`❌ Error creando ubicación "${nombreLimpio}":`, errorCrear);

        // Intentar buscar nuevamente por si acaso
        const { data: ubicacionDuplicada } = await supabase
          .from('ubicaciones')
          .select('id')
          .ilike('nombre', nombreLimpio)
          .single();

        if (ubicacionDuplicada) {
          console.log(`✅ Ubicación encontrada después de error: ID ${ubicacionDuplicada.id}`);
          return ubicacionDuplicada.id;
        }

        return null;
      }

      console.log(`🎯 Ubicación creada exitosamente: "${nombreLimpio}" -> ID: ${nueva.id}`);
      return nueva.id;

    } catch (error) {
      console.error(`💥 Error inesperado en crearUbicacionSiNoExiste:`, error);
      return null;
    }
  }
  async getUbicacionPorNombre(nombre: string): Promise<number | null> {
    try {
      console.log(`🔍 Buscando ubicación: "${nombre}"`);

      if (!nombre || typeof nombre !== 'string') {
        console.warn(`⚠️ Nombre de ubicación inválido: ${nombre}`);
        return null;
      }

      const nombreLimpio = nombre.trim();

      // 1. Intentar buscar ubicación existente (insensible a mayúsculas)
      const { data: ubicacionExistente, error: errorBusqueda } = await supabase
        .from('ubicaciones')
        .select('id')
        .ilike('nombre', nombreLimpio)
        .eq('estado', 'activo')
        .single();

      // Si encontramos la ubicación, retornar ID
      if (ubicacionExistente && !errorBusqueda) {
        console.log(`✅ Ubicación encontrada: "${nombreLimpio}" -> ID: ${ubicacionExistente.id}`);
        return ubicacionExistente.id;
      }

      // 2. Si no existe, CREAR LA UBICACIÓN AUTOMÁTICAMENTE
      console.log(`➕ Creando nueva ubicación: "${nombreLimpio}"`);

      const { data: nuevaUbicacion, error: errorCreacion } = await supabase
        .from('ubicaciones')
        .insert([{
          nombre: nombreLimpio,
          descripcion: `Ubicación creada automáticamente durante importación - ${new Date().toLocaleDateString()}`,
          estado: 'activo',
          created_at: new Date().toISOString()
        }])
        .select('id')
        .single();

      // 3. Si hay error al crear, puede ser por duplicado (intentar buscar de nuevo)
      if (errorCreacion) {
        console.warn(`⚠️ Error creando ubicación "${nombreLimpio}":`, errorCreacion);

        // Si es error de duplicado (23505), buscar nuevamente
        if (errorCreacion.code === '23505') {
          console.log(`🔄 Intentando buscar ubicación duplicada: "${nombreLimpio}"`);

          const { data: ubicacionDuplicada } = await supabase
            .from('ubicaciones')
            .select('id')
            .ilike('nombre', nombreLimpio)
            .eq('estado', 'activo')
            .single();

          if (ubicacionDuplicada) {
            console.log(`✅ Ubicación duplicada encontrada: "${nombreLimpio}" -> ID: ${ubicacionDuplicada.id}`);
            return ubicacionDuplicada.id;
          }
        }

        return null;
      }

      console.log(`✅ Ubicación creada exitosamente: "${nombreLimpio}" -> ID: ${nuevaUbicacion.id}`);
      return nuevaUbicacion.id;

    } catch (error: any) {
      console.error(`❌ Error en getUbicacionPorNombre:`, error);

      // Método alternativo de emergencia
      try {
        console.log(`🔄 Intentando método alternativo para: "${nombre}"`);

        // Primero, buscar todas las ubicaciones activas
        const { data: todasUbicaciones, error: errorTodas } = await supabase
          .from('ubicaciones')
          .select('id, nombre')
          .eq('estado', 'activo');

        if (errorTodas) throw errorTodas;

        // Buscar coincidencia insensible
        const ubicacionEncontrada = todasUbicaciones?.find(
          u => u.nombre?.toLowerCase().trim() === nombre?.toString().toLowerCase().trim()
        );

        if (ubicacionEncontrada) {
          console.log(`✅ Ubicación encontrada (método alternativo): "${nombre}" -> ID: ${ubicacionEncontrada.id}`);
          return ubicacionEncontrada.id;
        }

        // Si no existe en absoluto, crear
        console.log(`➕ Creando ubicación (método alternativo): "${nombre}"`);

        const nombreLimpio = nombre.trim();
        const { data: nuevaUbicacion } = await supabase
          .from('ubicaciones')
          .insert([{
            nombre: nombreLimpio,
            descripcion: `Creada automáticamente - ${new Date().toLocaleString()}`,
            estado: 'activo'
          }])
          .select('id')
          .single();

        if (nuevaUbicacion) {
          console.log(`✅ Ubicación creada (método alternativo): ID ${nuevaUbicacion.id}`);
          return nuevaUbicacion.id;
        }

      } catch (fallbackError) {
        console.error('❌ Error en método alternativo:', fallbackError);
      }

      return null;
    }
  }
  // Método principal para importar desde Excel
  // Método principal para importar desde Excel
  async importarDesdeExcel(
    archivo: File,
    onProgress?: (procesadas: number, total: number) => void
  ): Promise<{
    total: number,
    creados: number,
    errores: Array<{ fila: number, error: string }>
  }> {
    try {
      console.log('📥 ============ INICIANDO IMPORTACIÓN DESDE EXCEL ============');
      console.log('📥 Archivo:', archivo.name, 'Tamaño:', archivo.size, 'bytes');

      // --------------------------------------------------------------------
      // 1. TRUNCAR TABLAS productos y trazabilidad
      // --------------------------------------------------------------------
      console.log('🧹 ============ LIMPIANDO TABLAS ============');
      try {
        const truncateResult = await this.ejecutarTruncateCompleto();
        console.log('🧹 Resultado truncate:', truncateResult);
      } catch (truncateError) {
        console.error('🧹 Error al truncar tablas:', truncateError);
        throw new Error('No se pudo limpiar la base de datos antes de importar. Operación cancelada.');
      }
      console.log('🧹 Tablas limpiadas correctamente.');

      // 2. Leer archivo Excel
      const arrayBuffer = await archivo.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      console.log('📥 Hojas encontradas:', workbook.SheetNames);

      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const datosExcel = XLSX.utils.sheet_to_json(worksheet);

      if (!datosExcel.length) {
        throw new Error('El archivo Excel está vacío');
      }

      console.log(`📥 ${datosExcel.length} registros encontrados en Excel`);
      console.log('📥 Columnas disponibles:', Object.keys(datosExcel[0] || {}));

      // Mostrar primeros 3 registros para debug
      console.log('📥 Primeros 3 registros:');
      for (let i = 0; i < Math.min(3, datosExcel.length); i++) {
        console.log(`  Fila ${i + 2}:`, datosExcel[i]);
      }

      // 3. Preparar resultados (ya no hay 'actualizados')
      const resultados = {
        total: datosExcel.length,
        creados: 0,
        errores: [] as Array<{ fila: number, error: string }>
      };

      // 4. Procesar cada registro (SOLO INSERCIÓN)
      console.log('\n🔧 ============ PROCESANDO REGISTROS ============');
      for (let i = 0; i < datosExcel.length; i++) {
        const fila = i + 2;
        const registro: any = datosExcel[i];

        try {
          console.log(`\n--- 📝 PROCESANDO FILA ${fila} ---`);
          console.log('📝 Datos crudos:', registro);

          // Validar campos requeridos
          if (!registro.Nombre) {
            throw new Error('El campo "Nombre" es requerido');
          }
          if (!registro.Estado) {
            throw new Error('El campo "Estado" es requerido');
          }
          if (!registro.Criticidad) {
            throw new Error('El campo "Criticidad" es requerido');
          }

          console.log(`📝 Nombre: "${registro.Nombre}"`);
          console.log(`📝 Estado: "${registro.Estado}"`);
          console.log(`📝 Criticidad: "${registro.Criticidad}"`);

          // ============ UBICACIÓN (sin cambios) ============
          console.log(`\n📍 UBICACIÓN - PROCESANDO:`);
          console.log(`📍 Valor crudo de "Ubicación":`, registro.Ubicación);

          let ubicacionId = null;
          if (registro.Ubicación !== undefined && registro.Ubicación !== null) {
            const nombreUbicacionStr = registro.Ubicación.toString();
            const nombreUbicacionLimpio = nombreUbicacionStr.trim();

            if (nombreUbicacionLimpio !== '') {
              console.log(`📍 📞 LLAMANDO A crearUbicacionSiNoExiste("${nombreUbicacionLimpio}")`);
              ubicacionId = await this.crearUbicacionSiNoExiste(nombreUbicacionLimpio);
              console.log(`📍 ✅ RESULTADO:`, ubicacionId);
            } else {
              console.log('📍 ℹ️ Nombre de ubicación vacío después de trim');
            }
          } else {
            console.log('📍 ℹ️ Campo "Ubicación" es undefined o null');
          }
          console.log(`📍 📋 ubicacionId final:`, ubicacionId);

          // ============ CONVERTIR ESTADO ============
          const estadosValidos = ['NUEVO', 'ÚTIL', 'MANTENIMIENTO BANCO DE PRUEBAS', 'MANTENIMIENTO FÁBRICA', 'PROCESO DE EXPORTACIÓN (MODALTRADE)', 'CUARENTENA BODEGA', 'CONDENADO'];
          const estado = registro.Estado.toString().trim();
          const estadoEsValido = estadosValidos.some(e =>
            e.toLowerCase() === estado.toLowerCase()
          );
          if (!estadoEsValido) {
            throw new Error(`Estado inválido: "${registro.Estado}". Valores válidos: ${estadosValidos.join(', ')}`);
          }

          // ============ CONVERTIR CRITICIDAD ============
          const criticidadesValidas = ['BAJA', 'MEDIA', 'ALTA', 'CRÍTICO'];
          const criticidad = registro.Criticidad.toString().trim();
          const criticidadEsValida = criticidadesValidas.some(c =>
            c.toLowerCase() === criticidad.toLowerCase()
          );
          if (!criticidadEsValida) {
            throw new Error(`Criticidad inválida: "${registro.Criticidad}". Valores válidos: ${criticidadesValidas.join(', ')}`);
          }

          // ============ PREPARAR DATOS DEL PRODUCTO ============
          const productoData: any = {
            nombre: registro.Nombre.toString().trim(),
            descripcion: registro.Descripción ? registro.Descripción.toString().trim() : null,
            componente: registro.Componente ? registro.Componente.toString().trim() : null,
            criticidad: criticidad,
            part_number: registro['Part Number'] ? registro['Part Number'].toString().trim() : null,
            codigo: registro.Código ? registro.Código.toString().trim() : null,
            serial_number: registro['Serial Number'] ? registro['Serial Number'].toString().trim() : null,
            estado: estado,
            cantidad_actual: registro['Cantidad Actual'] ? Number(registro['Cantidad Actual']) : 0,
            ubicacion_id: ubicacionId,
            precio: registro.Precio ? Number(registro.Precio) : null,
            fecha_adquisicion: registro['Fecha Adquisición'] ? registro['Fecha Adquisición'].toString().trim() : null,
            orden_envio: registro['Orden Envío'] ? registro['Orden Envío'].toString().trim() : null,
            factura: registro.Factura ? registro.Factura.toString().trim() : null,
            observaciones: registro.Observaciones ? registro.Observaciones.toString().trim() : null,
            estanteria: registro.Estantería ? registro.Estantería.toString().trim() : null,
            esta_activo: true
          };

          // Validar cantidad
          if (productoData.cantidad_actual < 0) {
            throw new Error('La cantidad actual no puede ser negativa');
          }

          console.log('📋 Datos finales del producto:', JSON.stringify(productoData, null, 2));

          // ============ INSERCIÓN DIRECTA (SIN BÚSQUEDA NI ACTUALIZACIÓN) ============
          console.log(`\n➕ CREANDO NUEVO PRODUCTO`);
          const productoNuevo = await this.createProducto(productoData);
          resultados.creados++;
          console.log(`➕ ✅ Producto creado: ID ${productoNuevo.id}, Nombre: ${productoNuevo.nombre}`);

          console.log(`--- ✅ FILA ${fila} PROCESADA CORRECTAMENTE ---\n`);

        } catch (error: any) {
          console.error(`\n❌ ERROR EN FILA ${fila}:`, error.message);
          console.error('❌ Datos de la fila:', registro);

          resultados.errores.push({
            fila,
            error: error.message
          });

          console.log(`--- ❌ FILA ${fila} CON ERROR ---\n`);
        }

        // 📢 NOTIFICAR PROGRESO DESPUÉS DE CADA FILA (ÉXITO O ERROR)
        onProgress?.(i + 1, datosExcel.length);
      }

      console.log('\n✅ ============ IMPORTACIÓN COMPLETADA ============');
      console.log(`✅ Total procesados: ${resultados.total}`);
      console.log(`✅ Creados: ${resultados.creados}`);
      console.log(`✅ Errores: ${resultados.errores.length}`);

      if (resultados.errores.length > 0) {
        console.log('❌ Errores detallados:');
        resultados.errores.forEach(e => {
          console.log(`  Fila ${e.fila}: ${e.error}`);
        });
      }

      return resultados;

    } catch (error: any) {
      console.error('❌ ERROR GENERAL EN IMPORTACIÓN:', error);
      throw this.handleError(error, 'importar productos desde Excel');
    }
  }
  // Método para descargar plantilla de importación
  async descargarPlantillaImportacion(): Promise<void> {
    try {
      console.log('📥 Generando plantilla de importación...');

      // Datos de ejemplo
      const datosEjemplo = [
        {
          'ID': '(Opcional)',
          'Nombre': 'Producto Ejemplo',
          'Descripción': 'Descripción del producto',
          'Componente': 'Componente principal',
          'Criticidad': 'medio',
          'Part Number': 'PN-12345',
          'Código': 'COD-001',
          'Serial Number': 'SN-78901',
          'Estado': 'disponible',
          'Cantidad Actual': 100,
          'Cantidad Mínima': 10,
          'Ubicación': 'Bodega',
          'Precio': 99.99,
          'Fecha Adquisición': '2024-01-15',
          'Orden Envío': '',
          'Factura': '',
          'Observaciones': '',
          'Estado Stock': 'OK'
        }
      ];

      // Crear libro de trabajo
      const worksheet = XLSX.utils.json_to_sheet(datosEjemplo);
      const workbook = XLSX.utils.book_new();

      // Agregar hoja de instrucciones
      const instrucciones = [
        ['INSTRUCCIONES DE IMPORTACIÓN'],
        [''],
        ['1. Use esta plantilla para importar productos'],
        ['2. Mantenga los nombres de las columnas exactamente como están'],
        ['3. La columna ID es opcional (si existe, se ignorará)'],
        ['4. Valores válidos para Estado: NUEVO,UTIL, MANTENIMIENTO BANCO DE PRUEBAS, MANTENIMIENTO FÁBRICA, PROCESO DE EXPORTACIÓN (MODALTRADE), CUARENTENA BODEGA, CONDENADO'],
        ['5. Valores válidos para Criticidad: BAJA, MEDIA, ALTA, CRÍTICO'],
        ['6. "Ubicación" debe ser el NOMBRE exacto de una ubicación existente'],
        ['7. Los productos se identifican por "Código" o "Serial Number"'],
        ['8. Si un producto ya existe, se actualizará'],
        ['9. Si no existe, se creará'],
        [''],
        ['NOTAS:'],
        ['- Las URLs de imágenes deben ser completas'],
        ['- Las fechas en formato YYYY-MM-DD'],
        ['- Los números deben ser valores numéricos']
      ];

      const worksheetInstrucciones = XLSX.utils.aoa_to_sheet(instrucciones);

      // Ajustar anchos de columna
      const colWidths = [
        { wch: 5 },   // ID
        { wch: 30 },  // Nombre
        { wch: 40 },  // Descripción
        { wch: 15 },  // Componente
        { wch: 10 },  // Criticidad
        { wch: 15 },  // Part Number
        { wch: 15 },  // Código
        { wch: 20 },  // Serial Number
        { wch: 12 },  // Estado
        { wch: 15 },  // Cantidad Actual
        { wch: 15 },  // Cantidad Mínima
        { wch: 20 },  // Ubicación
        { wch: 12 },  // Precio
        { wch: 15 },  // Fecha Adquisición
        { wch: 15 },  // Orden Envío
        { wch: 15 },  // Factura
        { wch: 40 },  // Observaciones
        { wch: 12 }   // Estado Stock
      ];

      worksheet['!cols'] = colWidths;

      // Agregar hojas al libro
      XLSX.utils.book_append_sheet(workbook, worksheetInstrucciones, 'Instrucciones');
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Plantilla');

      // Generar archivo
      const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `plantilla_importacion_productos.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      console.log('✅ Plantilla generada');

    } catch (error: any) {
      console.error('❌ Error generando plantilla:', error);
      throw this.handleError(error, 'generar plantilla de importación');
    }
  }









  // ==================== ACTUALIZACIÓN MASIVA ====================
  async actualizacionMasiva(
    ids: number[],
    campos: { [key: string]: any },
    motivo: string = 'Actualización masiva desde interfaz'
  ): Promise<{ actualizados: number, registros: any[] }> {
    try {
      console.log(`📤 Actualizando ${ids.length} productos masivamente...`);
      console.log('📝 Campos a actualizar:', campos);

      if (ids.length === 0) {
        throw new Error('No hay productos seleccionados');
      }

      if (Object.keys(campos).length === 0) {
        throw new Error('No se especificaron campos para actualizar');
      }

      // 1. Obtener productos actuales para trazabilidad
      const { data: productosActuales, error: errorActuales } = await supabase
        .from(this.vistaCompleta)
        .select('*')
        .in('id', ids);

      if (errorActuales) throw errorActuales;

      // 2. Preparar datos para actualización (eliminar campos que no existen en la tabla)
      const camposParaActualizar: any = { ...campos };
      delete camposParaActualizar.id; // No actualizar ID

      // 3. Actualizar productos en lote
      const { data, error } = await supabase
        .from(this.tableName)
        .update(camposParaActualizar)
        .in('id', ids)
        .select();

      if (error) throw error;

      // 4. Registrar en trazabilidad (uno por cada producto)
      const cambiosDetalles = Object.entries(campos)
        .map(([campo, valor]) => `${campo}: ${valor}`)
        .join(', ');

      for (const producto of productosActuales) {
        const cambios = Object.entries(campos).map(([key, nuevoValor]) => ({
          campo: key,
          anterior: producto[key],
          nuevo: nuevoValor
        }));

        await this.registrarActualizacion(producto.id, cambios, motivo);
      }

      console.log(`✅ ${data?.length || 0} productos actualizados masivamente`);

      return {
        actualizados: data?.length || 0,
        registros: data || []
      };

    } catch (error: any) {
      console.error('❌ Error en actualización masiva:', error);
      throw this.handleError(error, 'actualizar productos masivamente');
    }
  }
  // ==================== MANEJO DE ERRORES ====================

  private handleError(error: any, context: string): Error {
    console.error(`[${context}] Error:`, error);

    if (error.code === '23505') {
      return new Error('Ya existe un producto con ese código o serial number');
    }

    if (error.code === '23503') {
      return new Error('Error de referencia: La ubicación no existe');
    }

    if (error.code === '42501') {
      return new Error('No tienes permisos para realizar esta acción');
    }

    if (error.message?.includes('Stock insuficiente')) {
      return new Error(error.message);
    }

    return new Error(error.message || `Error al ${context}`);
  }


  // ==================== MÉTODOS PARA MANEJAR IMÁGENES ====================

  // En productos.service.ts, mejora estos métodos:
  async uploadOrdenEnvio(productoId: number, file: File): Promise<Producto> {
    try {
      console.log(`📤 Subiendo orden de envío para producto ${productoId}`);

      // 1. Obtener producto actual para eliminar imagen anterior si existe
      const productoActual = await this.getProductoById(productoId);
      const imagenAnterior = productoActual.orden_envio;

      // 2. Subir archivo y obtener URL pública
      const imageUrl = await this.storageService.uploadFile(file, 'ordenes_envio');

      console.log(`✅ Nueva URL obtenida: ${imageUrl}`);

      // 3. Actualizar producto CON la nueva URL
      const productoActualizado = await supabase
        .from(this.tableName)
        .update({ orden_envio: imageUrl })
        .eq('id', productoId)
        .select()
        .single();

      if (productoActualizado.error) throw productoActualizado.error;

      // 4. Eliminar imagen anterior SI existe
      if (imagenAnterior) {
        console.log(`🗑️ Eliminando imagen anterior: ${imagenAnterior}`);
        await this.storageService.deleteFile(imagenAnterior);
      }

      // 5. Registrar en trazabilidad
      await this.registrarActualizacion(productoId, [
        {
          campo: 'orden_envio',
          anterior: imagenAnterior || 'Sin imagen',
          nuevo: `Nueva imagen: ${file.name}`
        }
      ], 'Orden de envío actualizada');

      return productoActualizado.data as Producto;

    } catch (error: any) {
      console.error(`❌ Error subiendo orden de envío:`, error);
      throw new Error(`Error subiendo orden de envío: ${error.message}`);
    }
  }

  async uploadFactura(productoId: number, file: File): Promise<Producto> {
    try {
      console.log(`📤 Subiendo factura para producto ${productoId}`);

      // 1. Obtener producto actual para eliminar imagen anterior si existe
      const productoActual = await this.getProductoById(productoId);
      const imagenAnterior = productoActual.factura;

      // 2. Subir archivo y obtener URL pública
      const imageUrl = await this.storageService.uploadFile(file, 'facturas');

      console.log(`✅ Nueva URL obtenida: ${imageUrl}`);

      // 3. Actualizar producto CON la nueva URL
      const productoActualizado = await supabase
        .from(this.tableName)
        .update({ factura: imageUrl })
        .eq('id', productoId)
        .select()
        .single();

      if (productoActualizado.error) throw productoActualizado.error;

      // 4. Eliminar imagen anterior SI existe
      if (imagenAnterior) {
        console.log(`🗑️ Eliminando imagen anterior: ${imagenAnterior}`);
        await this.storageService.deleteFile(imagenAnterior);
      }

      // 5. Registrar en trazabilidad
      await this.registrarActualizacion(productoId, [
        {
          campo: 'factura',
          anterior: imagenAnterior || 'Sin imagen',
          nuevo: `Nueva imagen: ${file.name}`
        }
      ], 'Factura actualizada');

      return productoActualizado.data as Producto;

    } catch (error: any) {
      console.error(`❌ Error subiendo factura:`, error);
      throw new Error(`Error subiendo factura: ${error.message}`);
    }
  }

  // Eliminar orden de envío
  async deleteOrdenEnvio(productoId: number): Promise<Producto> {
    try {
      console.log(`🗑️ Eliminando orden de envío del producto ${productoId}`);

      const producto = await this.getProductoById(productoId);

      if (!producto.orden_envio) {
        throw new Error('No hay orden de envío para eliminar');
      }

      // Eliminar archivo de Storage
      await this.storageService.deleteFile(producto.orden_envio);

      // Actualizar producto
      const productoActualizado = await this.updateProducto(productoId, { orden_envio: null });

      // Registrar en trazabilidad
      await this.registrarActualizacion(productoId, [
        {
          campo: 'orden_envio',
          anterior: producto.orden_envio,
          nuevo: null
        }
      ], 'Eliminación de orden de envío');

      console.log(`✅ Orden de envío eliminada`);
      return productoActualizado;

    } catch (error: any) {
      console.error(`❌ Error eliminando orden de envío:`, error);
      throw new Error(`Error eliminando orden de envío: ${error.message}`);
    }
  }

  // Eliminar factura
  async deleteFactura(productoId: number): Promise<Producto> {
    try {
      console.log(`🗑️ Eliminando factura del producto ${productoId}`);

      const producto = await this.getProductoById(productoId);

      if (!producto.factura) {
        throw new Error('No hay factura para eliminar');
      }

      // Eliminar archivo de Storage
      await this.storageService.deleteFile(producto.factura);

      // Actualizar producto
      const productoActualizado = await this.updateProducto(productoId, { factura: null });

      // Registrar en trazabilidad
      await this.registrarActualizacion(productoId, [
        {
          campo: 'factura',
          anterior: producto.factura,
          nuevo: null
        }
      ], 'Eliminación de factura');

      console.log(`✅ Factura eliminada`);
      return productoActualizado;

    } catch (error: any) {
      console.error(`❌ Error eliminando factura:`, error);
      throw new Error(`Error eliminando factura: ${error.message}`);
    }
  }

  // Obtener URL pública (método auxiliar)
  async getPublicUrl(fileUrl: string): Promise<string> {
    try {
      // Si ya es una URL pública, devolverla
      if (fileUrl.includes('/public/')) {
        return fileUrl;
      }

      // Si es una URL firmada, convertirla a pública
      if (fileUrl.includes('/sign/')) {
        // Extraer el path del archivo
        const urlParts = fileUrl.split('/');
        const bucketIndex = urlParts.indexOf('documentos');

        if (bucketIndex !== -1) {
          const filePath = urlParts.slice(bucketIndex + 1).join('/');
          // Remover parámetros de token si existen
          const cleanPath = filePath.split('?')[0];
          return this.storageService.getPublicUrl(cleanPath);
        }
      }

      // Si no se puede determinar, devolver la URL original
      return fileUrl;

    } catch (error) {
      console.error('Error obteniendo URL pública:', error);
      return fileUrl;
    }
  }

  // Obtener URL firmada (método auxiliar si necesitas URLs temporales)
  async getSignedUrl(fileUrl: string, expiresIn: number = 3600): Promise<string> {
    try {
      // Extraer el path del archivo
      const urlParts = fileUrl.split('/');
      const bucketIndex = urlParts.indexOf('documentos');

      if (bucketIndex !== -1) {
        const filePath = urlParts.slice(bucketIndex + 1).join('/');
        // Remover parámetros de token si existen
        const cleanPath = filePath.split('?')[0];

        // Nota: Necesitarías un método en StorageService para crear URLs firmadas
        // return await this.storageService.createSignedUrl(cleanPath, expiresIn);
      }

      return fileUrl;

    } catch (error) {
      console.error('Error obteniendo URL firmada:', error);
      return fileUrl;
    }
  }
}
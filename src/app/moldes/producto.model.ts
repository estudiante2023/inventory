// models/producto.model.ts
export interface Producto {
  id: number;
  nombre: string;
  descripcion: string | null;
  componente: string | null;
  criticidad:  'BAJA' | 'MEDIA' | 'ALTA' | 'CRÍTICO';
  part_number: string | null;
  codigo: string | null;
  serial_number: string | null;
  estado: 'NUEVO'| 'ÚTIL'| 'MANTENIMIENTO BANCO DE PRUEBAS'| 'MANTENIMIENTO FÁBRICA'| 'PROCESO DE EXPORTACIÓN (MODALTRADE)'| 'CUARENTENA BODEGA'| 'CONDENADO';
  cantidad_actual: number; 
  ubicacion_id: number | null;
  estanteria: string | null;
  precio: number | null;
  fecha_adquisicion: string | null;
  orden_envio: string | null;
  factura: string | null;
  observaciones: string | null;
  created_at: string;
  esta_activo: boolean;
}

export interface ProductoCompleto extends Producto {
  ubicacion_nombre?: string;
  ubicacion_descripcion?: string;
  ubicacion_estado?: string;
  estado_stock?: 'OK' | 'BAJO' | 'AGOTADO';
  diferencia_stock?: number;
  valor_total?: number;
}

// models/trazabilidad.model.ts
export interface Trazabilidadx {
  id: number;
  tipo_evento: 'entrada' | 'salida' | 'ajuste' | 'transferencia' | 'consumo' | 'devolucion' |'CREACION' |'ACTUALIZACION' |'ELIMINACION'     |'ACTIVACION'|'INGRESO'|'EGRESO' |'TRANSFERENCIA' |'ALERTA_SISTEMA' ;
  producto_id: number;
  ubicacion_origen: string | null;
  ubicacion_destino: string | null;
  cantidad: number;
  usuario_id: string | null;
  estado_evento: 'pendiente' | 'completado' | 'cancelado';
  motivo?: string;
  detalles: string | null;
  fecha_evento: string;
  observaciones: string | null;
  fecha_modificacion?: string;
}

export interface TrazabilidadCompleto extends Trazabilidadx {
  producto_nombre?: string;
  producto_codigo?: string;
  usuario_nombre?: string;
  ubicacion_origen_nombre?: string;
  ubicacion_destino_nombre?: string;
}

export interface NuevoMovimiento {
  tipo_evento: 'entrada' | 'salida' | 'ajuste' | 'transferencia' | 'consumo' | 'devolucion' |'CREACION' |'ACTUALIZACION' |'ELIMINACION'     |'ACTIVACION'|'INGRESO'|'EGRESO' |'TRANSFERENCIA' |'ALERTA_SISTEMA' ;
  producto_id: number;
  cantidad: number;
  motivo?: string;
  detalles?: string;
  ubicacion_origen?: string | null;
  ubicacion_destino?: string | null;
  estado_evento?: 'pendiente' | 'completado' | 'cancelado';
  observaciones?: string;
}
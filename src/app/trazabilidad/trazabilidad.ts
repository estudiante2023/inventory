import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TrazabilidadService } from '../../services/trazabilidad.service';
import { ProductosService } from '../../services/productos.service';
import { UbicacionesService } from '../../services/ubicaciones.service';
import { UsuariosService } from '../../services/usuarios.service';
import { ProductoCompleto, Trazabilidadx } from '../moldes/producto.model';

// Interfaces necesarias
interface TrazabilidadRegistro {
  id: number;
  tipo_evento: string;
  producto_id: number;
  producto_nombre?: string;
  producto_codigo?: string;
  ubicacion_origen: string | null;
  ubicacion_destino: string | null;
  cantidad: number;
  usuario_id: string | null;
  usuario_nombre?: string;
  estado_evento: string;
  motivo?: string;
  detalles: string | null;
  fecha_evento: string;
  observaciones: string | null;
}

interface Producto {
  id: number;
  nombre: string;
  codigo: string;
  cantidad_actual: number;
}

interface Ubicacion {
  id: number;
  nombre: string;
}

interface Usuario {
  id: string;
  nombre_completo: string;
}

interface FiltrosTrazabilidad {
  search: string;
  tipo_evento: string;
  estado_evento: string;
  fecha_desde: string;
  fecha_hasta: string;
  producto_id: number | null;
  usuario_id: string | null;
  page: number;
  limit: number;
}

@Component({
  selector: 'app-trazabilidad',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './trazabilidad.html',
  styleUrls: ['./trazabilidad.css']
})
export class Trazabilidad implements OnInit {

userPrivileges: string[] = [];




  // Datos principales
  registros: TrazabilidadRegistro[] = [];
  totalRegistros: number = 0;
  loading: boolean = false;
  
  // Filtros
  filtros: FiltrosTrazabilidad = {
    search: '',
    tipo_evento: '',
    estado_evento: '',
    fecha_desde: '',
    fecha_hasta: '',
    producto_id: null,
    usuario_id: null,
    page: 1,
    limit: 20
  };
  
  // Opciones para filtros
  tiposEvento: string[] = [
    'entrada', 'salida', 'transferencia', 'ajuste', 
    'consumo', 'produccion', 'devolucion', 'recuento','CREACION' ,'ACTUALIZACION' ,'ELIMINACION' ,'ACTIVACION','INGRESO','EGRESO' ,'TRANSFERENCIA'
  ];
  
  estadosEvento: string[] = [
    'completado', 'pendiente', 'cancelado', 'rechazado', 'en_proceso'
  ];
  
  productos: ProductoCompleto[] = [];
  ubicaciones: Ubicacion[] = [];
  usuarios: Usuario[] = [];
  
  // Modal y formularios
  mostrarModalNuevo: boolean = false;
  mostrarModalDetalle: boolean = false;
  mostrarModalEditar: boolean = false;
  mostrarModalEliminar: boolean = false;
  
  // Registro seleccionado
  registroSeleccionado: TrazabilidadRegistro | null = null;
  
  // Formulario nuevo registro
  nuevoRegistro = {
    tipo_evento: 'entrada',
    producto_id: 0,
    cantidad: 1,
    motivo: 'S.M',
    detalles: '',
    ubicacion_origen: '',
    ubicacion_destino: '',
    estado_evento: 'completado',
    observaciones: ''
  };
  
  // Formulario editar registro
  editarRegistro = {
    motivo: 'S.M',
    detalles: '',
    observaciones: '',
    estado_evento: ''
  };
  
  // Variables de control
  esAdmin: boolean = false;
  totalPaginas: number = 0;
  modoAvanzado: boolean = false;

  constructor(
    private trazabilidadService: TrazabilidadService,
    private productosService: ProductosService,
    private ubicacionesService: UbicacionesService
  ) {}

  async ngOnInit() {
    await this.verificarPermisos();
    await this.cargarDatosIniciales();
    await this.cargarRegistros();
    this.loadUserPrivileges();
  }
private loadUserPrivileges() {
    try {
      const privilegiosGuardados = localStorage.getItem('user_privileges');
      if (privilegiosGuardados) {
        this.userPrivileges = JSON.parse(privilegiosGuardados);
        console.log('✅ Privilegios cargados en Inventario:', this.userPrivileges);
      }
    } catch (error) {
      console.error('❌ Error cargando privilegios:', error);
      this.userPrivileges = [];
    }
  }
  async verificarPermisos() {
    // Verificar si el usuario es administrador
    this.esAdmin = await this.trazabilidadService.validarPermisosAdmin();
  }
tienePrivilegio(privilegeCode: string): boolean {
    return this.userPrivileges.includes(privilegeCode);
  }
  async cargarDatosIniciales() {
    try {
      // Cargar productos para filtro
      const productosData = await this.productosService.getProductos({ limit: 100 });
      this.productos = productosData.data || [];
      
      // Cargar ubicaciones para formulario
      const ubicacionesData = await this.ubicacionesService.getUbicacionesActivas();
      this.ubicaciones = ubicacionesData || [];
      
      // Cargar usuarios (si tienes un servicio para esto)
      // this.usuarios = await this.cargarUsuarios();
      
    } catch (error) {
      console.error('Error cargando datos iniciales:', error);
    }
  }
// Agrega este método en la clase Trazabilidad, después de los otros métodos
// Método más robusto y claro
generarRangoPaginas(): number[] {
  const paginas: number[] = [];
  const maxPaginasVisibles = 3;
  const mitad = Math.floor(maxPaginasVisibles / 2);
  
  // Definir inicio y fin
  let inicio = this.filtros.page - mitad;
  let fin = this.filtros.page + mitad;
  
  // Ajustar si nos pasamos por el inicio
  if (inicio < 1) {
    fin += 1 - inicio;
    inicio = 1;
  }
  
  // Ajustar si nos pasamos por el final
  if (fin > this.totalPaginas) {
    inicio -= fin - this.totalPaginas;
    fin = this.totalPaginas;
  }
  
  // Asegurar que inicio no sea menor a 1
  inicio = Math.max(1, inicio);
  
  // Generar páginas únicas
  for (let i = inicio; i <= fin; i++) {
    if (i >= 1 && i <= this.totalPaginas && !paginas.includes(i)) {
      paginas.push(i);
    }
  }
  
  return paginas;
}
  async cargarRegistros() {
    this.loading = true;
    try {
      const resultado = await this.trazabilidadService.getTrazabilidad({
        search: this.filtros.search,
        tipo_evento: this.filtros.tipo_evento,
        fecha_inicio: this.filtros.fecha_desde,
        fecha_fin: this.filtros.fecha_hasta,
        producto_id: this.filtros.producto_id || undefined,
        usuario_id: this.filtros.usuario_id || undefined,
        page: this.filtros.page,
        limit: this.filtros.limit
      });
      
      this.registros = resultado.data || [];
      this.totalRegistros = resultado.count || 0;
      this.totalPaginas = Math.ceil(this.totalRegistros / this.filtros.limit);
      
    } catch (error) {
      console.error('Error cargando registros:', error);
      this.registros = [];
      this.totalRegistros = 0;
    } finally {
      this.loading = false;
    }
  }

  // Métodos de filtrado
  aplicarFiltros() {
    this.filtros.page = 1; // Volver a primera página al aplicar filtros
    this.cargarRegistros();
  }

  limpiarFiltros() {
    this.filtros = {
      search: '',
      tipo_evento: '',
      estado_evento: '',
      fecha_desde: '',
      fecha_hasta: '',
      producto_id: null,
      usuario_id: null,
      page: 1,
      limit: 20
    };
    this.cargarRegistros();
  }

  // Métodos de paginación
  paginaAnterior() {
    if (this.filtros.page > 1) {
      this.filtros.page--;
      this.cargarRegistros();
    }
  }

  paginaSiguiente() {
    if (this.filtros.page < this.totalPaginas) {
      this.filtros.page++;
      this.cargarRegistros();
    }
  }

  irAPagina(pagina: number) {
    if (pagina >= 1 && pagina <= this.totalPaginas) {
      this.filtros.page = pagina;
      this.cargarRegistros();
    }
  }

  // Métodos para modales
  abrirModalNuevo() {
    this.nuevoRegistro = {
      tipo_evento: 'entrada',
      producto_id: 0,
      cantidad: 1,
      motivo: 'S.M',
      detalles: '',
      ubicacion_origen: '',
      ubicacion_destino: '',
      estado_evento: 'completado',
      observaciones: ''
    };
    this.mostrarModalNuevo = true;
  }

  cerrarModalNuevo() {
    this.mostrarModalNuevo = false;
  }

  abrirModalDetalle(registro: TrazabilidadRegistro) {
    this.registroSeleccionado = registro;
    this.mostrarModalDetalle = true;
  }

  cerrarModalDetalle() {
    this.mostrarModalDetalle = false;
    this.registroSeleccionado = null;
  }

  abrirModalEditar(registro: TrazabilidadRegistro) {
    if (!this.esAdmin) {
      alert('Solo administradores pueden editar registros');
      return;
    }
    
    this.registroSeleccionado = registro;
    this.editarRegistro = {
      motivo: registro.motivo|| 'S.M',
      detalles: registro.detalles || '',
      observaciones: registro.observaciones || '',
      estado_evento: registro.estado_evento
    };
    this.mostrarModalEditar = true;
  }

  cerrarModalEditar() {
    this.mostrarModalEditar = false;
    this.registroSeleccionado = null;
  }

  abrirModalEliminar(registro: TrazabilidadRegistro) {
    if (!this.esAdmin) {
      alert('Solo administradores pueden eliminar registros');
      return;
    }
    
    this.registroSeleccionado = registro;
    this.mostrarModalEliminar = true;
  }

  cerrarModalEliminar() {
    this.mostrarModalEliminar = false;
    this.registroSeleccionado = null;
  }

  // Métodos CRUD
  async crearNuevoRegistro() {
    if (!this.validarNuevoRegistro()) {
      return;
    }

    try {
      const nuevoMovimiento = {
        tipo_evento: this.nuevoRegistro.tipo_evento,
        producto_id: this.nuevoRegistro.producto_id,
        cantidad: this.nuevoRegistro.cantidad,
        motivo: this.nuevoRegistro.motivo,
        detalles: this.nuevoRegistro.detalles,
        ubicacion_origen: this.nuevoRegistro.ubicacion_origen || null,
        ubicacion_destino: this.nuevoRegistro.ubicacion_destino || null,
        estado_evento: this.nuevoRegistro.estado_evento,
        observaciones: this.nuevoRegistro.observaciones
      };

      await this.trazabilidadService.registrarMovimiento(nuevoMovimiento as any);
      
      // Cerrar modal y recargar
      this.cerrarModalNuevo();
      await this.cargarRegistros();
      
      alert('Registro creado exitosamente');
      
    } catch (error: any) {
      console.error('Error creando registro:', error);
      alert(`Error al crear registro: ${error.message}`);
    }
  }

  async actualizarRegistro() {
  if (!this.registroSeleccionado) return;

  try {
    // SOLUCIÓN: Asegúrate de que el estado_evento sea uno de los valores permitidos
    const estadoEventoValido = this.validarEstadoEvento(this.editarRegistro.estado_evento);
    
    const updates: Partial<Trazabilidadx> = {
      motivo: this.editarRegistro.motivo,
      detalles: this.editarRegistro.detalles,
      observaciones: this.editarRegistro.observaciones,
      estado_evento: estadoEventoValido // Ahora es del tipo correcto
    };

    await this.trazabilidadService.updateRegistro(this.registroSeleccionado.id, updates);
    
    // Cerrar modal y recargar
    this.cerrarModalEditar();
    await this.cargarRegistros();
    
    alert('Registro actualizado exitosamente');
    
  } catch (error: any) {
    console.error('Error actualizando registro:', error);
    alert(`Error al actualizar registro: ${error.message}`);
  }
}

// Añade esta función de validación en tu clase:
validarEstadoEvento(estado: string): 'completado' | 'pendiente' | 'cancelado' | undefined {
  const estadosValidos = ['completado', 'pendiente', 'cancelado'];
  if (estadosValidos.includes(estado)) {
    return estado as 'completado' | 'pendiente' | 'cancelado';
  }
  return undefined; // o puedes lanzar un error o usar un valor por defecto
}

  async eliminarRegistroConfirmado() {
    if (!this.registroSeleccionado) return;

    try {
      await this.trazabilidadService.deleteRegistro(this.registroSeleccionado.id);
      
      // Cerrar modal y recargar
      this.cerrarModalEliminar();
      await this.cargarRegistros();
      
      alert('Registro eliminado exitosamente');
      
    } catch (error: any) {
      console.error('Error eliminando registro:', error);
      alert(`Error al eliminar registro: ${error.message}`);
    }
  }

  // Métodos de validación
  validarNuevoRegistro(): boolean {
    if (this.nuevoRegistro.producto_id <= 0) {
      alert('Por favor seleccione un producto');
      return false;
    }

    if (this.nuevoRegistro.cantidad <= 0) {
      alert('La cantidad debe ser mayor a 0');
      return false;
    }

    if (!this.nuevoRegistro.motivo.trim()) {
      alert('Por favor ingrese un motivo');
      return false;
    }

    return true;
  }

  // Métodos auxiliares
  getColorTipoEvento(tipo: string): string {
    const colores: { [key: string]: string } = {
      'entrada': 'color-entrada',
      'salida': 'color-salida',
      'transferencia': 'color-transferencia',
      'ajuste': 'color-ajuste',
      'consumo': 'color-consumo',
      'produccion': 'color-produccion',
      'devolucion': 'color-devolucion',
      'recuento': 'color-recuento'
    };
    return colores[tipo] || 'color-default';
  }

  getColorEstado(estado: string): string {
    const colores: { [key: string]: string } = {
      'completado': 'estado-completado',
      'pendiente': 'estado-pendiente',
      'cancelado': 'estado-cancelado',
      'rechazado': 'estado-rechazado',
      'en_proceso': 'estado-en-proceso'
    };
    return colores[estado] || 'estado-default';
  }

  formatearFecha(fecha: string): string {
    return new Date(fecha).toLocaleString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  getProductoNombre(productoId: number): string {
    const producto = this.productos.find(p => p.id === productoId);
    return producto ? `${producto.nombre} (${producto.codigo})` : 'Producto no encontrado';
  }

  // Métodos de búsqueda avanzada
  toggleModoAvanzado() {
    this.modoAvanzado = !this.modoAvanzado;
  }

 async exportarCSV() {
  try {
    // PASAR TODOS LOS FILTROS AL EXPORTAR
    const filtrosExportacion = {
      search: this.filtros.search || undefined,
      tipo_evento: this.filtros.tipo_evento || undefined,
      fecha_desde: this.filtros.fecha_desde || undefined,
      fecha_hasta: this.filtros.fecha_hasta || undefined,
      producto_id: this.filtros.producto_id || undefined,
      usuario_id: this.filtros.usuario_id || undefined
    };

    console.log('📤 Exportando con filtros:', filtrosExportacion);
    
    await this.trazabilidadService.exportarTrazabilidad(filtrosExportacion);
    
  } catch (error) {
    console.error('Error exportando CSV:', error);
    alert('Error al exportar los datos');
  }
}

  
}